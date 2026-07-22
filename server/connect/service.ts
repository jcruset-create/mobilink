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
import { publish } from "./bus.ts";
import { createAlert } from "./alerts.ts";

// ---------------------------------------------------------------------------
// Máquina de estados
// ---------------------------------------------------------------------------

export const CONNECT_STATUSES = [
  "draft", "pending", "searching", "awaiting_acceptance", "assigned", "technician_assigned",
  "en_route", "arrived", "in_progress", "finished", "cancelled", "no_coverage", "assignment_failed",
] as const;
export type ConnectStatus = (typeof CONNECT_STATUSES)[number];

const TRANSITIONS: Record<string, ConnectStatus[]> = {
  draft: ["pending", "cancelled"],
  pending: ["searching", "cancelled"],
  searching: ["awaiting_acceptance", "assigned", "no_coverage", "assignment_failed", "cancelled"],
  awaiting_acceptance: ["assigned", "searching", "cancelled"],
  assigned: ["technician_assigned", "en_route", "searching", "cancelled"],
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
  if (row.partnerId) {
    await enqueueWebhookEvent(row.partnerId, `assistance.${toStatus}`, {
      assistance_id: row.uuid,
      from_status: from,
      to_status: toStatus,
      reason: reason ?? null,
      occurred_at: new Date(now).toISOString(),
    });
  }
  publish({ kind: "status", assistanceId, status: toStatus });
  if (toStatus === "assignment_failed" || toStatus === "no_coverage") {
    await createAlert({
      type: toStatus,
      severity: "critical",
      title: toStatus === "no_coverage" ? `Asistencia #${assistanceId} sin cobertura` : `Asistencia #${assistanceId} sin proveedor`,
      body: reason ?? undefined,
      assistanceId,
    });
  }
}

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------

export interface CreateAssistanceInput {
  partnerId?: number | null;
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
  // Sprint 2 — creación manual desde el backoffice
  origin?: "manual" | "api" | "partner" | "import" | "reopen" | "derived" | "core";
  draft?: boolean;
  controlCenterId?: number | null;
  createdByUserId?: number | null;
  expedientNumber?: string | null;
  clientName?: string | null;
  requester?: Record<string, unknown>;
  locationDetails?: Record<string, unknown>;
  slaMinutes?: number | null;
}

export async function createAssistance(input: CreateAssistanceInput): Promise<{ row: any; duplicated: boolean }> {
  const now = Date.now();

  if (input.idempotencyKey && input.partnerId) {
    const dup = await db.query(
      `SELECT * FROM connect_assistances WHERE "partnerId" = $1 AND "idempotencyKey" = $2`,
      [input.partnerId, input.idempotencyKey],
    );
    if (dup.rows[0]) return { row: dup.rows[0], duplicated: true };
  }

  const initialStatus = input.draft ? "draft" : "pending";
  const origin = input.origin ?? "api";
  const r = await db.query(
    `INSERT INTO connect_assistances
       (uuid, "partnerId", "externalReference", "idempotencyKey", status, priority, "serviceType",
        description, latitude, longitude, address, "customerName", "customerPhone", vehicle,
        "externalMetadata", origin, "controlCenterId", "createdByUserId", "expedientNumber",
        "clientName", requester, "locationDetails", "slaMinutes", "slaDeadlineAtMs",
        "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$25)
     RETURNING *`,
    [
      crypto.randomUUID(),
      input.partnerId ?? null,
      input.externalReference ?? null,
      input.idempotencyKey ?? null,
      initialStatus,
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
      origin,
      input.controlCenterId ?? null,
      input.createdByUserId ?? null,
      input.expedientNumber ?? null,
      input.clientName ?? null,
      JSON.stringify(input.requester ?? {}),
      JSON.stringify(input.locationDetails ?? {}),
      input.slaMinutes ?? null,
      !input.draft && input.slaMinutes ? now + input.slaMinutes * 60_000 : null,
      now,
    ],
  );
  const row = r.rows[0];
  await db.query(
    `INSERT INTO connect_status_history ("assistanceId", "fromStatus", "toStatus", "actorType", "occurredAtMs")
     VALUES ($1, NULL, $2, $3, $4)`,
    [row.id, initialStatus, origin === "manual" ? "user" : "api", now],
  );
  return { row, duplicated: false };
}

