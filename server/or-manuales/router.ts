/**
 * API del módulo OR Manuales: `/api/or-manuales/*`.
 *
 * Todas las rutas pasan por `authenticate` (sesión unificada de Supabase),
 * `requireModule("or-manuales")` (licencia vigente) y `cargarPermisos`. El
 * mismo encadenado que Recepciones, Therefore, Cash y Tacógrafos.
 *
 * Aquí sólo se valida FORMA; las reglas viven en `domain/` y los casos de uso
 * en `service.ts`. La empresa sale SIEMPRE de `req.authCtx`, nunca del cuerpo.
 *
 * Los documentos NO se sirven por enlace al bucket: se devuelven por aquí, con
 * la sesión puesta, para que el panel pueda enseñarlos en un visor. Un enlace
 * directo al almacenamiento sería un documento accesible sin sesión, y una OR
 * lleva matrícula, cliente y lo que se hizo en el vehículo.
 */

import { Router, type Request, type Response } from "express";
import multer from "multer";

import { authenticate, requireModule } from "../core/auth.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import { ErrorOrManuales } from "./errors.ts";
import { cargarPermisos, exigirPermiso } from "./permissions.ts";
import * as repo from "./repository.ts";
import * as servicio from "./service.ts";
import * as procesamiento from "./procesamiento.ts";
import { guardarConfiguracion, leerConfiguracion } from "./config.ts";
import { MAX_BYTES } from "./ocr.ts";
import { leerDocumento } from "./storage.ts";
import { zonaValida, type ZonaOcr } from "./domain/deteccion.ts";
import {
  CANALES_AVISO,
  ESTADOS_AVISO,
  ESTADOS_BLOC,
  ESTADOS_DOCUMENTO,
  ESTADOS_OR,
  ESTADOS_PROCESAMIENTO,
  ETIQUETA_ESTADO_AVISO,
  ETIQUETA_ESTADO_BLOC,
  ETIQUETA_ESTADO_DOCUMENTO,
  ETIQUETA_ESTADO_OR,
  ETIQUETA_ESTADO_PROCESAMIENTO,
  ETIQUETA_METODO_DETECCION,
  ETIQUETA_TIPO_AVISO,
  METODOS_DETECCION,
  TIPOS_AVISO,
} from "./domain/estados.ts";

/** Envuelve un manejador para que un fallo no se lleve por delante el proceso. */
function ruta(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof ErrorOrManuales) {
        return res
          .status(e.estado)
          .json({ error: e.message, code: e.codigo, ...(e.detalle ? { detalle: e.detalle } : {}) });
      }
      console.error("[OR Manuales] error no controlado:", e);
      res.status(500).json({ error: "Error interno del módulo OR Manuales" });
    }
  };
}

function contextoDe(req: Request): servicio.Contexto {
  const ctx = req.authCtx!;
  return { empresaId: ctx.empresaId, userId: ctx.userId, userNombre: ctx.nombre, ip: req.ip };
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function entero(v: unknown, que: string): number {
  const n = typeof v === "number" ? v : Number(texto(v));
  if (!Number.isInteger(n) || n <= 0) {
    throw new ErrorOrManuales("NUMERO_INVALIDO", `${que} tiene que ser un número entero positivo.`);
  }
  return n;
}

/**
 * Los escaneos: hasta 30 ficheros de 60 MB por tanda.
 *
 * Se guardan en memoria y no en disco porque se separan en páginas
 * inmediatamente y cada página va al almacenamiento definitiva: un fichero
 * temporal en el disco del contenedor sería un sitio más del que acordarse de
 * limpiar, y en Render ese disco es efímero de todas formas.
 */
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 30 } });

