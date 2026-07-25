/**
 * Centro de Inteligencia Operacional — alertas inteligentes.
 *
 * Motor de reglas que vigila la operación, la calidad y la economía del
 * servicio. Cada alerta tiene ciclo de vida completo (abierta → reconocida →
 * resuelta), responsable, fecha límite, comentarios y escalado automático
 * cuando nadie la atiende a tiempo.
 *
 * Relación con connect_alerts (la campana del backoffice): aquella es el aviso
 * inmediato del centro de control; esta es el registro con seguimiento y
 * escalado del centro de inteligencia. Las críticas se publican también en la
 * campana para no partir la atención del operador.
 */

import db from "../../db.ts";
import { createAlert as pushBackofficeAlert } from "../alerts.ts";
import { computeDelayRisks, zoneSaturation } from "./predictions.ts";

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertCategory = "operational" | "quality" | "economic";

export interface AlertDraft {
  alertType: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  description?: string;
  entityType?: string;
  entityId?: string;
  dedupKey: string;
  dueInMinutes?: number;
}

const MIN = 60_000;
const DAY_MS = 86400_000;

/** Alta de alerta con deduplicación: no se repite mientras siga viva. */
export async function raiseAlert(d: AlertDraft): Promise<boolean> {
  const now = Date.now();
  const r = await db.query(
    `INSERT INTO operational_alert
       ("alertType",category,severity,title,description,"entityType","entityId","dedupKey","detectedAtMs","dueAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT ("dedupKey") WHERE status IN ('open','acknowledged') DO NOTHING
     RETURNING id`,
    [
      d.alertType, d.category, d.severity, d.title, d.description ?? "",
      d.entityType ?? null, d.entityId ?? null, d.dedupKey, now,
      d.dueInMinutes ? now + d.dueInMinutes * MIN : null,
    ],
  );
  if (!r.rows.length) return false;

  // Las críticas se replican en la campana del backoffice
  if (d.severity === "critical") {
    await pushBackofficeAlert({
      type: `oi_${d.alertType}`,
      severity: "critical",
      title: d.title,
      body: d.description,
      assistanceId: d.entityType === "assistance" ? Number(d.entityId) : null,
      workshopId: d.entityType === "workshop" ? Number(d.entityId) : null,
    });
  }
  return true;
}

/** Ejecuta todas las reglas de alertas. Cada regla está aislada. */
export async function runAlertRules(): Promise<number> {
  const rules = [
    alertUnassignedTooLong, alertProviderNoResponse, alertGpsLost, alertDelayRisk,
    alertEtaExceeded, alertZoneSaturation, alertQualityIssues, alertEconomicIssues,
  ];
  let created = 0;
  for (const rule of rules) {
    try {
      created += await rule();
    } catch (err: any) {
      console.error(`[OI] alerta ${rule.name} falló:`, err?.message);
    }
  }
  await escalateOverdueAlerts();
  await autoResolveStaleAlerts();
  return created;
}

// ── Alertas operacionales ───────────────────────────────────────────────────

async function alertUnassignedTooLong(): Promise<number> {
  const r = await db.query(
    `SELECT id, "createdAtMs", priority FROM connect_assistances
      WHERE status IN ('pending','searching') AND "createdAtMs" < $1`,
    [Date.now() - 15 * MIN],
  );
  let n = 0;
  for (const a of r.rows) {
    const waited = Math.round((Date.now() - Number(a.createdAtMs)) / MIN);
    const ok = await raiseAlert({
      alertType: "unassigned_too_long",
      category: "operational",
      severity: waited > 45 ? "critical" : waited > 30 ? "high" : "medium",
      title: `Asistencia #${a.id} lleva ${waited} min sin asignar`,
      description: `Prioridad ${a.priority}. Sin proveedor confirmado desde su recepción.`,
      entityType: "assistance",
      entityId: String(a.id),
      dedupKey: `unassigned_too_long|${a.id}`,
      dueInMinutes: 15,
    });
    if (ok) n++;
  }
  return n;
}

