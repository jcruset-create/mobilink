/**
 * API interna de calidad: la bandeja, el detalle y las acciones.
 *
 * ── Los permisos ────────────────────────────────────────────────────────────
 *
 * Dos guardas, no una:
 *
 *  · **Lectura de una asistencia** (`guardaOperario`) — el bloque Satisfaction
 *    de la ficha. Quien ya puede ver la asistencia puede ver su valoración; no
 *    tiene sentido enseñarle el servicio y esconderle qué opinó el cliente.
 *  · **Bandeja y acciones** (`guardaSupervisor`) — administrar expedientes es
 *    otra cosa. Un operario no reasigna casos ni los cierra.
 *
 * Los roles salen del token, nunca del cuerpo de la petición.
 *
 * ── Y el taller ─────────────────────────────────────────────────────────────
 *
 * Siempre de `assistPanelUser`, jamás de la URL ni del cuerpo. Un caso de otro
 * taller devuelve 404, igual que en documentos: un 403 confirmaría que existe.
 */

import { Router, json, type RequestHandler, type Request, type Response } from "express";

import {
  ACCIONES_CASO, ESTADOS_CASO, MOTIVOS_CASO, PRIORIDADES, RESOLUCIONES_CASO,
  type EstadoCaso, type Prioridad,
} from "./dominio.ts";
import { detalleCaso, listarCasos, obtenerSatisfactionDeAsistencia } from "./calidad.ts";
import { calcularMetricas } from "./metricas.ts";
import {
  MAX_NOTA, anadirNota, asignarCaso, cambiarEstadoCaso, cambiarPrioridad, type Actor,
} from "./calidadServicio.ts";
import { ErrorSatisfaction } from "./servicio.ts";

function fallo(res: Response, e: unknown) {
  if (e instanceof ErrorSatisfaction) {
    const estado = e.codigo === "instancia_no_encontrada" ? 404
      : e.codigo === "transicion_invalida" ? 409 : 422;
    return res.status(estado).json({ error: e.message, code: e.codigo });
  }
  console.error("[Calidad] error:", (e as Error)?.message);
  return res.status(500).json({ error: "Error en la bandeja de calidad" });
}

/** El taller del usuario. `null` para un administrador de plataforma. */
function tallerDe(req: Request): string | null {
  const t = (req as unknown as { assistPanelUser?: { tallerId?: number | null } })
    .assistPanelUser?.tallerId;
  return t == null ? null : String(t);
}

function actorDe(req: Request): Actor {
  const ctx = (req as unknown as { authCtx?: { userId?: string; nombre?: string; empresaId?: string } })
    .authCtx;
  return {
    userId: ctx?.userId ?? null,
    nombre: ctx?.nombre ?? null,
    empresaId: ctx?.empresaId ?? "assist",
    ip: req.ip,
  };
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* ── Periodo del cuadro de mando ─────────────────────────────────────────── */

const DIA = 86_400_000;
/** Por defecto, el último mes. Es lo que se mira a diario. */
export const PERIODO_POR_DEFECTO_DIAS = 30;
/**
 * Tope duro del rango.
 *
 * No es una preferencia de producto: sin él, un `from=0` en la URL barre el
 * histórico entero de todas las tablas en cada carga de pantalla. Un año largo
 * cubre cualquier comparativa razonable y deja las consultas acotadas.
 */
export const PERIODO_MAXIMO_DIAS = 400;

type Periodo = { desdeMs: number; hastaMs: number };

/**
 * Lee `from`/`to` de la query.
 *
 * Acepta epoch en milisegundos o `YYYY-MM-DD`. Devuelve un mensaje en vez de
 * corregir por su cuenta: si alguien pide un rango imposible es mejor decírselo
 * que enseñarle cifras de un periodo que no ha pedido.
 */
export function interpretarPeriodo(
  from: unknown, to: unknown, ahoraMs: number,
): { periodo: Periodo } | { error: string } {
  const lee = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const t = String(v).trim();
    if (/^\d{13}$/.test(t)) return Number(t);
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
      const ms = Date.parse(`${t}T00:00:00.000Z`);
      return Number.isFinite(ms) ? ms : null;
    }
    return null;
  };

  const bruto = { from: from ?? null, to: to ?? null };
  if (bruto.from != null && bruto.from !== "" && lee(bruto.from) == null) {
    return { error: "El parámetro «from» debe ser epoch en ms o YYYY-MM-DD" };
  }
  if (bruto.to != null && bruto.to !== "" && lee(bruto.to) == null) {
    return { error: "El parámetro «to» debe ser epoch en ms o YYYY-MM-DD" };
  }

  const hastaMs = lee(bruto.to) ?? ahoraMs;
  // Una fecha suelta en «to» se entiende como el día entero, no como su medianoche.
  const hastaFinal = /^\d{4}-\d{2}-\d{2}$/.test(String(bruto.to ?? ""))
    ? hastaMs + DIA - 1 : hastaMs;
  const desdeMs = lee(bruto.from) ?? hastaFinal - PERIODO_POR_DEFECTO_DIAS * DIA;

  if (desdeMs >= hastaFinal) return { error: "El periodo pedido está al revés o vacío" };
  if (hastaFinal - desdeMs > PERIODO_MAXIMO_DIAS * DIA) {
    return { error: `El periodo no puede pasar de ${PERIODO_MAXIMO_DIAS} días` };
  }
  return { periodo: { desdeMs, hastaMs: hastaFinal } };
}

