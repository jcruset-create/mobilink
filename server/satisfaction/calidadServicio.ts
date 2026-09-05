/**
 * Las acciones sobre un expediente de calidad.
 *
 * ── Dos registros, y no es duplicar ─────────────────────────────────────────
 *
 * Cada acción deja dos rastros distintos, tal como se decidió en 1B:
 *
 *  · `quality_case_events` — la CRONOLOGÍA que se lee. De `IN_REVIEW` a
 *    `PENDING_PROVIDER`, quién y con qué nota. Es lo que se pinta en la ficha.
 *  · `app_auditoria` — la traza de SEGURIDAD. Quién tocó qué y desde dónde,
 *    con el mismo formato que el resto del panel.
 *
 * No son lo mismo. La primera cuenta la historia del caso; la segunda responde
 * a «quién cambió esto» seis meses después, y vive en una tabla que no se puede
 * modificar. La cronología va DENTRO de la transacción; la auditoría, fuera y
 * sin poder tumbar la operación, que es como la usa el resto del proyecto para
 * lo que no mueve dinero.
 *
 * ── Contra dos supervisores a la vez ────────────────────────────────────────
 *
 * Todas las mutaciones bloquean la fila con `FOR UPDATE` y comprueban el estado
 * ACTUAL antes de decidir. Dos supervisores que abran el mismo caso y pulsen a
 * la vez no se pisan: el segundo ve el estado que dejó el primero y, si su
 * transición ya no vale, se le dice — en vez de sobrescribir en silencio.
 */

import type { PoolClient } from "pg";

import pool from "../db.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import {
  ACCIONES_CASO, RESOLUCIONES_CASO, transicionCasoValida,
  type EstadoCaso, type Prioridad,
} from "./dominio.ts";
import { ErrorSatisfaction } from "./servicio.ts";

/** Los estados en los que un caso sigue vivo. */
const ABIERTOS: EstadoCaso[] = ["NEW", "IN_REVIEW", "PENDING_PROVIDER", "PENDING_CUSTOMER"];

export const MAX_NOTA = 4000;

export type Actor = {
  userId?: string | null;
  nombre?: string | null;
  ip?: string;
  empresaId?: string;
};

export type TipoEventoCaso =
  | "CREATED" | "ASSIGNED" | "PRIORITY_CHANGED" | "STATUS_CHANGED"
  | "NOTE_ADDED" | "RESOLUTION_SET" | "RESOLVED" | "CLOSED" | "REOPENED";

async function enTransaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Lee y bloquea el caso, comprobando el tenant en el mismo WHERE.
 *
 * Que el tenant vaya en la consulta y no en un `if` posterior es lo que hace
 * que un caso ajeno sea indistinguible de uno inexistente.
 */
async function bloquear(c: PoolClient, casoId: number, tenantId: string | null) {
  const r = await c.query(
    `SELECT id, status, priority, "assigneeUserId", "assistanceId"
       FROM quality_cases
      WHERE id = $1 AND ($2::text IS NULL OR "tenantId" = $2)
      FOR UPDATE`,
    [casoId, tenantId],
  );
  if (!r.rows.length) {
    throw new ErrorSatisfaction("instancia_no_encontrada", "Caso no encontrado.");
  }
  return r.rows[0];
}

async function anotar(c: PoolClient, p: {
  casoId: number; tipo: TipoEventoCaso; actor: Actor;
  de?: string | null; a?: string | null; nota?: string | null; ahoraMs: number;
}) {
  await c.query(
    `INSERT INTO quality_case_events
       ("qualityCaseId","eventType","actorType","actorId","actorName",
        "fromValue","toValue",note,"occurredAtMs","createdAtMs")
     VALUES ($1,$2,'user',$3,$4,$5,$6,$7,$8,$8)`,
    [p.casoId, p.tipo, p.actor.userId ?? null, p.actor.nombre ?? null,
     p.de ?? null, p.a ?? null, p.nota ?? null, p.ahoraMs],
  );
}