async function alertProviderNoResponse(): Promise<number> {
  const r = await db.query(
    `SELECT asg.id, asg."assistanceId", asg."workshopId", asg."sentAtMs", asg."acceptDeadlineMs", w.name
       FROM connect_assignments asg
       LEFT JOIN connect_workshops w ON w.id = asg."workshopId"
      WHERE asg.status = 'sent' AND asg.mode = 'offer'
        AND asg."acceptDeadlineMs" IS NOT NULL AND asg."acceptDeadlineMs" < $1`,
    [Date.now() + 2 * MIN],
  );
  let n = 0;
  for (const o of r.rows) {
    const waited = Math.round((Date.now() - Number(o.sentAtMs)) / MIN);
    const ok = await raiseAlert({
      alertType: "provider_no_response",
      category: "operational",
      severity: "high",
      title: `${o.name ?? "El proveedor"} no responde a la oferta de la asistencia #${o.assistanceId}`,
      description: `Oferta enviada hace ${waited} min; el plazo de aceptación está agotado o a punto de agotarse.`,
      entityType: "assistance",
      entityId: String(o.assistanceId),
      dedupKey: `provider_no_response|${o.id}`,
      dueInMinutes: 10,
    });
    if (ok) n++;
  }
  return n;
}

async function alertGpsLost(): Promise<number> {
  const r = await db.query(
    `SELECT mu.id, mu.name, mu."lastReportAtMs", mu."activeAssistanceId"
       FROM connect_mobile_units mu
      WHERE mu."activeAssistanceId" IS NOT NULL
        AND (mu."lastReportAtMs" IS NULL OR mu."lastReportAtMs" < $1)`,
    [Date.now() - 20 * MIN],
  );
  let n = 0;
  for (const u of r.rows) {
    const stale = u.lastReportAtMs ? Math.round((Date.now() - Number(u.lastReportAtMs)) / MIN) : null;
    const ok = await raiseAlert({
      alertType: "gps_lost",
      category: "operational",
      severity: stale != null && stale > 60 ? "high" : "medium",
      title: `La unidad ${u.name} no reporta posición${stale != null ? ` desde hace ${stale} min` : ""}`,
      description: `Tiene la asistencia #${u.activeAssistanceId} en curso, así que no puede seguirse su desplazamiento.`,
      entityType: "mobile_unit",
      entityId: String(u.id),
      dedupKey: `gps_lost|${u.id}|${u.activeAssistanceId}`,
      dueInMinutes: 30,
    });
    if (ok) n++;
  }
  return n;
}

async function alertDelayRisk(): Promise<number> {
  const risks = await computeDelayRisks();
  let n = 0;
  for (const risk of risks) {
    if (risk.level !== "high" && risk.level !== "critical") continue;
    const ok = await raiseAlert({
      alertType: risk.minutesToDeadline != null && risk.minutesToDeadline < 0 ? "sla_breached" : "sla_risk",
      category: "operational",
      severity: risk.level === "critical" ? "critical" : "high",
      title: risk.minutesToDeadline != null && risk.minutesToDeadline < 0
        ? `SLA incumplido en la asistencia #${risk.assistanceId}`
        : `Riesgo ${risk.level} de incumplir el SLA en la asistencia #${risk.assistanceId}`,
      description: risk.explanation,
      entityType: "assistance",
      entityId: String(risk.assistanceId),
      dedupKey: `${risk.level === "critical" ? "sla_critical" : "sla_risk"}|${risk.assistanceId}`,
      dueInMinutes: 15,
    });
    if (ok) n++;
  }
  return n;
}

async function alertEtaExceeded(): Promise<number> {
  const r = await db.query(
    `SELECT p."entityId"::int AS assistance_id, p."predictedValue", p."targetAtMs"
       FROM ai_prediction p
       JOIN connect_assistances ca ON ca.id = p."entityId"::int
      WHERE p."predictionType" = 'eta' AND p."evaluatedAtMs" IS NULL
        AND p."targetAtMs" < $1
        AND ca.status IN ('assigned','technician_assigned','en_route')`,
    [Date.now() - 10 * MIN],
  );
  let n = 0;
  for (const p of r.rows) {
    const over = Math.round((Date.now() - Number(p.targetAtMs)) / MIN);
    const ok = await raiseAlert({
      alertType: "eta_exceeded",
      category: "operational",
      severity: over > 30 ? "high" : "medium",
      title: `ETA superado en ${over} min en la asistencia #${p.assistance_id}`,
      description: `Se comunicó un ETA de ${Math.round(Number(p.predictedValue))} min y la unidad todavía no ha llegado.`,
      entityType: "assistance",
      entityId: String(p.assistance_id),
      dedupKey: `eta_exceeded|${p.assistance_id}`,
      dueInMinutes: 20,
    });
    if (ok) n++;
  }
  return n;
}

async function alertZoneSaturation(): Promise<number> {
  const zones = await zoneSaturation();
  let n = 0;
  for (const z of Object.values(zones)) {
    if (z.active < 3 || z.ratio <= 2) continue;
    const ok = await raiseAlert({
      alertType: "zone_saturation",
      category: "operational",
      severity: z.availableUnits === 0 ? "critical" : "high",
      title: `Zona saturada: ${z.label}`,
      description: `${z.active} servicios activos y ${z.availableUnits} unidades disponibles (ratio ${z.ratio}).`,
      entityType: "zone",
      entityId: z.zoneId,
      dedupKey: `zone_saturation|${z.zoneId}|${new Date().toISOString().slice(0, 13)}`,
      dueInMinutes: 60,
    });
    if (ok) n++;
  }
  return n;
}

