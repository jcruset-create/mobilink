/**
 * Anotar y leer el diario de una asistencia.
 *
 * ── Dos reglas ──────────────────────────────────────────────────────────────
 *
 * 1. **Anotar nunca tumba la operación.** `registrarEvento` no lanza: si el
 *    diario falla, el servicio sigue. Perder una línea del histórico es
 *    molesto; impedir que una grúa salga porque no se pudo escribir un log es
 *    inaceptable. Es el mismo criterio que ya usa `auditConnect`.
 *
 *    La excepción es `registrarEnTransaccion`, que sí forma parte de la
 *    transacción de quien lo llama: se usa donde el evento y el hecho tienen
 *    que existir o no existir juntos.
 *
 * 2. **La timeline se construye desde aquí, no se guarda en paralelo.** Si
 *    alguien vuelve a mantener una lista de hitos a mano, las dos se
 *    desincronizan y nadie sabe cuál mirar.
 */

import crypto from "node:crypto";
import type { PoolClient } from "pg";

import db from "../db.ts";
import {
  ETIQUETA,
  esActor,
  esTecnico,
  esTipoEvento,
  limpiarPayload,
  type Actor,
  type TipoEvento,
} from "./tipos.ts";

export type Anotacion = {
  system: "assist" | "central";
  tenantId?: string | number | null;
  assistanceId: string | number;
  correlationId?: string | null;
  eventType: TipoEvento;
  originSystem?: string | null;
  originTenantId?: string | null;
  actorType?: Actor;
  actorId?: string | number | null;
  actorName?: string | null;
  /** Cuándo OCURRIÓ. Por defecto ahora, pero un aviso con retraso trae el suyo. */
  occurredAtMs?: number;
  payload?: unknown;
  /**
   * Clave de deduplicación. Obligatoria de facto para todo lo que venga de
   * fuera: los webhooks se entregan al menos una vez y el mismo hecho llega
   * varias veces.
   */
  dedupeKey?: string | null;
};

function aFila(a: Anotacion) {
  const now = Date.now();
  return [
    crypto.randomUUID(),
    a.system,
    a.tenantId == null ? null : String(a.tenantId),
    String(a.assistanceId),
    a.correlationId ?? null,
    a.eventType,
    a.originSystem ?? a.system,
    a.originTenantId ?? null,
    esActor(a.actorType) ? a.actorType : "system",
    a.actorId == null ? null : String(a.actorId),
    a.actorName ?? null,
    a.occurredAtMs ?? now,
    JSON.stringify(limpiarPayload(a.payload)),
    a.dedupeKey ?? null,
    now,
  ];
}

const INSERT = `
  INSERT INTO assistance_events
    (uuid, "sourceSystem", "tenantId", "assistanceId", "correlationId", "eventType",
     "originSystem", "originTenantId", "actorType", "actorId", "actorName",
     "occurredAtMs", payload, "dedupeKey", "createdAtMs")
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  ON CONFLICT DO NOTHING
  RETURNING id`;

/**
 * Anota un evento. No lanza nunca.
 *
 * Devuelve `true` si se escribió y `false` si era repetido o falló, para que
 * quien llama pueda decidir si actúa. Es lo que hace idempotente al receptor
 * de webhooks: el segundo aviso idéntico devuelve `false` y no se vuelve a
 * mover nada.
 */
export async function registrarEvento(a: Anotacion): Promise<boolean> {
  if (!esTipoEvento(a.eventType)) {
    console.error(`[EventLog] tipo de evento desconocido: ${a.eventType}`);
    return false;
  }
  try {
    const r = await db.query(INSERT, aFila(a));
    return (r.rowCount ?? 0) > 0;
  } catch (e: any) {
    console.error("[EventLog] no se pudo anotar el evento:", e?.message);
    return false;
  }
}

/**
 * Anota dentro de la transacción de quien llama.
 *
 * Aquí SÍ puede lanzar, y es lo que se quiere: se usa donde el evento y el
 * hecho han de existir juntos o no existir. Si esto falla, la operación se
 * deshace entera.
 */
export async function registrarEnTransaccion(cliente: PoolClient, a: Anotacion): Promise<void> {
  if (!esTipoEvento(a.eventType)) throw new Error(`Tipo de evento desconocido: ${a.eventType}`);
  await cliente.query(INSERT, aFila(a));
}

