/**
 * Connect Pro — lógica de dominio: máquina de estados, motor de asignación,
 * inyección en el core (roadside_assistances) y sincronización de estados.
 *
 * Al vivir en el mismo monolito y misma base de datos que el core, la
 * "inyección" es un INSERT nativo y la sincronización un polling ligero
 * sobre las asistencias enlazadas (ver worker.ts). El técnico no nota
 * ninguna diferencia: su asistencia es una roadside_assistance normal.
 */

import crypto from "node:crypto";
import db from "../db.ts";
import { enqueueWebhookEvent } from "./webhooks.ts";

// ---------------------------------------------------------------------------
// Máquina de estados
// ---------------------------------------------------------------------------

export const CONNECT_STATUSES = [
  "pending", "searching", "assigned", "technician_assigned", "en_route",
  "arrived", "in_progress", "finished", "cancelled", "no_coverage", "assignment_failed",
] as const;
export type ConnectStatus = (typeof CONNECT_STATUSES)[number];

const TRANSITIONS: Record<string, ConnectStatus[]> = {
  pending: ["searching", "cancelled"],
  searching: ["assigned", "no_coverage", "assignment_failed", "cancelled"],
  assigned: ["technician_assigned", "en_route", "cancelled"],
  technician_assigned: ["en_route", "arrived", "cancelled"],
  en_route: ["arrived", "in_progress", "cancelled"],
  arrived: ["in_progress", "finished", "cancelled"],
  in_progress: ["finished", "cancelled"],
  finished: [],
  cancelled: [],
  no_coverage: ["searching", "cancelled"],
  assignment_failed: ["searching", "cancelled"],
};

/** Estados del core → estados Connect. */
const CORE_STATUS_MAP: Record<string, ConnectStatus> = {
  pendiente: "assigned",
  asignada: "technician_assigned",
  en_camino: "en_route",
  en_punto: "arrived",
  inicio_reparacion: "in_progress",
  finalizada: "finished",
  en_camino_base: "finished",
  llegada_taller: "finished",
  redirigida: "in_progress",
  cancelada: "cancelled",
};

