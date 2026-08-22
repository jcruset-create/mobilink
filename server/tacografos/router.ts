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

  r.post(
    "/expedientes/:id/anular",
    exigirPermiso("tacografos.expediente.annul"),
    ruta(async (req, res) => {
      const ctx = req.authCtx!;
      const e = await repo.anularExpediente(ctx.empresaId, String(req.params.id));
      res.json({ expediente: conCalculados(e) });
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
