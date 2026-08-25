/**
 * API del módulo Tacógrafos: `/api/tacografos/*`.
 *
 * Todas las rutas pasan por `authenticate` (sesión unificada de Supabase),
 * `requireModule("tacografos")` (licencia vigente) y `cargarPermisos`. El mismo
 * encadenado que usan los demás módulos del SaaS.
 *
 * Aquí sólo se valida forma —que el tipo sea uno de los dos, que las fechas
 * parezcan fechas—; las reglas del expediente viven en `domain.ts` para que se
 * puedan probar sin levantar Express ni la base.
 */

import { Router, type Request, type Response } from "express";
import multer from "multer";
import { authenticate, requireModule } from "../core/auth.ts";
import { cargarPermisos, exigirPermiso } from "./permissions.ts";
import {
  camposQueFaltan,
  fechaLimiteDestruccion,
  seAchatarra,
  MODALIDADES,
  type DatosExpediente,
  type Modalidad,
  type TipoOperacion,
} from "./domain.ts";
import * as repo from "./repository.ts";
import { ErrorTacografos } from "./repository.ts";
import * as servicio from "./service.ts";
import {
  DOCUMENTOS_POR_TIPO,
  ETIQUETA_DOCUMENTO,
  TIPOS_DOCUMENTO,
  type TipoDocumento,
} from "./documents.ts";
import { leerDocumento, urlFirmada } from "./storage.ts";
import * as intervenciones from "./intervenciones.ts";
import { componerXlsx, nombreFichero } from "./export.ts";
import { importarAnexoII } from "./importar.ts";

/** Envuelve un manejador para que un fallo no se lleve por delante el proceso. */
function ruta(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof ErrorTacografos) {
        return res.status(e.status).json({ error: e.message, code: e.code, ...e.extra });
      }
      console.error("[Tacógrafos] error no controlado:", e);
      res.status(500).json({ error: "Error interno del módulo de Tacógrafos" });
    }
  };
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Fecha `aaaa-mm-dd` o `null`.
 *
 * Se rechaza cualquier otra cosa en vez de dejar que PostgreSQL lo intente: un
 * `"10/03/2025"` que llegue de un formulario mal montado se interpretaría como
 * octubre de 2025 en unas configuraciones y como marzo en otras.
 */
function fecha(v: unknown): string | null {
  const s = texto(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new ErrorTacografos(`Fecha no válida: ${s}. Se espera aaaa-mm-dd.`, "FECHA_INVALIDA");
  }
  return s;
}

function leerDatos(body: Record<string, unknown>): DatosExpediente {
  const tipo = texto(body.tipo);
  if (tipo !== "transferencia" && tipo !== "intransferibilidad") {
    throw new ErrorTacografos(
      "El tipo de operación debe ser 'transferencia' o 'intransferibilidad'.",
      "TIPO_INVALIDO"
    );
  }
  const modalidad = texto(body.modalidadEntrega);
  if (modalidad && !MODALIDADES.includes(modalidad as Modalidad)) {
    throw new ErrorTacografos(
      `Modalidad de entrega no válida: ${modalidad}.`,
      "MODALIDAD_INVALIDA"
    );
  }
  return {
    numInforme: texto(body.numInforme),
    tipo: tipo as TipoOperacion,
    empresaCliente: texto(body.empresaCliente),
    autorizaNombre: texto(body.autorizaNombre),
    autorizaNif: texto(body.autorizaNif),
    docTitularidad: Boolean(body.docTitularidad),
    matricula: texto(body.matricula),
    bastidor: texto(body.bastidor),
    tacMarca: texto(body.tacMarca),
    tacModelo: texto(body.tacModelo),
    tacSerie: texto(body.tacSerie),
    fechaInforme: fecha(body.fechaInforme),
    fechaEntrega: fecha(body.fechaEntrega),
    fechaTransferencia: fecha(body.fechaTransferencia),
    fechaEnvio: fecha(body.fechaEnvio),
    tecnico: texto(body.tecnico),
    modalidadEntrega: (modalidad || null) as Modalidad | null,
    receptorNombre: texto(body.receptorNombre),
    receptorDni: texto(body.receptorDni),
    entregaAparato: Boolean(body.entregaAparato),
    intervencionId: texto(body.intervencionId) || null,
  };
}