/**
 * La traza de seguridad. Best-effort: no puede tumbar la acción ya guardada.
 *
 * `app_auditoria.empresa_id` es un UUID NOT NULL, así que sin empresa en el
 * contexto NO se escribe. La alternativa —inventarse un valor— haría que cada
 * INSERT fallara por sintaxis y `registrarAuditoria` se lo tragara: quedaría
 * una auditoría vacía y nadie se enteraría hasta necesitarla.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function auditar(accion: string, casoId: number, actor: Actor, detalle?: unknown) {
  if (!actor.empresaId || !UUID.test(actor.empresaId)) {
    console.warn(`[Calidad] sin empresa en el contexto: no se audita ${accion} del caso ${casoId}`);
    return;
  }
  void registrarAuditoria({
    empresaId: actor.empresaId,
    userId: actor.userId ?? null,
    accion: `satisfaction.calidad.${accion}`,
    entidad: "quality_cases",
    entidadId: String(casoId),
    detalle,
    ip: actor.ip,
  });
}

function texto(v: unknown, max: number): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.length > max) {
    throw new ErrorSatisfaction("respuesta_invalida", `El texto supera los ${max} caracteres.`);
  }
  return s;
}

/* ── Asignar ─────────────────────────────────────────────────────────────── */

export async function asignarCaso(p: {
  casoId: number; tenantId: string | null; responsable: string | null;
  actor: Actor; ahoraMs?: number;
}): Promise<void> {
  const ahora = p.ahoraMs ?? Date.now();
  const responsable = p.responsable == null ? null : texto(p.responsable, 200);

  await enTransaccion(async (c) => {
    const actual = await bloquear(c, p.casoId, p.tenantId);
    if (String(actual.assigneeUserId ?? "") === String(responsable ?? "")) return;

    await c.query(
      `UPDATE quality_cases SET "assigneeUserId" = $2, "updatedAtMs" = $3 WHERE id = $1`,
      [p.casoId, responsable, ahora],
    );
    await anotar(c, {
      casoId: p.casoId, tipo: "ASSIGNED", actor: p.actor,
      de: actual.assigneeUserId ?? null, a: responsable, ahoraMs: ahora,
    });
  });
  auditar("asignar", p.casoId, p.actor, { responsable });
}

/* ── Prioridad ───────────────────────────────────────────────────────────── */

export async function cambiarPrioridad(p: {
  casoId: number; tenantId: string | null; prioridad: Prioridad;
  nota?: string | null; actor: Actor; ahoraMs?: number;
}): Promise<void> {
  const ahora = p.ahoraMs ?? Date.now();
  if (!["NORMAL", "HIGH", "CRITICAL"].includes(p.prioridad)) {
    throw new ErrorSatisfaction("respuesta_invalida", "Prioridad desconocida.");
  }

  await enTransaccion(async (c) => {
    const actual = await bloquear(c, p.casoId, p.tenantId);
    if (String(actual.priority) === p.prioridad) return;

    await c.query(
      `UPDATE quality_cases SET priority = $2, "updatedAtMs" = $3 WHERE id = $1`,
      [p.casoId, p.prioridad, ahora],
    );
    await anotar(c, {
      casoId: p.casoId, tipo: "PRIORITY_CHANGED", actor: p.actor,
      de: String(actual.priority), a: p.prioridad,
      nota: texto(p.nota, MAX_NOTA), ahoraMs: ahora,
    });
  });
  auditar("prioridad", p.casoId, p.actor, { prioridad: p.prioridad });
}

/* ── Estado ──────────────────────────────────────────────────────────────── */

/**
 * Mueve el caso, validando la transición contra el estado REAL de la base.
 *
 * Al pasar a `RESOLVED` o `CLOSED` se exige conclusión: cerrar un expediente
 * sin decir en qué quedó lo convierte en una fila que nadie sabe interpretar
 * seis meses después, que es justo cuando se consulta.
 */