/** Envía un borrador: valida mínimos, arranca el reloj SLA y pasa a pending. */
export async function submitDraft(assistanceId: number): Promise<void> {
  const r = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [assistanceId]);
  const a = r.rows[0];
  if (!a) throw new Error("Asistencia no encontrada");
  if (a.status !== "draft") throw new InvalidTransitionError(a.status, "pending");
  if (!a.customerName && !a.customerPhone) throw new Error("Faltan datos del cliente (nombre o teléfono)");
  if (!a.address && (a.latitude == null || a.longitude == null)) throw new Error("Falta la ubicación (dirección o coordenadas)");
  const now = Date.now();
  await db.query(
    `UPDATE connect_assistances
        SET "slaDeadlineAtMs" = CASE WHEN "slaMinutes" IS NOT NULL THEN $1 + "slaMinutes" * 60000 ELSE NULL END,
            "updatedAtMs" = $1
      WHERE id = $2`,
    [now, assistanceId],
  );
  await transition(assistanceId, "pending", "user", "Borrador enviado");
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
  providerName?: string | null;
  requiresAcceptance?: boolean;
  acceptTimeoutMin?: number;
  distanceKm: number;
  etaMinutes: number;      // ETA corregida con el histórico real del taller
  score: number;
  explanation: string;
  acceptProbability?: number; // 0..1, histórico de aceptación de ofertas
  activeLoad?: number;        // asistencias activas ahora mismo
}

/** ETA aproximada por carretera: haversine × 1,4 a 60 km/h medios + 5 min de salida. */
function estimateEtaMinutes(distanceKm: number): number {
  return Math.round((distanceKm * 1.4 / 60) * 60 + 5);
}