/* ── Lectura ─────────────────────────────────────────────────────────────── */

export type EventoApi = {
  uuid: string;
  tipo: TipoEvento;
  etiqueta: string;
  sistema: string;
  origen: string | null;
  actor: string;
  actorNombre: string | null;
  occurredAtMs: number;
  payload: Record<string, unknown>;
  tecnico: boolean;
};

function aApi(r: any): EventoApi {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(r.payload || "{}"); } catch { payload = {}; }
  return {
    uuid: r.uuid,
    tipo: r.eventType,
    etiqueta: ETIQUETA[r.eventType as TipoEvento] ?? r.eventType,
    sistema: r.sourceSystem,
    origen: r.originSystem ?? null,
    actor: r.actorType,
    actorNombre: r.actorName ?? null,
    occurredAtMs: Number(r.occurredAtMs),
    payload,
    tecnico: esTecnico(r.eventType),
  };
}

export type OpcionesTimeline = {
  /** Incluir los eventos técnicos (fallos y recuperaciones de sincronización). */
  incluirTecnicos?: boolean;
  /**
   * Seguir el hilo a las otras plataformas por las que ha pasado.
   *
   * Apagado por defecto: la timeline de una asistencia de Assist enseña lo que
   * Assist sabe. Encenderlo trae también lo que anotó Central, que es útil para
   * investigar pero puede confundir en la pantalla del día a día.
   */
  cadenaCompleta?: boolean;
};

/**
 * La timeline de una asistencia, en orden cronológico de lo que OCURRIÓ.
 *
 * Ordenada por `occurredAtMs` y no por id: un aviso que llega con retraso tiene
 * que aparecer en su sitio, no al final. El id desempata cuando dos eventos
 * comparten milisegundo.
 */
export async function timelineDe(
  system: "assist" | "central",
  assistanceId: string | number,
  op: OpcionesTimeline = {},
): Promise<EventoApi[]> {
  const params: unknown[] = [system, String(assistanceId)];
  let where = `("sourceSystem" = $1 AND "assistanceId" = $2)`;

  if (op.cadenaCompleta) {
    where = `(${where} OR ("correlationId" IS NOT NULL AND "correlationId" IN (
                SELECT DISTINCT "correlationId" FROM assistance_events
                 WHERE "sourceSystem" = $1 AND "assistanceId" = $2
                   AND "correlationId" IS NOT NULL)))`;
  }
  if (!op.incluirTecnicos) {
    where += ` AND "eventType" NOT IN ('SYNC_FAILED','SYNC_RECOVERED')`;
  }

  const r = await db.query(
    `SELECT * FROM assistance_events WHERE ${where} ORDER BY "occurredAtMs", id`,
    params,
  );
  return r.rows.map(aApi);
}

/** Todos los eventos de una cadena, aunque haya pasado por tres plataformas. */
export async function timelineDeCorrelacion(correlationId: string): Promise<EventoApi[]> {
  const r = await db.query(
    `SELECT * FROM assistance_events WHERE "correlationId" = $1 ORDER BY "occurredAtMs", id`,
    [correlationId],
  );
  return r.rows.map(aApi);
}

/**
 * Cuándo ocurrió por primera vez cada hito.
 *
 * Se usa para responder «¿cuándo se aceptó?» sin recorrer la timeline entera
 * en cada pantalla, y para calcular tiempos entre hitos. Se toma el PRIMERO de
 * cada tipo: si un servicio se reasigna, la hora de la primera asignación es la
 * que cuenta para el SLA.
 */
export async function hitosDe(
  system: "assist" | "central",
  assistanceId: string | number,
): Promise<Partial<Record<TipoEvento, number>>> {
  const r = await db.query(
    `SELECT "eventType", MIN("occurredAtMs") AS primero
       FROM assistance_events
      WHERE "sourceSystem" = $1 AND "assistanceId" = $2
      GROUP BY "eventType"`,
    [system, String(assistanceId)],
  );
  const fuera: Partial<Record<TipoEvento, number>> = {};
  for (const fila of r.rows) fuera[fila.eventType as TipoEvento] = Number(fila.primero);
  return fuera;
}