export async function cambiarEstadoCaso(p: {
  casoId: number; tenantId: string | null; estado: EstadoCaso;
  resolution?: string | null; actionTaken?: string | null;
  nota?: string | null; actor: Actor; ahoraMs?: number;
}): Promise<void> {
  const ahora = p.ahoraMs ?? Date.now();
  const cierra = p.estado === "RESOLVED" || p.estado === "CLOSED";

  if (cierra && p.resolution && !(RESOLUCIONES_CASO as readonly string[]).includes(p.resolution)) {
    throw new ErrorSatisfaction("respuesta_invalida", "Conclusión desconocida.");
  }
  if (p.actionTaken && !(ACCIONES_CASO as readonly string[]).includes(p.actionTaken)) {
    throw new ErrorSatisfaction("respuesta_invalida", "Acción desconocida.");
  }

  await enTransaccion(async (c) => {
    const actual = await bloquear(c, p.casoId, p.tenantId);
    const desde = String(actual.status) as EstadoCaso;

    if (desde === p.estado) return;
    if (!transicionCasoValida(desde, p.estado)) {
      throw new ErrorSatisfaction(
        "transicion_invalida", `No se puede pasar de ${desde} a ${p.estado}.`,
      );
    }

    // La conclusión hace falta al resolver o cerrar, salvo que el caso ya la
    // tuviera de un paso anterior (RESOLVED → CLOSED, por ejemplo).
    if (cierra && !p.resolution) {
      const previa = await c.query(`SELECT resolution FROM quality_cases WHERE id = $1`, [p.casoId]);
      if (!previa.rows[0]?.resolution) {
        throw new ErrorSatisfaction(
          "respuesta_invalida", "Hay que indicar en qué ha quedado el caso.",
        );
      }
    }

    await c.query(
      `UPDATE quality_cases
          SET status = $2,
              resolution = COALESCE($3, resolution),
              "actionTaken" = COALESCE($4, "actionTaken"),
              "updatedAtMs" = $5,
              "resolvedAtMs" = CASE WHEN $2 = 'RESOLVED' THEN COALESCE("resolvedAtMs", $5) ELSE "resolvedAtMs" END,
              "closedAtMs"   = CASE WHEN $2 = 'CLOSED'   THEN COALESCE("closedAtMs", $5)   ELSE "closedAtMs" END
        WHERE id = $1`,
      [p.casoId, p.estado, p.resolution ?? null, p.actionTaken ?? null, ahora],
    );

    if (p.resolution) {
      await anotar(c, {
        casoId: p.casoId, tipo: "RESOLUTION_SET", actor: p.actor,
        a: p.resolution, nota: p.actionTaken ?? null, ahoraMs: ahora,
      });
    }

    /*
     * Un tipo de evento propio para resolver, cerrar y reabrir. Podrían ser
     * todos `STATUS_CHANGED`, pero la cronología se lee de un vistazo y esos
     * tres son los hitos que se buscan.
     */
    const tipo: TipoEventoCaso =
      p.estado === "RESOLVED" ? "RESOLVED"
      : p.estado === "CLOSED" ? "CLOSED"
      : desde === "RESOLVED" ? "REOPENED"
      : "STATUS_CHANGED";

    await anotar(c, {
      casoId: p.casoId, tipo, actor: p.actor,
      de: desde, a: p.estado, nota: texto(p.nota, MAX_NOTA), ahoraMs: ahora,
    });
  });

  auditar("estado", p.casoId, p.actor, {
    estado: p.estado, resolution: p.resolution ?? null, actionTaken: p.actionTaken ?? null,
  });
}

/* ── Notas ───────────────────────────────────────────────────────────────── */

/**
 * Añade una nota interna.
 *
 * **Interna de verdad**: no sale por ninguna ruta pública. La miniweb no lee
 * `quality_case_events` ni sabe que existe.
 */
export async function anadirNota(p: {
  casoId: number; tenantId: string | null; nota: string; actor: Actor; ahoraMs?: number;
}): Promise<void> {
  const ahora = p.ahoraMs ?? Date.now();
  const nota = texto(p.nota, MAX_NOTA);
  if (!nota) throw new ErrorSatisfaction("respuesta_invalida", "La nota está vacía.");

  await enTransaccion(async (c) => {
    await bloquear(c, p.casoId, p.tenantId);
    await c.query(`UPDATE quality_cases SET "updatedAtMs" = $2 WHERE id = $1`, [p.casoId, ahora]);
    await anotar(c, { casoId: p.casoId, tipo: "NOTE_ADDED", actor: p.actor, nota, ahoraMs: ahora });
  });
  // La nota NO va en la auditoría: puede llevar datos del cliente y ya está
  // guardada en la cronología. Aquí basta con que conste que alguien anotó.
  auditar("nota", p.casoId, p.actor, { caracteres: nota.length });
}

export { ABIERTOS };