// ── Alertas de calidad ──────────────────────────────────────────────────────

async function alertQualityIssues(): Promise<number> {
  const now = Date.now();
  let n = 0;

  // Incremento de reclamaciones frente a la media de las 4 semanas anteriores
  const complaints = await db.query(
    `SELECT COUNT(*) FILTER (WHERE "createdAtMs" >= $1)::int AS recent,
            COUNT(*) FILTER (WHERE "createdAtMs" >= $2 AND "createdAtMs" < $1)::int AS prev
       FROM connect_incidents
      WHERE type IN ('complaint','damages') AND "createdAtMs" >= $2`,
    [now - 7 * DAY_MS, now - 35 * DAY_MS],
  );
  const c = complaints.rows[0];
  const prevWeekly = c.prev / 4;
  if (c.recent >= 3 && prevWeekly > 0 && c.recent > prevWeekly * 1.5) {
    const ok = await raiseAlert({
      alertType: "complaints_increase",
      category: "quality",
      severity: "high",
      title: `Las reclamaciones han subido a ${c.recent} esta semana`,
      description: `Media de las 4 semanas anteriores: ${Math.round(prevWeekly * 10) / 10} por semana.`,
      dedupKey: `complaints_increase|${new Date().toISOString().slice(0, 10)}`,
      dueInMinutes: 24 * 60,
    });
    if (ok) n++;
  }

  // Incidencias documentales o de evidencias abiertas y sin resolver
  const docs = await db.query(
    `SELECT id, "assistanceId", type FROM connect_incidents
      WHERE type IN ('incomplete_docs','insufficient_photos','incomplete_service')
        AND status NOT IN ('resolved','closed') AND "createdAtMs" < $1`,
    [now - 2 * DAY_MS],
  );
  for (const d of docs.rows) {
    const ok = await raiseAlert({
      alertType: "documentation_incomplete",
      category: "quality",
      severity: "medium",
      title: `Documentación pendiente en la asistencia #${d.assistanceId ?? "—"}`,
      description: `Incidencia de tipo ${d.type} abierta hace más de 48 h sin resolver.`,
      entityType: "incident",
      entityId: String(d.id),
      dedupKey: `documentation_incomplete|${d.id}`,
      dueInMinutes: 48 * 60,
    });
    if (ok) n++;
  }

  // Incidencias críticas sin responsable asignado
  const orphan = await db.query(
    `SELECT id, description FROM connect_incidents
      WHERE severity = 'critical' AND status NOT IN ('resolved','closed')
        AND "ownerUserId" IS NULL AND "createdAtMs" < $1`,
    [now - 60 * MIN],
  );
  for (const i of orphan.rows) {
    const ok = await raiseAlert({
      alertType: "critical_incident_unowned",
      category: "quality",
      severity: "critical",
      title: `Incidencia crítica #${i.id} sin responsable asignado`,
      description: String(i.description ?? "").slice(0, 300),
      entityType: "incident",
      entityId: String(i.id),
      dedupKey: `critical_incident_unowned|${i.id}`,
      dueInMinutes: 60,
    });
    if (ok) n++;
  }
  return n;
}

// ── Alertas económicas ──────────────────────────────────────────────────────