const STATUS_RANK: Record<string, number> = Object.fromEntries(
  CONNECT_STATUSES.map((s, i) => [s, i]),
);

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Transición de estado no permitida: ${from} → ${to}`);
  }
}

export async function transition(
  assistanceId: number,
  toStatus: ConnectStatus,
  actorType: "system" | "api" | "core" | "user",
  reason?: string,
): Promise<void> {
  const now = Date.now();
  const r = await db.query(`SELECT status, "partnerId", uuid FROM connect_assistances WHERE id = $1`, [assistanceId]);
  const row = r.rows[0];
  if (!row) throw new Error(`Asistencia Connect ${assistanceId} no encontrada`);
  const from: string = row.status;
  if (from === toStatus) return;
  if (!TRANSITIONS[from]?.includes(toStatus)) throw new InvalidTransitionError(from, toStatus);

  await db.query(`UPDATE connect_assistances SET status = $1, "updatedAtMs" = $2 WHERE id = $3`, [toStatus, now, assistanceId]);
  await db.query(
    `INSERT INTO connect_status_history ("assistanceId", "fromStatus", "toStatus", "actorType", reason, "occurredAtMs")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [assistanceId, from, toStatus, actorType, reason ?? null, now],
  );
  await enqueueWebhookEvent(row.partnerId, `assistance.${toStatus}`, {
    assistance_id: row.uuid,
    from_status: from,
    to_status: toStatus,
    reason: reason ?? null,
    occurred_at: new Date(now).toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------

export interface CreateAssistanceInput {
  partnerId: number;
  externalReference?: string;
  idempotencyKey?: string;
  priority?: string;
  serviceType?: string;
  description?: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
  customerName?: string;
  customerPhone?: string;
  vehicle?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export async function createAssistance(input: CreateAssistanceInput): Promise<{ row: any; duplicated: boolean }> {
  const now = Date.now();

  if (input.idempotencyKey) {
    const dup = await db.query(
      `SELECT * FROM connect_assistances WHERE "partnerId" = $1 AND "idempotencyKey" = $2`,
      [input.partnerId, input.idempotencyKey],
    );
    if (dup.rows[0]) return { row: dup.rows[0], duplicated: true };
  }

  const r = await db.query(
    `INSERT INTO connect_assistances
       (uuid, "partnerId", "externalReference", "idempotencyKey", status, priority, "serviceType",
        description, latitude, longitude, address, "customerName", "customerPhone", vehicle,
        "externalMetadata", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)
     RETURNING *`,
    [
      crypto.randomUUID(),
      input.partnerId,
      input.externalReference ?? null,
      input.idempotencyKey ?? null,
      input.priority === "urgente" || input.priority === "high" || input.priority === "critical" ? "urgente" : "normal",
      String(input.serviceType || "other"),
      input.description ?? null,
      input.latitude ?? null,
      input.longitude ?? null,
      String(input.address || "").trim(),
      String(input.customerName || "").trim(),
      String(input.customerPhone || "").trim(),
      JSON.stringify(input.vehicle ?? {}),
      JSON.stringify(input.metadata ?? {}),
      now,
    ],
  );
  const row = r.rows[0];
  await db.query(
    `INSERT INTO connect_status_history ("assistanceId", "fromStatus", "toStatus", "actorType", "occurredAtMs")
     VALUES ($1, NULL, 'pending', 'api', $2)`,
    [row.id, now],
  );
  return { row, duplicated: false };
}

// ---------------------------------------------------------------------------
// Motor de asignación (filtrado duro + scoring, Docs cap. 6 adaptado)
// ---------------------------------------------------------------------------

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface WorkshopCandidate {
  workshopId: number;
  name: string;
  distanceKm: number;
  etaMinutes: number;
  score: number;
  explanation: string;
}

/** ETA aproximada por carretera: haversine × 1,4 a 60 km/h medios + 5 min de salida. */
function estimateEtaMinutes(distanceKm: number): number {
  return Math.round((distanceKm * 1.4 / 60) * 60 + 5);
}

export async function findCandidates(
  latitude: number,
  longitude: number,
  serviceType: string,
): Promise<WorkshopCandidate[]> {
  const r = await db.query(`SELECT * FROM connect_workshops WHERE "connectStatus" = 'active'`);
  const candidates: WorkshopCandidate[] = [];
  for (const w of r.rows) {
    const services: string[] = JSON.parse(w.services || "[]");
    if (serviceType !== "other" && services.length > 0 && !services.includes(serviceType)) continue;
    const distanceKm = haversineKm(latitude, longitude, w.latitude, w.longitude);
    if (distanceKm > Number(w.radiusKm || 60)) continue;
    const etaMinutes = estimateEtaMinutes(distanceKm);
    // Score = 70 % idoneidad (ETA normalizada a 90 min máx) + 30 % score histórico del taller
    const fit = Math.max(0, 1 - etaMinutes / 90);
    const score = Math.round((0.7 * fit + 0.3 * (Number(w.currentScore) / 100)) * 100);
    candidates.push({
      workshopId: w.id,
      name: w.name,
      distanceKm: Math.round(distanceKm * 10) / 10,
      etaMinutes,
      score,
      explanation: `${w.name}: ${Math.round(distanceKm)} km (ETA ~${etaMinutes} min), score de red ${Math.round(w.currentScore)}/100`,
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * Asigna la asistencia: busca candidatos, elige el mejor e inyecta la
 * asistencia nativa en el core. Se invoca tras crear (modo auto) o al
 * confirmar taller (modo manual).
 */
export async function assignAssistance(assistanceId: number, forcedWorkshopId?: number): Promise<void> {
  const r = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [assistanceId]);
  const a = r.rows[0];
  if (!a) throw new Error(`Asistencia Connect ${assistanceId} no encontrada`);
  if (a.status !== "pending" && a.status !== "no_coverage" && a.status !== "assignment_failed") return;

  await transition(assistanceId, "searching", "system");

  let candidate: WorkshopCandidate | undefined;
  if (forcedWorkshopId) {
    const w = await db.query(`SELECT * FROM connect_workshops WHERE id = $1 AND "connectStatus" = 'active'`, [forcedWorkshopId]);
    if (!w.rows[0]) throw new Error("Taller no encontrado o no activo en la red Connect");
    const dist = a.latitude != null && a.longitude != null
      ? haversineKm(a.latitude, a.longitude, w.rows[0].latitude, w.rows[0].longitude)
      : 0;
    candidate = {
      workshopId: w.rows[0].id,
      name: w.rows[0].name,
      distanceKm: Math.round(dist * 10) / 10,
      etaMinutes: estimateEtaMinutes(dist),
      score: 100,
      explanation: `Asignación manual a ${w.rows[0].name}`,
    };
  } else {
    if (a.latitude == null || a.longitude == null) {
      await transition(assistanceId, "assignment_failed", "system", "Sin coordenadas: se requiere asignación manual");
      return;
    }
    const candidates = await findCandidates(a.latitude, a.longitude, a.serviceType);
    if (candidates.length === 0) {
      await transition(assistanceId, "no_coverage", "system", "Ningún taller activo cubre la zona/servicio");
      return;
    }
    candidate = candidates[0];
  }

  const coreId = await injectIntoCore(a, candidate.workshopId);
  await db.query(
    `UPDATE connect_assistances
        SET "workshopId" = $1, "coreAssistanceId" = $2, "assignmentExplanation" = $3, "updatedAtMs" = $4
      WHERE id = $5`,
    [candidate.workshopId, coreId, candidate.explanation, Date.now(), assistanceId],
  );
  await transition(assistanceId, "assigned", "system", candidate.explanation);
}

// ---------------------------------------------------------------------------
// Inyección en el core (equivalente monolítico del "Core Bridge")
// ---------------------------------------------------------------------------

async function injectIntoCore(a: any, connectWorkshopId: number): Promise<number> {
  const now = Date.now();
  const w = await db.query(`SELECT "coreWorkshopId" FROM connect_workshops WHERE id = $1`, [connectWorkshopId]);
  const vehicle = safeParse(a.vehicle);
  const description = [
    a.description || "",
    a.externalReference ? `Ref. externa: ${a.externalReference}` : "",
  ].filter(Boolean).join("\n");

  // Minimización de datos: externalMetadata NUNCA se inyecta al core.
  const r = await db.query(
    `INSERT INTO roadside_assistances
       ("workshopId", status, priority, "customerName", "customerPhone", address, latitude, longitude,
        plate, "vehicleDescription", "descripcionAveria", "trackingToken", notes, "createdAtMs", "updatedAtMs")
     VALUES ($1, 'pendiente', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
     RETURNING id`,
    [
      w.rows[0]?.coreWorkshopId ?? null,
      a.priority,
      a.customerName,
      a.customerPhone,
      a.address,
      a.latitude,
      a.longitude,
      String(vehicle.plate || "").toUpperCase(),
      [vehicle.make, vehicle.model].filter(Boolean).join(" ") || null,
      description || null,
      crypto.randomUUID().replace(/-/g, ""),
      `Connect Pro · ${a.uuid}`,
      now,
    ],
  );
  const coreId = r.rows[0].id;
  await db.query(
    `INSERT INTO roadside_assistance_events ("assistanceId", status, note, "createdBy", "createdAtMs")
     VALUES ($1, 'pendiente', 'Creada vía Mobilink Connect Pro', 'connect-pro', $2)`,
    [coreId, now],
  );
  return coreId;
}

function safeParse(value: unknown): any {
  try { return typeof value === "string" ? JSON.parse(value) : (value ?? {}); } catch { return {}; }
}

// ---------------------------------------------------------------------------
// Sincronización core → Connect (llamada por el worker cada pocos segundos)
// ---------------------------------------------------------------------------

export async function syncFromCore(): Promise<number> {
  const r = await db.query(
    `SELECT ca.id, ca.status AS connect_status, ra.status AS core_status,
            ra."assignedTechName", ra."cancelledAtMs"
       FROM connect_assistances ca
       JOIN roadside_assistances ra ON ra.id = ca."coreAssistanceId"
      WHERE ca.status NOT IN ('finished', 'cancelled', 'no_coverage')`,
  );
  let changed = 0;
  for (const row of r.rows) {
    const target = CORE_STATUS_MAP[row.core_status];
    if (!target || target === row.connect_status) continue;
    // Nunca retroceder (eventos duplicados o fuera de orden)
    if (STATUS_RANK[target] <= STATUS_RANK[row.connect_status] && target !== "cancelled") continue;
    try {
      // Saltos intermedios permitidos: aplicar estados puente si hiciera falta
      await applyForward(row.id, row.connect_status, target, row.assignedTechName);
      changed++;
    } catch (err: any) {
      console.error(`[Connect] sync asistencia ${row.id}: ${err?.message}`);
    }
  }
  return changed;
}

async function applyForward(id: number, from: ConnectStatus, target: ConnectStatus, techName?: string) {
  const path: ConnectStatus[] = ["assigned", "technician_assigned", "en_route", "arrived", "in_progress", "finished"];
  if (target === "cancelled") {
    await transition(id, "cancelled", "core", "Cancelada en el taller");
    return;
  }
  const fromIdx = path.indexOf(from);
  const toIdx = path.indexOf(target);
  if (toIdx === -1) return;
  for (let i = fromIdx + 1; i <= toIdx; i++) {
    const reason = path[i] === "technician_assigned" && techName ? `Técnico: ${techName}` : undefined;
    await transition(id, path[i], "core", reason);
  }
}