export async function findCandidates(
  latitude: number,
  longitude: number,
  serviceType: string,
  excludeWorkshopIds: number[] = [],
): Promise<WorkshopCandidate[]> {
  const since90 = Date.now() - 90 * 24 * 3600_000;
  const r = await db.query(
    `SELECT w.*, pc.name AS "providerName",
            COALESCE(a."requiresAcceptance", false) AS "requiresAcceptance",
            COALESCE(a."acceptTimeoutMin", 10) AS "acceptTimeoutMin",
            hist.accepted, hist.declined, hist."etaFactor",
            COALESCE(load.n, 0)::int AS "activeLoad"
       FROM connect_workshops w
       LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
       LEFT JOIN connect_provider_authorizations a
         ON a."providerCompanyId" = w."providerCompanyId" AND a."branchId" IS NULL AND a.status = 'active'
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE asg.status = 'accepted')::int AS accepted,
                COUNT(*) FILTER (WHERE asg.status IN ('rejected','expired'))::int AS declined,
                AVG(arrmin.actual / NULLIF((asg."scoreBreakdown"::json->>'etaMinutes')::float, 0)) AS "etaFactor"
           FROM connect_assignments asg
           LEFT JOIN LATERAL (
             SELECT (arr."occurredAtMs" - asg2."occurredAtMs") / 60000.0 AS actual
               FROM connect_status_history asg2
               JOIN connect_status_history arr
                 ON arr."assistanceId" = asg2."assistanceId" AND arr."toStatus" = 'arrived'
              WHERE asg2."assistanceId" = asg."assistanceId" AND asg2."toStatus" = 'assigned'
              LIMIT 1
           ) arrmin ON asg.status = 'accepted'
          WHERE asg."workshopId" = w.id AND asg."sentAtMs" >= $1
       ) hist ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS n FROM connect_assistances ca
          WHERE ca."workshopId" = w.id
            AND ca.status IN ('assigned','technician_assigned','en_route','arrived','in_progress')
       ) load ON true
      WHERE w."connectStatus" = 'active'
        AND (a.id IS NULL OR a.excluded = false)`,
    [since90],
  );
  const candidates: WorkshopCandidate[] = [];
  for (const w of r.rows) {
    if (excludeWorkshopIds.includes(w.id)) continue;
    const services: string[] = JSON.parse(w.services || "[]");
    if (serviceType !== "other" && services.length > 0 && !services.includes(serviceType)) continue;
    const distanceKm = haversineKm(latitude, longitude, w.latitude, w.longitude);
    if (distanceKm > Number(w.radiusKm || 60)) continue;

    // Fase 4 — ETA aprendida: corrige la heurística con el ratio real/previsto
    // del taller (acotado 0,6–2,5; sin historial → 1)
    const rawFactor = Number(w.etaFactor);
    const etaFactor = Number.isFinite(rawFactor) && rawFactor > 0 ? Math.min(2.5, Math.max(0.6, rawFactor)) : 1;
    const etaMinutes = Math.round(estimateEtaMinutes(distanceKm) * etaFactor);

    // Fase 4 — probabilidad de aceptación (suavizado con prior 0,7 y k=6)
    const offered = (w.accepted ?? 0) + (w.declined ?? 0);
    const acceptProbability = Math.round(((Number(w.accepted ?? 0) + 0.7 * 6) / (offered + 6)) * 100) / 100;

    // Fase 4 — penalización por carga: cada asistencia activa resta capacidad
    const activeLoad = Number(w.activeLoad ?? 0);
    const loadFactor = Math.max(0, 1 - activeLoad / 5); // 5+ activas → saturado

    // Score = 45 % ETA + 25 % score de red + 15 % prob. aceptación + 15 % carga
    const fit = Math.max(0, 1 - etaMinutes / 90);
    const score = Math.round((
      0.45 * fit +
      0.25 * (Number(w.currentScore) / 100) +
      0.15 * acceptProbability +
      0.15 * loadFactor
    ) * 100);

    const parts = [
      `${Math.round(distanceKm)} km (ETA ~${etaMinutes} min${etaFactor !== 1 ? `, corregida ×${etaFactor.toFixed(1)} por historial` : ""})`,
      `score de red ${Math.round(w.currentScore)}/100`,
      `acepta el ${Math.round(acceptProbability * 100)} %`,
      activeLoad > 0 ? `${activeLoad} activa(s) ahora` : "sin carga",
    ];
    candidates.push({
      workshopId: w.id,
      name: w.name,
      providerName: w.providerName ?? null,
      requiresAcceptance: w.requiresAcceptance === true,
      acceptTimeoutMin: Number(w.acceptTimeoutMin) || 10,
      distanceKm: Math.round(distanceKm * 10) / 10,
      etaMinutes,
      score,
      acceptProbability,
      activeLoad,
      explanation: `${w.name}: ${parts.join(" · ")}`,
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

/** Talleres ya ofertados sin éxito para esta asistencia (no se reofertan). */
async function excludedWorkshops(assistanceId: number): Promise<number[]> {
  const r = await db.query(
    `SELECT DISTINCT "workshopId" FROM connect_assignments
      WHERE "assistanceId" = $1 AND status IN ('rejected', 'expired', 'withdrawn')`,
    [assistanceId],
  );
  return r.rows.map((x) => x.workshopId);
}

interface OfferOptions {
  mode?: "auto" | "direct" | "offer"; // auto = según la autorización del proveedor
  byUserId?: number | null;
  byName?: string | null;
  rank?: number | null;
}

async function candidateForWorkshop(a: any, workshopId: number): Promise<WorkshopCandidate> {
  if (a.latitude != null && a.longitude != null) {
    const list = await findCandidates(a.latitude, a.longitude, a.serviceType);
    const hit = list.find((c) => c.workshopId === workshopId);
    if (hit) return hit;
  }
  const w = await db.query(
    `SELECT w.*, pc.name AS "providerName",
            COALESCE(auth."requiresAcceptance", false) AS "requiresAcceptance",
            COALESCE(auth."acceptTimeoutMin", 10) AS "acceptTimeoutMin"
       FROM connect_workshops w
       LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
       LEFT JOIN connect_provider_authorizations auth
         ON auth."providerCompanyId" = w."providerCompanyId" AND auth."branchId" IS NULL AND auth.status = 'active'
      WHERE w.id = $1 AND w."connectStatus" = 'active'`,
    [workshopId],
  );
  if (!w.rows[0]) throw new Error("Taller no encontrado o no activo en la red Connect");
  const dist = a.latitude != null && a.longitude != null
    ? haversineKm(a.latitude, a.longitude, w.rows[0].latitude, w.rows[0].longitude) : 0;
  return {
    workshopId: w.rows[0].id,
    name: w.rows[0].name,
    providerName: w.rows[0].providerName,
    requiresAcceptance: w.rows[0].requiresAcceptance === true,
    acceptTimeoutMin: Number(w.rows[0].acceptTimeoutMin) || 10,
    distanceKm: Math.round(dist * 10) / 10,
    etaMinutes: estimateEtaMinutes(dist),
    score: 100,
    explanation: `Selección manual: ${w.rows[0].name} (${Math.round(dist)} km)`,
  };
}

/**
 * Oferta/asigna la asistencia a un taller concreto.
 * - modo direct: inyecta en el core inmediatamente (comportamiento actual con SEA).
 * - modo offer: queda en awaiting_acceptance hasta que el proveedor acepte/rechace
 *   (o venza el plazo de la autorización → cascada automática).
 */
export async function offerToWorkshop(assistanceId: number, workshopId: number, opts: OfferOptions = {}): Promise<void> {
  const r = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [assistanceId]);
  const a = r.rows[0];
  if (!a) throw new Error(`Asistencia Connect ${assistanceId} no encontrada`);
  if (!["pending", "searching", "no_coverage", "assignment_failed"].includes(a.status)) {
    throw new InvalidTransitionError(a.status, "awaiting_acceptance");
  }
  if (a.status !== "searching") await transition(assistanceId, "searching", opts.byName ? "user" : "system");

  const c = await candidateForWorkshop(a, workshopId);
  const useOffer = opts.mode === "offer" || (opts.mode !== "direct" && c.requiresAcceptance);
  const now = Date.now();
  const deadline = useOffer ? now + (c.acceptTimeoutMin ?? 10) * 60_000 : null;

  // Fase 4 — predicción de SLA: ETA prevista (+ plazo de aceptación si es
  // oferta) frente al margen restante; avisa ANTES de que ocurra
  if (a.slaDeadlineAtMs) {
    const etaMs = (c.etaMinutes + (useOffer ? (c.acceptTimeoutMin ?? 10) : 0)) * 60_000;
    const marginMin = Math.round((Number(a.slaDeadlineAtMs) - now - etaMs) / 60_000);
    if (marginMin < 0) {
      c.explanation += ` · ⚠ SLA en riesgo: llegada prevista ${-marginMin} min tarde`;
      await createAlert({
        type: "sla_predicted_breach", severity: "warning",
        title: `Predicción: la asistencia #${assistanceId} incumplirá el SLA (~${-marginMin} min tarde)`,
        body: `ETA prevista de ${c.name}: ${c.etaMinutes} min${useOffer ? ` + ${c.acceptTimeoutMin} min de plazo de aceptación` : ""}`,
        assistanceId, workshopId,
      });
    }
  }

  const ins = await db.query(
    `INSERT INTO connect_assignments
       ("assistanceId", "workshopId", "providerCompanyId", rank, score, "scoreBreakdown", explanation,
        mode, status, "sentAtMs", "acceptDeadlineMs", "createdByUserId", "createdAtMs")
     SELECT $1, $2, w."providerCompanyId", $3, $4, $5, $6, $7, 'sent', $8, $9, $10, $8
       FROM connect_workshops w WHERE w.id = $2
     RETURNING id`,
    [
      assistanceId, workshopId, opts.rank ?? null, c.score,
      JSON.stringify({ distanceKm: c.distanceKm, etaMinutes: c.etaMinutes }),
      c.explanation, useOffer ? "offer" : "direct", now, deadline, opts.byUserId ?? null,
    ],
  );
  const assignmentId = ins.rows[0].id;

  if (useOffer) {
    await db.query(
      `UPDATE connect_assistances SET "workshopId" = $1, "assignmentExplanation" = $2, "updatedAtMs" = $3 WHERE id = $4`,
      [workshopId, c.explanation, now, assistanceId],
    );
    await transition(assistanceId, "awaiting_acceptance", opts.byName ? "user" : "system",
      `Oferta enviada a ${c.name}${c.providerName ? ` (${c.providerName})` : ""}; plazo ${c.acceptTimeoutMin} min`);
  } else {
    await finalizeAcceptedAssignment(assignmentId, opts.byName ?? "sistema (asignación directa)");
  }
}

/** Inyecta en el core y consolida la asignación aceptada. */
async function finalizeAcceptedAssignment(assignmentId: number, actorName: string): Promise<void> {
  const r = await db.query(
    `SELECT asg.*, ca.id AS aid FROM connect_assignments asg
       JOIN connect_assistances ca ON ca.id = asg."assistanceId"
      WHERE asg.id = $1`,
    [assignmentId],
  );
  const asg = r.rows[0];
  if (!asg) throw new Error("Asignación no encontrada");
  const aRow = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [asg.assistanceId]);
  const a = aRow.rows[0];
  const now = Date.now();

  const coreId = await injectIntoCore(a, asg.workshopId);
  await db.query(
    `UPDATE connect_assignments SET status = 'accepted', "respondedAtMs" = $1, "respondedBy" = $2 WHERE id = $3`,
    [now, actorName, assignmentId],
  );

  // Coste estimado según el tarifario de la autorización (base + €/km × distancia)
  let estimatedCost: number | null = null;
  let costDetail: string | null = null;
  try {
    const breakdown = asg.scoreBreakdown ? JSON.parse(asg.scoreBreakdown) : {};
    const distanceKm = Number(breakdown.distanceKm) || 0;
    const t = await db.query(
      `SELECT tl."baseAmount", tl."perKmAmount", tl.currency
         FROM connect_tariff_lines tl
         JOIN connect_provider_authorizations auth ON auth.id = tl."authorizationId"
         JOIN connect_workshops w ON w."providerCompanyId" = auth."providerCompanyId"
        WHERE w.id = $1 AND auth."branchId" IS NULL AND auth.status = 'active'
          AND tl.active AND tl."serviceTypeCode" = $2
        LIMIT 1`,
      [asg.workshopId, a.serviceType],
    );
    if (t.rows[0]) {
      const { baseAmount, perKmAmount } = t.rows[0];
      estimatedCost = Math.round((Number(baseAmount) + Number(perKmAmount) * distanceKm) * 100) / 100;
      costDetail = `Base ${baseAmount} € + ${perKmAmount} €/km × ${Math.round(distanceKm)} km`;
    }
  } catch (err: any) {
    console.error("[Connect] cálculo de coste:", err?.message);
  }

  await db.query(
    `UPDATE connect_assistances
        SET "workshopId" = $1, "coreAssistanceId" = $2, "assignmentExplanation" = $3,
            "estimatedCost" = COALESCE($4, "estimatedCost"), "costDetail" = COALESCE($5, "costDetail"),
            "updatedAtMs" = $6
      WHERE id = $7`,
    [asg.workshopId, coreId, asg.explanation, estimatedCost, costDetail, now, asg.assistanceId],
  );
  await transition(asg.assistanceId, "assigned", "system", asg.mode === "offer" ? `Aceptada por ${actorName}` : asg.explanation);
}

/** Aceptación de una oferta (portal del proveedor o aceptación telefónica del operador). */
export async function acceptAssignment(assignmentId: number, actorName: string): Promise<void> {
  const r = await db.query(`SELECT * FROM connect_assignments WHERE id = $1`, [assignmentId]);
  const asg = r.rows[0];
  if (!asg) throw new Error("Oferta no encontrada");
  if (asg.status !== "sent") throw new Error(`La oferta ya está en estado ${asg.status}`);
  await finalizeAcceptedAssignment(assignmentId, actorName);
}

/** Rechazo con motivo obligatorio; relanza la búsqueda en cascada. */
export async function rejectAssignment(
  assignmentId: number,
  opts: { reasonCode: string; comment?: string; actorName: string; affectsScore?: boolean },
): Promise<void> {
  const r = await db.query(`SELECT * FROM connect_assignments WHERE id = $1`, [assignmentId]);
  const asg = r.rows[0];
  if (!asg) throw new Error("Oferta no encontrada");
  if (asg.status !== "sent") throw new Error(`La oferta ya está en estado ${asg.status}`);
  if (!opts.reasonCode) throw new Error("El motivo de rechazo es obligatorio");
  const now = Date.now();

  await db.query(
    `UPDATE connect_assignments SET status = 'rejected', "respondedAtMs" = $1, "respondedBy" = $2 WHERE id = $3`,
    [now, opts.actorName, assignmentId],
  );
  await db.query(
    `INSERT INTO connect_rejections
       ("assignmentId", "assistanceId", "workshopId", "providerCompanyId", "reasonCode", comment,
        "responseMs", "affectsScore", "rejectedBy", "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      assignmentId, asg.assistanceId, asg.workshopId, asg.providerCompanyId,
      opts.reasonCode, opts.comment ?? null, now - Number(asg.sentAtMs),
      opts.affectsScore !== false, opts.actorName, now,
    ],
  );
  await db.query(`UPDATE connect_assistances SET "workshopId" = NULL, "updatedAtMs" = $1 WHERE id = $2`, [now, asg.assistanceId]);
  const aInfo = await db.query(`SELECT uuid, "partnerId", "externalReference" FROM connect_assistances WHERE id = $1`, [asg.assistanceId]);
  if (aInfo.rows[0]?.partnerId) {
    await enqueueWebhookEvent(aInfo.rows[0].partnerId, "assistance.rejected", {
      assistance_id: aInfo.rows[0].uuid,
      external_reference: aInfo.rows[0].externalReference,
      reason_code: opts.reasonCode,
      comment: opts.comment ?? null,
    });
  }
  await transition(asg.assistanceId, "searching", "user", `Rechazada por ${opts.actorName}: ${opts.reasonCode}${opts.comment ? ` — ${opts.comment}` : ""}`);
  await cascadeNext(asg.assistanceId);
}

/** Tras rechazo/expiración: intenta el siguiente candidato automáticamente. */
async function cascadeNext(assistanceId: number): Promise<void> {
  const aRow = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [assistanceId]);
  const a = aRow.rows[0];
  if (!a || a.status !== "searching") return;
  if (a.latitude == null || a.longitude == null) {
    await transition(assistanceId, "assignment_failed", "system", "Sin coordenadas para buscar alternativa: requiere gestión manual");
    return;
  }
  const excluded = await excludedWorkshops(assistanceId);
  const candidates = await findCandidates(a.latitude, a.longitude, a.serviceType, excluded);
  if (candidates.length === 0) {
    await transition(assistanceId, "assignment_failed", "system", "Cascada agotada: ningún taller alternativo disponible");
    return;
  }
  await offerToWorkshop(assistanceId, candidates[0].workshopId, { mode: "auto", rank: 1 });
}

/** Reasignación: retira la asignación vigente (aceptada o pendiente) y relanza. */
export async function withdrawAndReassign(assistanceId: number, reason: string, actorName: string): Promise<void> {
  const aRow = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [assistanceId]);
  const a = aRow.rows[0];
  if (!a) throw new Error("Asistencia no encontrada");
  if (!["awaiting_acceptance", "assigned", "technician_assigned", "en_route"].includes(a.status)) {
    throw new Error(`No se puede reasignar en estado ${a.status}`);
  }
  const now = Date.now();

  await db.query(
    `UPDATE connect_assignments SET status = 'withdrawn', "respondedAtMs" = $1, "respondedBy" = $2
      WHERE "assistanceId" = $3 AND status IN ('sent', 'accepted')`,
    [now, actorName, assistanceId],
  );
  if (a.coreAssistanceId) {
    await db.query(
      `UPDATE roadside_assistances SET status = 'cancelada', "cancelledAtMs" = $1, "updatedAtMs" = $1
        WHERE id = $2 AND status NOT IN ('finalizada', 'cancelada')`,
      [now, a.coreAssistanceId],
    );
    await db.query(
      `INSERT INTO roadside_assistance_events ("assistanceId", status, note, "createdBy", "createdAtMs")
       VALUES ($1, 'cancelada', $2, 'connect-pro', $3)`,
      [a.coreAssistanceId, `Reasignada desde Connect Pro: ${reason}`, now],
    );
  }
  await db.query(
    `UPDATE connect_assistances SET "workshopId" = NULL, "coreAssistanceId" = NULL, "updatedAtMs" = $1 WHERE id = $2`,
    [now, assistanceId],
  );
  if (a.partnerId) {
    await enqueueWebhookEvent(a.partnerId, "assistance.reassigned", {
      assistance_id: a.uuid,
      external_reference: a.externalReference,
      reason,
    });
  }
  await transition(assistanceId, "searching", "user", `Reasignación solicitada por ${actorName}: ${reason}`);
  await cascadeNext(assistanceId);
}

/** Expira ofertas vencidas (worker) y lanza la cascada. */
export async function expireOfferedAssignments(): Promise<number> {
  const now = Date.now();
  const r = await db.query(
    `SELECT id, "assistanceId", "workshopId" FROM connect_assignments
      WHERE status = 'sent' AND mode = 'offer' AND "acceptDeadlineMs" IS NOT NULL AND "acceptDeadlineMs" < $1`,
    [now],
  );
  for (const asg of r.rows) {
    try {
      await db.query(`UPDATE connect_assignments SET status = 'expired', "respondedAtMs" = $1 WHERE id = $2`, [now, asg.id]);
      await db.query(`UPDATE connect_assistances SET "workshopId" = NULL, "updatedAtMs" = $1 WHERE id = $2`, [now, asg.assistanceId]);
      await createAlert({
        type: "offer_expired", severity: "warning",
        title: `Oferta expirada sin respuesta (asistencia #${asg.assistanceId})`,
        assistanceId: asg.assistanceId, workshopId: asg.workshopId,
      });
      await transition(asg.assistanceId, "searching", "system", "Oferta expirada sin respuesta del proveedor");
      await cascadeNext(asg.assistanceId);
    } catch (err: any) {
      console.error(`[Connect] expirando oferta ${asg.id}: ${err?.message}`);
    }
  }
  return r.rows.length;
}

