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