export function createCalidadRouter(
  guardaOperario: RequestHandler, guardaSupervisor: RequestHandler,
): Router {
  const router = Router();
  // 8 kB: lo más grande que se manda aquí es una nota de 4.000 caracteres.
  router.use(json({ limit: "8kb" }));

  /** Las listas cerradas, para que el front no las copie. */
  router.get("/opciones", guardaOperario, (_req, res) => {
    res.json({
      estados: ESTADOS_CASO, prioridades: PRIORIDADES, motivos: MOTIVOS_CASO,
      resoluciones: RESOLUCIONES_CASO, acciones: ACCIONES_CASO, maxNota: MAX_NOTA,
    });
  });

  /* ── Ficha de asistencia ────────────────────────────────────────────── */

  router.get("/asistencias/:id/satisfaction", guardaOperario, async (req, res) => {
    try {
      res.json(await obtenerSatisfactionDeAsistencia(Number(req.params.id), tallerDe(req)));
    } catch (e) { fallo(res, e); }
  });

  /* ── Cuadro de mando ────────────────────────────────────────────────── */

  /**
   * Métricas agregadas del periodo.
   *
   * Supervisor, como la bandeja: son datos de todo el taller, no de un
   * servicio concreto. El taller sale de `assistPanelUser` y NUNCA de la query
   * —aceptarlo por URL sería dejar que cualquiera leyera las cifras de otro—.
   */
  router.get("/metricas", guardaSupervisor, async (req, res) => {
    try {
      const q = req.query;
      const p = interpretarPeriodo(q.from ?? q.desde, q.to ?? q.hasta, Date.now());
      if ("error" in p) return res.status(400).json({ error: p.error });

      res.json(await calcularMetricas({
        desdeMs: p.periodo.desdeMs, hastaMs: p.periodo.hastaMs,
        clienteId: num(q.clientId ?? q.clienteId),
        proveedorTallerId: num(q.providerId ?? q.proveedorId),
      }, tallerDe(req)));
    } catch (e) { fallo(res, e); }
  });

  /* ── Bandeja ────────────────────────────────────────────────────────── */

  router.get("/casos", guardaSupervisor, async (req, res) => {
    try {
      const q = req.query;
      res.json(await listarCasos(tallerDe(req), {
        desdeMs: num(q.desde), hastaMs: num(q.hasta),
        clienteId: num(q.clienteId), proveedorTallerId: num(q.proveedorId),
        recipientRole: (q.rol as string) || null,
        motivo: (q.motivo as string) || null,
        prioridad: (q.prioridad as string) || null,
        estado: (q.estado as string) || null,
        responsable: (q.responsable as string) || null,
        soloAbiertos: q.abiertos === "1",
        pagina: num(q.pagina) ?? 1,
        porPagina: num(q.porPagina) ?? 25,
      }));
    } catch (e) { fallo(res, e); }
  });

  router.get("/casos/:id", guardaSupervisor, async (req, res) => {
    try {
      const d = await detalleCaso(Number(req.params.id), tallerDe(req));
      // 404 y no 403: un 403 confirmaría que el caso existe en otro taller.
      if (!d) return res.status(404).json({ error: "Caso no encontrado" });
      res.json(d);
    } catch (e) { fallo(res, e); }
  });

  /* ── Acciones ───────────────────────────────────────────────────────── */

  /**
   * Un solo PATCH para asignar, priorizar y mover de estado.
   *
   * Un endpoint por campo habría dado tres rutas casi idénticas y, sobre todo,
   * tres peticiones para «me lo asigno y lo paso a revisión», que es lo que
   * hace un supervisor en un clic.
   */
  router.patch("/casos/:id", guardaSupervisor, async (req, res) => {
    try {
      const casoId = Number(req.params.id);
      const tenantId = tallerDe(req);
      const actor = actorDe(req);
      const b = req.body ?? {};

      if ("responsable" in b) {
        await asignarCaso({
          casoId, tenantId, responsable: b.responsable == null ? null : String(b.responsable), actor,
        });
      }
      if (b.prioridad) {
        await cambiarPrioridad({
          casoId, tenantId, prioridad: String(b.prioridad) as Prioridad,
          nota: b.nota ?? null, actor,
        });
      }
      if (b.estado) {
        await cambiarEstadoCaso({
          casoId, tenantId, estado: String(b.estado) as EstadoCaso,
          resolution: b.resolution ?? null, actionTaken: b.actionTaken ?? null,
          nota: b.nota ?? null, actor,
        });
      }

      const d = await detalleCaso(casoId, tenantId);
      if (!d) return res.status(404).json({ error: "Caso no encontrado" });
      res.json(d);
    } catch (e) { fallo(res, e); }
  });

  router.post("/casos/:id/notas", guardaSupervisor, async (req, res) => {
    try {
      await anadirNota({
        casoId: Number(req.params.id), tenantId: tallerDe(req),
        nota: String(req.body?.nota ?? ""), actor: actorDe(req),
      });
      const d = await detalleCaso(Number(req.params.id), tallerDe(req));
      res.json(d);
    } catch (e) { fallo(res, e); }
  });

  return router;
}