async function alertEconomicIssues(): Promise<number> {
  const now = Date.now();
  let n = 0;

  // Coste final muy por encima del estimado por tarifa
  const overrun = await db.query(
    `SELECT id, "finalCost", "estimatedCost" FROM connect_assistances
      WHERE "finalCost" IS NOT NULL AND "estimatedCost" IS NOT NULL AND "estimatedCost" > 0
        AND "finalCost" > "estimatedCost" * 1.3 AND "updatedAtMs" >= $1`,
    [now - 2 * DAY_MS],
  );
  for (const a of overrun.rows) {
    const pct = Math.round(((Number(a.finalCost) - Number(a.estimatedCost)) / Number(a.estimatedCost)) * 100);
    const ok = await raiseAlert({
      alertType: "cost_overrun",
      category: "economic",
      severity: pct > 80 ? "high" : "medium",
      title: `Coste un ${pct} % superior al previsto en la asistencia #${a.id}`,
      description: `Estimado ${Math.round(Number(a.estimatedCost))} €, final ${Math.round(Number(a.finalCost))} €.`,
      entityType: "assistance",
      entityId: String(a.id),
      dedupKey: `cost_overrun|${a.id}`,
      dueInMinutes: 3 * 24 * 60,
    });
    if (ok) n++;
  }

  // Servicios finalizados sin ningún importe: falta tarifa configurada
  const untariffed = await db.query(
    `SELECT ca.id, ca."serviceType", w.name AS workshop
       FROM connect_assistances ca
       LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
      WHERE ca.status = 'finished' AND ca."finalCost" IS NULL AND ca."estimatedCost" IS NULL
        AND ca."updatedAtMs" >= $1`,
    [now - 3 * DAY_MS],
  );
  for (const a of untariffed.rows) {
    const ok = await raiseAlert({
      alertType: "missing_tariff",
      category: "economic",
      severity: "medium",
      title: `Servicio #${a.id} finalizado sin importe (tarifa no configurada)`,
      description: `Tipo de servicio ${a.serviceType}${a.workshop ? `, proveedor ${a.workshop}` : ""}.`,
      entityType: "assistance",
      entityId: String(a.id),
      dedupKey: `missing_tariff|${a.id}`,
      dueInMinutes: 5 * 24 * 60,
    });
    if (ok) n++;
  }
  return n;
}

// ── Ciclo de vida ───────────────────────────────────────────────────────────

/** Sube un nivel de escalado las alertas vencidas y sin reconocer. */
export async function escalateOverdueAlerts(): Promise<number> {
  const now = Date.now();
  const r = await db.query(
    `UPDATE operational_alert
        SET "escalationLevel" = "escalationLevel" + 1,
            "escalatedAtMs" = $1,
            severity = CASE severity WHEN 'low' THEN 'medium' WHEN 'medium' THEN 'high' ELSE 'critical' END
      WHERE status = 'open' AND "dueAtMs" IS NOT NULL AND "dueAtMs" < $1
        AND "escalationLevel" < 3
        AND (("escalatedAtMs" IS NULL) OR "escalatedAtMs" < $2)
      RETURNING id, title, severity`,
    [now, now - 30 * MIN],
  );
  for (const a of r.rows) {
    if (a.severity === "critical") {
      await pushBackofficeAlert({ type: "oi_escalation", severity: "critical", title: `Escalado: ${a.title}` });
    }
  }
  return r.rows.length;
}

/**
 * Cierra automáticamente las alertas cuya causa ya no existe (la asistencia se
 * finalizó o canceló). Se marcan como resueltas por el sistema, con trazabilidad.
 */
export async function autoResolveStaleAlerts(): Promise<number> {
  const now = Date.now();
  const r = await db.query(
    `UPDATE operational_alert a
        SET status = 'resolved', "resolvedAtMs" = $1, "resolvedBy" = 'sistema',
            resolution = 'Resuelta automáticamente: la asistencia ya no está activa'
       FROM connect_assistances ca
      WHERE a."entityType" = 'assistance' AND a."entityId" = ca.id::text
        AND a.status IN ('open','acknowledged')
        AND ca.status IN ('finished','cancelled')
      RETURNING a.id`,
    [now],
  );
  return r.rows.length;
}

export async function acknowledgeAlert(id: number, userName: string, userId?: number | null): Promise<boolean> {
  const r = await db.query(
    `UPDATE operational_alert
        SET status = 'acknowledged', "acknowledgedAtMs" = $2, "acknowledgedBy" = $3,
            "assignedUserId" = COALESCE("assignedUserId", $4)
      WHERE id = $1 AND status = 'open' RETURNING id`,
    [id, Date.now(), userName, userId ?? null],
  );
  return r.rows.length > 0;
}

export async function resolveAlert(id: number, userName: string, resolution: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE operational_alert
        SET status = 'resolved', "resolvedAtMs" = $2, "resolvedBy" = $3, resolution = $4
      WHERE id = $1 AND status IN ('open','acknowledged') RETURNING id`,
    [id, Date.now(), userName, resolution],
  );
  return r.rows.length > 0;
}

export async function commentAlert(id: number, userName: string, text: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE operational_alert
        SET comments = (COALESCE(NULLIF(comments, ''), '[]')::jsonb || $2::jsonb)::text
      WHERE id = $1 RETURNING id`,
    [id, JSON.stringify([{ by: userName, text, atMs: Date.now() }])],
  );
  return r.rows.length > 0;
}

export async function assignAlert(id: number, userId: number): Promise<boolean> {
  const r = await db.query(
    `UPDATE operational_alert SET "assignedUserId" = $2 WHERE id = $1 RETURNING id`,
    [id, userId],
  );
  return r.rows.length > 0;
}