/**
 * Añade lo que se calcula y no se guarda: el achatarramiento (contrario de la
 * entrega) y el plazo de custodia. Van en la respuesta y no en la tabla para
 * que no exista un expediente que se contradiga a sí mismo.
 */
function conCalculados(e: repo.Expediente) {
  return {
    ...e,
    seAchatarra: seAchatarra(e.entregaAparato),
    fechaLimiteDestruccion: fechaLimiteDestruccion(e.fechaTransferencia),
    camposQueFaltan: camposQueFaltan(e),
  };
}

/**
 * Subida del informe del anexo II.
 *
 * El tope es generoso porque el camino habitual es una foto del móvil, que
 * ronda los pocos MB; quedarse corto obligaría al técnico a bajar la calidad
 * justo de lo que hay que leer.
 */
const subidaInforme = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

const TIPOS_ACEPTADOS = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];

export function createTacografosRouter(): Router {
  const r = Router();
  r.use(authenticate, requireModule("tacografos"), cargarPermisos);

  /** Lo que la pantalla necesita al abrir: permisos y datos del centro. */
  r.get(
    "/bootstrap",
    exigirPermiso("tacografos.view"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      res.json({
        rol: req.tacografosRol ?? null,
        permisos: req.tacografosPermisos ?? [],
        centro: await repo.obtenerCentro(ctx.empresaId),
        // Para que la pantalla no enseñe un buscador de intervenciones que
        // nunca va a devolver nada.
        autorrelleno: await intervenciones.autorrellenoDisponible(ctx.empresaId),
      });
    })
  );

  r.get(
    "/expedientes",
    exigirPermiso("tacografos.view"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const expedientes = await repo.listarExpedientes(ctx.empresaId, {
        texto: texto(req.query.texto),
        tipo: texto(req.query.tipo) || undefined,
        estado: texto(req.query.estado) || undefined,
        limite: Number(req.query.limite) || undefined,
      });
      res.json({ expedientes: expedientes.map(conCalculados) });
    })
  );

  r.get(
    "/expedientes/:id",
    exigirPermiso("tacografos.view"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const e = await repo.obtenerExpediente(ctx.empresaId, String(req.params.id));
      if (!e) {
        throw new ErrorTacografos("Expediente no encontrado.", "EXPEDIENTE_NO_ENCONTRADO", 404);
      }
      res.json({ expediente: conCalculados(e) });
    })
  );

  /*
   * Se guarda aunque falten campos obligatorios, y la respuesta dice cuáles.
   *
   * Es deliberado: el técnico apunta la matrícula y el nº de serie con el
   * vehículo delante y termina el resto en el mostrador. Bloquear el guardado
   * hasta tenerlo todo obligaría a apuntarlo en un papel, que es exactamente de
   * lo que venimos. Lo que sí exigirá el expediente completo es la emisión de
   * los documentos, en la fase 3.
   */
  r.post(
    "/expedientes",
    exigirPermiso("tacografos.expediente.create"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const datos = leerDatos(req.body ?? {});
      const e = await repo.crearExpediente(ctx.empresaId, ctx.userId, datos);
      res.status(201).json({ expediente: conCalculados(e) });
    })
  );

  r.put(
    "/expedientes/:id",
    exigirPermiso("tacografos.expediente.edit"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const datos = leerDatos(req.body ?? {});
      const e = await repo.actualizarExpediente(ctx.empresaId, String(req.params.id), datos);
      res.json({ expediente: conCalculados(e) });
    })
  );

  /*
   * Anular decide en el servicio qué significa: un expediente que nunca emitió
   * documento se borra del todo (`eliminado: true`); uno con papel emitido
   * queda como rastro anulado. En ambos casos su nº de informe queda libre.
   */
  r.post(
    "/expedientes/:id/anular",
    exigirPermiso("tacografos.expediente.annul"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const r2 = await servicio.anularExpediente(ctx.empresaId, String(req.params.id));
      res.json({
        eliminado: r2.eliminado,
        expediente: r2.expediente ? conCalculados(r2.expediente) : null,
      });
    })
  );

  /*
   * Documentos del expediente. Los enlaces vienen firmados y caducan: una URL
   * copiada de la barra del navegador deja de abrir el NIF de nadie a los
   * quince minutos.
   */
  r.get(
    "/expedientes/:id/documentos",
    exigirPermiso("tacografos.view"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const id = String(req.params.id);
      const expediente = await repo.obtenerExpediente(ctx.empresaId, id);
      if (!expediente) {
        throw new ErrorTacografos("Expediente no encontrado.", "EXPEDIENTE_NO_ENCONTRADO", 404);
      }
      res.json({
        documentos: await servicio.documentosDelExpediente(ctx.empresaId, id),
        // Qué se puede emitir para este expediente, con su etiqueta: así la
        // pantalla no repite la tabla de qué documento va con qué operación.
        emitibles: DOCUMENTOS_POR_TIPO[expediente.tipo].map((t) => ({
          tipo: t,
          etiqueta: ETIQUETA_DOCUMENTO[t],
        })),
      });
    })
  );

  r.post(
    "/expedientes/:id/documentos",
    exigirPermiso("tacografos.documento.emit"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const tipo = texto((req.body ?? {}).tipo);
      if (!TIPOS_DOCUMENTO.includes(tipo as TipoDocumento)) {
        throw new ErrorTacografos(`Tipo de documento no válido: ${tipo}.`, "TIPO_DOC_INVALIDO");
      }
      const documento = await servicio.emitirDocumento(
        ctx.empresaId,
        ctx.userId,
        String(req.params.id),
        tipo as TipoDocumento
      );
      res.status(201).json({ documento });
    })
  );

  /*
   * Descarga por el servidor y no redirigiendo al enlace firmado: así funciona
   * igual con Supabase y con el disco local de desarrollo, y el navegador nunca
   * ve la URL del almacenamiento.
   */
  r.get(
    "/documentos/:docId/descargar",
    exigirPermiso("tacografos.view"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const doc = await repo.obtenerDocumento(ctx.empresaId, String(req.params.docId));
      if (!doc) {
        throw new ErrorTacografos("Documento no encontrado.", "DOCUMENTO_NO_ENCONTRADO", 404);
      }
      const bytes = await leerDocumento(doc.ruta);
      if (!bytes) {
        throw new ErrorTacografos(
          "El documento ya no está en el almacenamiento.",
          "DOCUMENTO_SIN_FICHERO",
          410
        );
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${doc.tipo}-${doc.id}.pdf"`);
      res.send(bytes);
    })
  );

  r.post(
    "/documentos/:docId/anular",
    exigirPermiso("tacografos.documento.annul"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const motivo = texto((req.body ?? {}).motivo);
      if (!motivo) {
        // Sin motivo la anulación no explica nada, y explicar por qué se retiró
        // un documento firmado es justo lo que pedirá una auditoría.
        throw new ErrorTacografos("Hay que indicar el motivo de la anulación.", "MOTIVO_REQUERIDO");
      }
      const documento = await repo.anularDocumento(
        ctx.empresaId,
        String(req.params.docId),
        motivo
      );
      res.json({ documento });
    })
  );

  // ── Firmas ────────────────────────────────────────────────────────────────

  r.get(
    "/expedientes/:id/firmas",
    exigirPermiso("tacografos.view"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const firmas = await repo.listarFirmas(ctx.empresaId, String(req.params.id));
      res.json({
        firmas: await Promise.all(
          firmas.map(async (f) => ({ ...f, url: await urlFirmada(f.ruta) }))
        ),
      });
    })
  );

  r.put(
    "/expedientes/:id/firmas/:papel",
    exigirPermiso("tacografos.documento.sign"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const papel = String(req.params.papel);
      if (!repo.PAPELES_FIRMA.includes(papel as repo.PapelFirma)) {
        throw new ErrorTacografos(`Papel de firma no válido: ${papel}.`, "PAPEL_INVALIDO");
      }
      const b = (req.body ?? {}) as Record<string, unknown>;
      const imagen = typeof b.imagen === "string" ? b.imagen : "";
      if (!imagen) {
        throw new ErrorTacografos("Falta la imagen de la firma.", "FIRMA_REQUERIDA");
      }
      const firma = await servicio.firmar(
        ctx.empresaId,
        ctx.userId,
        String(req.params.id),
        papel as repo.PapelFirma,
        imagen,
        texto(b.nombre),
        texto(b.dni)
      );
      // El expediente vuelve porque firmar puede haberle escrito el nombre y
      // el DNI recogidos en la tablet: la pantalla los refresca sin recargar.
      const expediente = await repo.obtenerExpediente(ctx.empresaId, String(req.params.id));
      res.json({ firma, expediente: expediente ? conCalculados(expediente) : null });
    })
  );

  r.delete(
    "/expedientes/:id/firmas/:papel",
    exigirPermiso("tacografos.documento.sign"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const papel = String(req.params.papel);
      if (!repo.PAPELES_FIRMA.includes(papel as repo.PapelFirma)) {
        throw new ErrorTacografos(`Papel de firma no válido: ${papel}.`, "PAPEL_INVALIDO");
      }
      await repo.borrarFirma(ctx.empresaId, String(req.params.id), papel as repo.PapelFirma);
      res.json({ ok: true });
    })
  );

  // ── Entrega ───────────────────────────────────────────────────────────────

  r.post(
    "/expedientes/:id/entregar",
    exigirPermiso("tacografos.entrega.register"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const fechaEntrega = fecha(b.fechaEntrega);
      if (!fechaEntrega) {
        throw new ErrorTacografos("Falta la fecha de entrega.", "FECHA_ENTREGA_REQUERIDA");
      }
      const receptorNombre = texto(b.receptorNombre);
      const receptorDni = texto(b.receptorDni);
      if (!receptorNombre || !receptorDni) {
        // Sin nombre y DNI el acuse no acredita nada: es lo que firma quien
        // recibe el certificado.
        throw new ErrorTacografos(
          "Hay que indicar el nombre y el DNI de quien recibe el certificado.",
          "RECEPTOR_REQUERIDO"
        );
      }
      const expediente = await servicio.registrarEntrega(ctx.empresaId, String(req.params.id), {
        fechaEntrega,
        receptorNombre,
        receptorDni,
      });
      res.json({ expediente: conCalculados(expediente) });
    })
  );

  // ── Traer datos de una intervención de taller ─────────────────────────────

  r.get(
    "/intervenciones",
    exigirPermiso("tacografos.view"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      res.json({
        sugerencias: await intervenciones.buscar(ctx.empresaId, texto(req.query.texto)),
      });
    })
  );

  // ── Exportación de respaldo ───────────────────────────────────────────────

  r.get(
    "/expedientes/:id/exportar",
    exigirPermiso("tacografos.view"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const id = String(req.params.id);
      const expediente = await repo.obtenerExpediente(ctx.empresaId, id);
      if (!expediente) {
        throw new ErrorTacografos("Expediente no encontrado.", "EXPEDIENTE_NO_ENCONTRADO", 404);
      }
      const libro = componerXlsx(
        expediente,
        await repo.obtenerCentro(ctx.empresaId),
        await repo.listarDocumentos(ctx.empresaId, id)
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${nombreFichero(expediente)}"`);
      res.send(libro);
    })
  );

  /*
   * Lee el informe de la extranet y devuelve lo que ha entendido. NO crea nada:
   * el expediente lo guarda el técnico después de repasar los datos, porque un
   * dato mal leído en silencio acaba en un certificado firmado.
   */
  r.post(
    "/importar",
    exigirPermiso("tacografos.expediente.create"),
    subidaInforme.single("fichero"),
    ruta(async (req, res) => {
      const f = req.file;
      if (!f) throw new ErrorTacografos("No se ha recibido ningún fichero.", "FICHERO_REQUERIDO");
      if (!TIPOS_ACEPTADOS.includes(f.mimetype)) {
        throw new ErrorTacografos(
          `Formato no admitido (${f.mimetype}). Sube el PDF de la extranet o una foto del informe.`,
          "FORMATO_NO_ADMITIDO"
        );
      }
      res.json(await importarAnexoII(f.buffer, f.mimetype));
    })
  );

  // ── Custodia de los archivos transferidos ─────────────────────────────────

  r.get(
    "/custodia",
    exigirPermiso("tacografos.view"),
    ruta(async (req, res) => {
      res.json({ custodia: await servicio.colaCustodia(req.authCtx!.empresaId) });
    })
  );

  r.post(
    "/expedientes/:id/destruccion",
    exigirPermiso("tacografos.custodia.destruir"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const expediente = await servicio.registrarDestruccion(
        ctx.empresaId,
        String(req.params.id),
        {
          fecha: fecha(b.fecha) ?? "",
          metodo: texto(b.metodo),
          persona: texto(b.persona),
          hash: texto(b.hash),
        }
      );
      res.json({ expediente: conCalculados(expediente) });
    })
  );

  // ── Comunicaciones a la administración ────────────────────────────────────

  r.get(
    "/comunicaciones/pendientes",
    exigirPermiso("tacografos.view"),
    ruta(async (req, res) => {
      const pendientes = await servicio.colaComunicaciones(req.authCtx!.empresaId);
      res.json({ pendientes: pendientes.map(conCalculados) });
    })
  );

  r.get(
    "/expedientes/:id/comunicaciones",
    exigirPermiso("tacografos.view"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      res.json({
        comunicaciones: await repo.listarComunicaciones(ctx.empresaId, String(req.params.id)),
      });
    })
  );

  r.post(
    "/expedientes/:id/comunicaciones",
    exigirPermiso("tacografos.comunicacion.register"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const b = (req.body ?? {}) as Record<string, unknown>;
      const fechaPresentacion = fecha(b.fechaPresentacion);
      if (!fechaPresentacion) {
        throw new ErrorTacografos("Falta la fecha de presentación.", "FECHA_REQUERIDA");
      }
      const comunicacion = await servicio.registrarComunicacion(
        ctx.empresaId,
        ctx.userId,
        String(req.params.id),
        { fechaPresentacion, referencia: texto(b.referencia), notas: texto(b.notas) }
      );
      res.status(201).json({ comunicacion });
    })
  );

  /** Texto listo para pegar en la petición genérica de la Generalitat. */
  r.get(
    "/expedientes/:id/texto-tramite",
    exigirPermiso("tacografos.view"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      res.json(await servicio.textoTramite(ctx.empresaId, String(req.params.id)));
    })
  );

  r.get(
    "/centro",
    exigirPermiso("tacografos.view"),
    ruta(async (req, res) => {
      res.json({ centro: await repo.obtenerCentro(req.authCtx!.empresaId) });
    })
  );

  r.put(
    "/centro",
    exigirPermiso("tacografos.config.edit"),
    ruta(async (req, res) => {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const centro = await repo.guardarCentro(req.authCtx!.empresaId, {
        nombre: texto(b.nombre),
        centroTecnico: texto(b.centroTecnico),
        numCentro: texto(b.numCentro),
        direccion1: texto(b.direccion1),
        direccion2: texto(b.direccion2),
        ciudad: texto(b.ciudad),
        ciudadFirma: texto(b.ciudadFirma),
        email: texto(b.email),
        destinatarioAdmin: texto(b.destinatarioAdmin),
        responsableTecnico: texto(b.responsableTecnico),
        urlTramite: texto(b.urlTramite),
        urlTramiteOvt: texto(b.urlTramiteOvt),
      });
      res.json({ centro });
    })
  );

  return r;
}