/**
 * Asignación automática (partners API y botón "Buscar proveedor"):
 * elige el mejor candidato no descartado y lo oferta/asigna según su autorización.
 */
export async function assignAssistance(assistanceId: number, forcedWorkshopId?: number): Promise<void> {
  const r = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [assistanceId]);
  const a = r.rows[0];
  if (!a) throw new Error(`Asistencia Connect ${assistanceId} no encontrada`);
  if (!["pending", "no_coverage", "assignment_failed"].includes(a.status)) return;

  if (forcedWorkshopId) {
    await offerToWorkshop(assistanceId, forcedWorkshopId, { mode: "auto" });
    return;
  }
  await transition(assistanceId, "searching", "system");
  if (a.latitude == null || a.longitude == null) {
    await transition(assistanceId, "assignment_failed", "system", "Sin coordenadas: se requiere asignación manual");
    return;
  }
  const excluded = await excludedWorkshops(assistanceId);
  const candidates = await findCandidates(a.latitude, a.longitude, a.serviceType, excluded);
  if (candidates.length === 0) {
    await transition(assistanceId, "no_coverage", "system", "Ningún taller activo cubre la zona/servicio");
    return;
  }
  await offerToWorkshop(assistanceId, candidates[0].workshopId, { mode: "auto", rank: 1 });
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