export function createOrManualesRouter(): Router {
  const r = Router();
  r.use(authenticate, requireModule("or-manuales"), cargarPermisos);

  /* ── Bootstrap ─────────────────────────────────────────────────────────── */

  r.get(
    "/bootstrap",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const [indicadores, config] = await Promise.all([
        repo.indicadores(ctx.empresaId),
        leerConfiguracion(ctx.empresaId),
      ]);
      res.json({
        rol: req.orManualesRol ?? null,
        permisos: req.orManualesPermisos ?? [],
        usuario: { id: ctx.userId, nombre: ctx.userNombre },
        indicadores,
        config,
        // Los vocabularios los manda el servidor para que el panel no tenga una
        // copia que se quede vieja.
        vocabulario: {
          estadosBloc: ESTADOS_BLOC,
          estadosOr: ESTADOS_OR,
          estadosDocumento: ESTADOS_DOCUMENTO,
          estadosProcesamiento: ESTADOS_PROCESAMIENTO,
          metodosDeteccion: METODOS_DETECCION,
          tiposAviso: TIPOS_AVISO,
          estadosAviso: ESTADOS_AVISO,
          canalesAviso: CANALES_AVISO,
          etiquetas: {
            estadoBloc: ETIQUETA_ESTADO_BLOC,
            estadoOr: ETIQUETA_ESTADO_OR,
            estadoDocumento: ETIQUETA_ESTADO_DOCUMENTO,
            estadoProcesamiento: ETIQUETA_ESTADO_PROCESAMIENTO,
            metodoDeteccion: ETIQUETA_METODO_DETECCION,
            tipoAviso: ETIQUETA_TIPO_AVISO,
            estadoAviso: ETIQUETA_ESTADO_AVISO,
          },
        },
      });
    })
  );

  /** Los indicadores por su cuenta, para refrescar el panel sin recargarlo todo. */
  r.get(
    "/indicadores",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      res.json({ indicadores: await repo.indicadores(contextoDe(req).empresaId) });
    })
  );

  /* ── Blocs ─────────────────────────────────────────────────────────────── */

  r.get(
    "/blocs",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const blocs = await repo.listarBlocs(ctx.empresaId, {
        estado: texto(req.query.estado) || undefined,
        responsableId: texto(req.query.responsableId) || undefined,
        texto: texto(req.query.q) || undefined,
        desde: texto(req.query.desde) || undefined,
        hasta: texto(req.query.hasta) || undefined,
        incompletos: req.query.incompletos === "1",
        cerrados: req.query.cerrados === "1",
        conRevisiones: req.query.conRevisiones === "1",
      });
      res.json({ blocs });
    })
  );

  /** Lo que propone la pantalla de «Nuevo bloc». */
  r.get(
    "/blocs/propuesta",
    exigirPermiso("or-manuales.bloc.create"),
    ruta(async (req, res) => {
      res.json({ propuesta: await servicio.proponerBloc(contextoDe(req)) });
    })
  );

  r.post(
    "/blocs",
    exigirPermiso("or-manuales.bloc.create"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const ficha = await servicio.crearBloc(ctx, req.body ?? {});
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "or_manuales.bloc.crear",
        entidad: "orm_blocs",
        entidadId: ficha.bloc.id,
        detalle: { numeroBloc: ficha.bloc.numeroBloc, orInicial: ficha.bloc.orInicial, orFinal: ficha.bloc.orFinal },
        ip: ctx.ip,
      });
      res.status(201).json(ficha);
    })
  );

  r.get(
    "/blocs/:id",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      res.json(await servicio.fichaBloc(contextoDe(req), String(req.params.id)));
    })
  );

  r.patch(
    "/blocs/:id",
    exigirPermiso("or-manuales.bloc.create"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const ficha = await servicio.editarBloc(ctx, String(req.params.id), req.body ?? {});
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "or_manuales.bloc.editar",
        entidad: "orm_blocs",
        entidadId: ficha.bloc.id,
        detalle: req.body ?? {},
        ip: ctx.ip,
      });
      res.json(ficha);
    })
  );

  /**
   * Borra el bloc. Con `confirmar: true` se lleva también las hojas que
   * tuviera archivadas; sin él, un bloc con hojas contesta 409 diciendo
   * cuántas son, para que quien lo borra sepa qué se lleva por delante.
   */
  r.delete(
    "/blocs/:id",
    exigirPermiso("or-manuales.bloc.eliminar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const id = String(req.params.id);
      const r2 = await servicio.eliminarBloc(ctx, id, {
        confirmar: req.body?.confirmar === true,
        motivo: texto(req.body?.motivo),
      });
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "or_manuales.bloc.eliminar",
        entidad: "orm_blocs",
        entidadId: id,
        detalle: { numeroBloc: r2.numeroBloc, documentosRetirados: r2.documentosRetirados, motivo: texto(req.body?.motivo) || null },
        ip: ctx.ip,
      });
      res.json({ ok: true, ...r2 });
    })
  );

  r.post(
    "/blocs/:id/entregar",
    exigirPermiso("or-manuales.bloc.entregar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const ficha = await servicio.entregarBloc(ctx, String(req.params.id), req.body ?? {});
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "or_manuales.bloc.entregar",
        entidad: "orm_blocs",
        entidadId: ficha.bloc.id,
        detalle: { responsable: ficha.bloc.responsableNombre, fechaEntrega: ficha.bloc.fechaEntrega },
        ip: ctx.ip,
      });
      res.json(ficha);
    })
  );

  r.post(
    "/blocs/:id/devolver",
    exigirPermiso("or-manuales.bloc.entregar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const ficha = await servicio.devolverBloc(ctx, String(req.params.id), req.body ?? {});
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "or_manuales.bloc.devolver",
        entidad: "orm_blocs",
        entidadId: ficha.bloc.id,
        detalle: { fechaDevolucion: ficha.bloc.fechaDevolucion, faltan: ficha.progreso.faltan },
        ip: ctx.ip,
      });
      res.json(ficha);
    })
  );

  r.post(
    "/blocs/:id/cerrar",
    exigirPermiso("or-manuales.bloc.cerrar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const ficha = await servicio.cerrarBloc(ctx, String(req.params.id), req.body ?? {});
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "or_manuales.bloc.cerrar",
        entidad: "orm_blocs",
        entidadId: ficha.bloc.id,
        detalle: { archivadas: ficha.progreso.archivadas, total: ficha.progreso.total },
        ip: ctx.ip,
      });
      res.json(ficha);
    })
  );

  /** Recontar a mano. Existe porque un recuento derivado siempre debe poder rehacerse. */
  r.post(
    "/blocs/:id/recalcular",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      res.json(await servicio.recalcularBloc(contextoDe(req), String(req.params.id)));
    })
  );

  /* ── Documentos ────────────────────────────────────────────────────────── */

  /**
   * Subir escaneos. Contesta **202**: el trabajo sigue después de la
   * respuesta, y el panel lo mira por el id de cada proceso.
   */
  r.post(
    "/documentos",
    exigirPermiso("or-manuales.documento.subir"),
    subida.array("documentos", 30),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const ficheros = (req.files as Express.Multer.File[] | undefined) ?? [];
      if (ficheros.length === 0) {
        throw new ErrorOrManuales("SIN_FICHEROS", "No ha llegado ningún fichero.");
      }

      const procesos: repo.Procesamiento[] = [];
      const fallidos: { archivo: string; error: string; code: string }[] = [];

      for (const f of ficheros) {
        try {
          procesos.push(
            await procesamiento.encolarProceso(ctx, {
              nombre: f.originalname,
              mime: f.mimetype,
              contenido: f.buffer,
            })
          );
        } catch (e) {
          /*
           * Un fichero malo no invalida la tanda: se dice cuál falló y por qué,
           * y los demás siguen su curso. Es la misma regla que dentro del lote.
           */
          if (e instanceof ErrorOrManuales) {
            fallidos.push({ archivo: f.originalname, error: e.message, code: e.codigo });
          } else {
            console.error("[OR Manuales] error subiendo un fichero:", e);
            fallidos.push({ archivo: f.originalname, error: "No se ha podido guardar el fichero.", code: "ERROR" });
          }
        }
      }

      if (procesos.length === 0) {
        return res.status(415).json({
          error: fallidos[0]?.error ?? "No se ha podido procesar ningún fichero.",
          code: fallidos[0]?.code ?? "SIN_FICHEROS",
          detalle: { fallidos },
        });
      }

      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "or_manuales.documentos.subir",
        entidad: "orm_procesamientos",
        detalle: { procesos: procesos.map((p) => p.id), fallidos },
        ip: ctx.ip,
      });

      res.status(202).json({ procesos, fallidos });
    })
  );

  r.get(
    "/documentos/pendientes",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      res.json({ documentos: await repo.listarPendientes(contextoDe(req).empresaId) });
    })
  );

  r.get(
    "/documentos/:id",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const documento = await repo.documentoPorId(ctx.empresaId, String(req.params.id));
      if (!documento) throw new ErrorOrManuales("DOCUMENTO_NO_ENCONTRADO", "Documento no encontrado.", 404);
      const bloc = documento.blocId ? await repo.blocPorId(ctx.empresaId, documento.blocId) : null;
      res.json({ documento, bloc });
    })
  );

  /** El contenido, en línea y con la sesión puesta. */
  r.get(
    "/documentos/:id/contenido",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const documento = await repo.documentoPorId(ctx.empresaId, String(req.params.id));
      if (!documento) throw new ErrorOrManuales("DOCUMENTO_NO_ENCONTRADO", "Documento no encontrado.", 404);
      const contenido = await leerDocumento(documento.storageKey);
      if (!contenido) {
        throw new ErrorOrManuales("DOCUMENTO_ILEGIBLE", "El documento no está disponible en el almacenamiento.", 404);
      }
      res.setHeader("Content-Type", documento.tipoArchivo);
      res.setHeader("Content-Disposition", `inline; filename="${documento.nombreArchivo}"`);
      res.setHeader("X-Documento-Sha256", documento.hashArchivo);
      res.end(contenido);
    })
  );

  /** Comprueba que lo guardado sigue siendo lo que se archivó. */
  r.get(
    "/documentos/:id/verificar",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const documento = await repo.documentoPorId(ctx.empresaId, String(req.params.id));
      if (!documento) throw new ErrorOrManuales("DOCUMENTO_NO_ENCONTRADO", "Documento no encontrado.", 404);
      const contenido = await leerDocumento(documento.storageKey);
      if (!contenido) {
        throw new ErrorOrManuales("DOCUMENTO_ILEGIBLE", "El documento no está disponible en el almacenamiento.", 404);
      }
      const { hashDeFichero } = await import("./storage.ts");
      const hashActual = hashDeFichero(contenido);
      res.json({ documento, hashActual, integro: hashActual === documento.hashArchivo });
    })
  );

  r.post(
    "/documentos/:id/asignar",
    exigirPermiso("or-manuales.documento.gestionar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const numeroOr = entero(req.body?.numeroOr, "El número de OR");
      const resultado = await servicio.asignarManual(ctx, String(req.params.id), numeroOr);
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "or_manuales.documento.asignar",
        entidad: "orm_documentos",
        entidadId: String(req.params.id),
        detalle: { numeroOr, resultado: resultado.estado },
        ip: ctx.ip,
      });
      res.json(resultado);
    })
  );

  r.post(
    "/documentos/:id/confirmar",
    exigirPermiso("or-manuales.documento.gestionar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const documento = await servicio.confirmarDocumento(ctx, String(req.params.id));
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "or_manuales.documento.confirmar",
        entidad: "orm_documentos",
        entidadId: documento.id,
        detalle: { numeroOr: documento.numeroOr },
        ip: ctx.ip,
      });
      res.json({ documento });
    })
  );

  r.post(
    "/documentos/:id/sustituir",
    exigirPermiso("or-manuales.documento.gestionar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const resultado = await servicio.sustituirDocumento(ctx, String(req.params.id));
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "or_manuales.documento.sustituir",
        entidad: "orm_documentos",
        entidadId: String(req.params.id),
        detalle: { numeroOr: resultado.numeroOr },
        ip: ctx.ip,
      });
      res.json(resultado);
    })
  );

  r.post(
    "/documentos/:id/reprocesar",
    exigirPermiso("or-manuales.documento.gestionar"),
    ruta(async (req, res) => {
      res.json({ documento: await procesamiento.reprocesarDocumento(contextoDe(req), String(req.params.id)) });
    })
  );

  r.delete(
    "/documentos/:id",
    exigirPermiso("or-manuales.documento.gestionar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const motivo = texto(req.body?.motivo) || null;
      await servicio.eliminarDocumento(ctx, String(req.params.id), motivo);
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "or_manuales.documento.eliminar",
        entidad: "orm_documentos",
        entidadId: String(req.params.id),
        detalle: { motivo },
        ip: ctx.ip,
      });
      res.json({ ok: true });
    })
  );

  /* ── Procesamientos ────────────────────────────────────────────────────── */

  r.get(
    "/procesamientos",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      res.json({ procesamientos: await repo.listarProcesamientos(contextoDe(req).empresaId) });
    })
  );

  r.get(
    "/procesamientos/:id",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const proceso = await repo.procesamientoPorId(ctx.empresaId, String(req.params.id));
      if (!proceso) throw new ErrorOrManuales("PROCESO_NO_ENCONTRADO", "Procesamiento no encontrado.", 404);
      res.json({ procesamiento: proceso });
    })
  );

  /* ── Avisos ────────────────────────────────────────────────────────────── */

  r.get(
    "/avisos",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      res.json({ avisos: await repo.listarAvisos(contextoDe(req).empresaId, req.query.todos === "1") });
    })
  );

  /**
   * «Avisar al responsable».
   *
   * Hoy sólo marca el aviso como notificado y lo deja en el histórico: el
   * encargo pide expresamente no estrenar integraciones externas todavía. El
   * canal se guarda en la fila, así que añadir WhatsApp o correo es escribir
   * el emisor aquí, sin tocar la tabla ni la pantalla.
   */
  r.post(
    "/avisos/:id/notificar",
    exigirPermiso("or-manuales.aviso.gestionar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const aviso = await repo.marcarAviso(ctx.empresaId, String(req.params.id), "NOTIFICADO");
      if (!aviso) throw new ErrorOrManuales("AVISO_NO_ENCONTRADO", "Aviso no encontrado.", 404);
      await repo.registrarEvento({
        empresaId: ctx.empresaId,
        blocId: aviso.blocId,
        accion: "AVISO_NOTIFICADO",
        detalle: { aviso: aviso.id, responsable: aviso.responsableNombre, canal: aviso.canal },
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre,
      });
      res.json({ aviso });
    })
  );

  r.post(
    "/avisos/:id/resolver",
    exigirPermiso("or-manuales.aviso.gestionar"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const aviso = await repo.marcarAviso(ctx.empresaId, String(req.params.id), "RESUELTO");
      if (!aviso) throw new ErrorOrManuales("AVISO_NO_ENCONTRADO", "Aviso no encontrado.", 404);
      res.json({ aviso });
    })
  );

  /* ── Búsqueda e histórico ──────────────────────────────────────────────── */

  r.get(
    "/buscar",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      res.json(await servicio.buscar(contextoDe(req), texto(req.query.q)));
    })
  );

  r.get(
    "/historico",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      res.json({
        eventos: await repo.listarEventos(ctx.empresaId, {
          blocId: texto(req.query.blocId) || undefined,
          limite: 300,
        }),
      });
    })
  );

  /* ── Configuración ─────────────────────────────────────────────────────── */

  r.get(
    "/config",
    exigirPermiso("or-manuales.view"),
    ruta(async (req, res) => {
      res.json({ config: await leerConfiguracion(contextoDe(req).empresaId) });
    })
  );

  r.put(
    "/config",
    exigirPermiso("or-manuales.config.manage"),
    ruta(async (req, res) => {
      const ctx = contextoDe(req);
      const cuerpo = req.body ?? {};
      const cambios: Parameters<typeof guardarConfiguracion>[1] = {};

      if (cuerpo.zona !== undefined) {
        const z = cuerpo.zona as ZonaOcr;
        const zona = { x: Number(z?.x), y: Number(z?.y), ancho: Number(z?.ancho), alto: Number(z?.alto) };
        if (!zonaValida(zona)) {
          throw new ErrorOrManuales(
            "ZONA_INVALIDA",
            "La zona de OCR se expresa en fracciones de 0 a 1 y tiene que caber dentro de la página."
          );
        }
        cambios.zona = zona;
      }
      if (cuerpo.umbralAutomatico !== undefined) cambios.umbralAutomatico = porcentaje(cuerpo.umbralAutomatico, "El umbral de archivo automático");
      if (cuerpo.umbralRevision !== undefined) cambios.umbralRevision = porcentaje(cuerpo.umbralRevision, "El umbral de revisión");
      if (cuerpo.orPorBloc !== undefined) cambios.orPorBloc = entero(cuerpo.orPorBloc, "Las OR por bloc");
      if (cuerpo.ocrConIa !== undefined) cambios.ocrConIa = Boolean(cuerpo.ocrConIa);

      const config = await guardarConfiguracion(ctx.empresaId, cambios);
      await registrarAuditoria({
        empresaId: ctx.empresaId,
        userId: ctx.userId,
        accion: "or_manuales.config.guardar",
        entidad: "orm_config",
        detalle: cambios,
        ip: ctx.ip,
      });
      res.json({ config });
    })
  );

  return r;
}

function porcentaje(v: unknown, que: string): number {
  const n = typeof v === "number" ? v : Number(texto(v));
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw new ErrorOrManuales("NUMERO_INVALIDO", `${que} es un porcentaje entre 0 y 100.`);
  }
  return n;
}
