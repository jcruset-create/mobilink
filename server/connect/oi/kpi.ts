/**
 * Centro de Inteligencia Operacional — motor de KPIs.
 *
 * Calcula todos los indicadores del catálogo sobre las tablas operacionales que
 * YA existen en Connect Pro (connect_assistances, connect_status_history,
 * connect_assignments, connect_incidents, connect_workshops,
 * connect_mobile_units). No duplica datos: operational_kpi_value solo guarda
 * fotos periódicas para poder dibujar tendencias y comparar con días anteriores.
 *
 * Dos naturalezas de KPI:
 *   - de periodo: se agregan sobre las asistencias creadas entre from y to.
 *   - "en vivo" (isLive): retratan el estado actual de la operación, así que
 *     ignoran el periodo; su comparativa sale de las fotos guardadas.
 */

import db from "../../db.ts";
import { KPI_BY_CODE, KPI_CATALOG, type KpiDefinition } from "./catalog.ts";

export interface KpiFilters {
  from: number;
  to: number;
  clientId?: number | null;
  partnerId?: number | null;
  providerCompanyId?: number | null;
  workshopId?: number | null;
  serviceType?: string | null;
  priority?: string | null;
}

export interface KpiResult {
  code: string;
  value: number | null;
  sampleSize: number;
  available: boolean;
  missingData?: string;
}

export type KpiStatus = "green" | "amber" | "red" | "grey";

/** KPIs que describen el estado actual y no un periodo cerrado. */
const LIVE_KPIS = new Set([
  "services_pending", "services_assigned", "services_en_route", "services_in_progress",
  "services_delayed", "no_gps_pct", "fleet_availability_pct", "fleet_utilization_pct",
  "fleet_out_of_service", "pending_invoice_count",
]);

export function isLiveKpi(code: string): boolean {
  return LIVE_KPIS.has(code);
}

const ACTIVE_STATUSES = ["pending", "searching", "awaiting_acceptance", "assigned", "technician_assigned", "en_route", "arrived", "in_progress"];

/** Construye el WHERE compartido por las consultas de asistencias. */
function assistanceFilters(f: KpiFilters, params: unknown[], opts: { period: boolean }): string {
  const parts: string[] = [`ca.status <> 'draft'`];
  if (opts.period) {
    params.push(f.from, f.to);
    parts.push(`ca."createdAtMs" BETWEEN $${params.length - 1} AND $${params.length}`);
  }
  if (f.clientId) { params.push(f.clientId); parts.push(`ca."clientId" = $${params.length}`); }
  if (f.partnerId) { params.push(f.partnerId); parts.push(`ca."partnerId" = $${params.length}`); }
  if (f.workshopId) { params.push(f.workshopId); parts.push(`ca."workshopId" = $${params.length}`); }
  if (f.providerCompanyId) { params.push(f.providerCompanyId); parts.push(`w."providerCompanyId" = $${params.length}`); }
  if (f.serviceType) { params.push(f.serviceType); parts.push(`ca."serviceType" = $${params.length}`); }
  if (f.priority) { params.push(f.priority); parts.push(`ca.priority = $${params.length}`); }
  return parts.join(" AND ");
}

/**
 * CTE con una fila por asistencia y los hitos temporales derivados del
 * historial de estados. Es la base de todos los tiempos medios.
 */
function svcCte(where: string): string {
  return `
    WITH svc AS (
      SELECT ca.id, ca.status, ca.priority, ca."serviceType", ca."createdAtMs",
             ca."workshopId", ca."clientId", ca."partnerId",
             ca."slaMinutes", ca."slaDeadlineAtMs", ca."invoicedAtMs",
             COALESCE(ca."finalCost", ca."estimatedCost") AS amount,
             ca."finalCost", ca."estimatedCost",
             w."providerCompanyId",
             h.assigned_at, h.en_route_at, h.arrived_at, h.finished_at
        FROM connect_assistances ca
        LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
        LEFT JOIN LATERAL (
          SELECT MIN("occurredAtMs") FILTER (WHERE "toStatus" = 'assigned')  AS assigned_at,
                 MIN("occurredAtMs") FILTER (WHERE "toStatus" = 'en_route')  AS en_route_at,
                 MIN("occurredAtMs") FILTER (WHERE "toStatus" = 'arrived')   AS arrived_at,
                 MIN("occurredAtMs") FILTER (WHERE "toStatus" = 'finished')  AS finished_at
            FROM connect_status_history WHERE "assistanceId" = ca.id
        ) h ON true
       WHERE ${where}
    )`;
}

/** Redondea a 1 decimal, dejando null si no hay dato. */
function r1(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

/**
 * Calcula todos los KPIs disponibles para unos filtros dados.
 * Devuelve un mapa code → resultado; los KPIs sin fuente de datos se devuelven
 * con available:false y su motivo, nunca con un valor inventado.
 */
export async function computeKpis(f: KpiFilters): Promise<Record<string, KpiResult>> {
  const out: Record<string, KpiResult> = {};
  const put = (code: string, value: number | null, sampleSize = 0) => {
    out[code] = { code, value, sampleSize, available: true };
  };

  // ── 1. Agregados del periodo ──────────────────────────────────────────
  const pParams: unknown[] = [];
  const pWhere = assistanceFilters(f, pParams, { period: true });
  const period = await db.query(
    `${svcCte(pWhere)}
     SELECT COUNT(*)::int AS received,
            COUNT(*) FILTER (WHERE status = 'finished')::int AS finished,
            COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            AVG((assigned_at - "createdAtMs")/60000.0) FILTER (WHERE assigned_at IS NOT NULL) AS assignment_min,
            COUNT(*) FILTER (WHERE assigned_at IS NOT NULL)::int AS n_assignment,
            AVG((en_route_at - assigned_at)/60000.0) FILTER (WHERE en_route_at IS NOT NULL AND assigned_at IS NOT NULL) AS departure_min,
            COUNT(*) FILTER (WHERE en_route_at IS NOT NULL AND assigned_at IS NOT NULL)::int AS n_departure,
            AVG((arrived_at - en_route_at)/60000.0) FILTER (WHERE arrived_at IS NOT NULL AND en_route_at IS NOT NULL) AS travel_min,
            COUNT(*) FILTER (WHERE arrived_at IS NOT NULL AND en_route_at IS NOT NULL)::int AS n_travel,
            AVG((arrived_at - "createdAtMs")/60000.0) FILTER (WHERE arrived_at IS NOT NULL) AS arrival_min,
            COUNT(*) FILTER (WHERE arrived_at IS NOT NULL)::int AS n_arrival,
            AVG((finished_at - arrived_at)/60000.0) FILTER (WHERE finished_at IS NOT NULL AND arrived_at IS NOT NULL) AS intervention_min,
            COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND arrived_at IS NOT NULL)::int AS n_intervention,
            AVG((finished_at - "createdAtMs")/60000.0) FILTER (WHERE finished_at IS NOT NULL) AS resolution_min,
            COUNT(*) FILTER (WHERE finished_at IS NOT NULL)::int AS n_resolution,
            COUNT(*) FILTER (WHERE "slaDeadlineAtMs" IS NOT NULL)::int AS n_sla,
            COUNT(*) FILTER (WHERE "slaDeadlineAtMs" IS NOT NULL AND arrived_at IS NOT NULL AND arrived_at <= "slaDeadlineAtMs")::int AS sla_ok,
            SUM(amount) FILTER (WHERE status = 'finished') AS revenue,
            AVG(amount) FILTER (WHERE status = 'finished' AND amount IS NOT NULL) AS avg_amount,
            COUNT(*) FILTER (WHERE status = 'finished' AND amount IS NOT NULL)::int AS n_amount,
            COUNT(*) FILTER (WHERE status = 'finished' AND (amount IS NULL OR amount = 0))::int AS n_untariffed,
            AVG(("finalCost" - "estimatedCost") / NULLIF("estimatedCost", 0) * 100)
              FILTER (WHERE "finalCost" IS NOT NULL AND "estimatedCost" IS NOT NULL AND "estimatedCost" > 0) AS cost_deviation,
            COUNT(*) FILTER (WHERE "finalCost" IS NOT NULL AND "estimatedCost" IS NOT NULL AND "estimatedCost" > 0)::int AS n_deviation
       FROM svc`,
    pParams,
  );
  const p = period.rows[0];
  const received = p.received as number;

  put("services_received", received, received);
  put("services_finished", p.finished, received);
  put("services_cancelled", p.cancelled, received);
  put("avg_assignment_min", r1(p.assignment_min), p.n_assignment);
  put("avg_departure_min", r1(p.departure_min), p.n_departure);
  put("avg_travel_min", r1(p.travel_min), p.n_travel);
  put("avg_arrival_min", r1(p.arrival_min), p.n_arrival);
  put("avg_intervention_min", r1(p.intervention_min), p.n_intervention);
  put("avg_resolution_min", r1(p.resolution_min), p.n_resolution);
  put("cancelled_pct", received > 0 ? r1((p.cancelled / received) * 100) : null, received);
  put("sla_compliance_pct", p.n_sla > 0 ? r1((p.sla_ok / p.n_sla) * 100) : null, p.n_sla);
  put("out_of_sla_pct", p.n_sla > 0 ? r1(100 - (p.sla_ok / p.n_sla) * 100) : null, p.n_sla);
  put("revenue_total", r1(p.revenue ?? 0), p.finished);
  put("cost_avg_service", r1(p.avg_amount), p.n_amount);
  put("cost_deviation_pct", r1(p.cost_deviation), p.n_deviation);
  put("untariffed_pct", p.finished > 0 ? r1((p.n_untariffed / p.finished) * 100) : null, p.finished);

  // ── 2. Estado actual de la operación (KPIs "en vivo") ──────────────────
  const lParams: unknown[] = [];
  const lWhere = assistanceFilters(f, lParams, { period: false });
  lParams.push(Date.now());
  const nowIdx = lParams.length;
  const live = await db.query(
    `${svcCte(lWhere)}
     SELECT COUNT(*) FILTER (WHERE status IN ('pending','searching'))::int AS pending,
            COUNT(*) FILTER (WHERE status IN ('assigned','technician_assigned','awaiting_acceptance'))::int AS assigned,
            COUNT(*) FILTER (WHERE status = 'en_route')::int AS en_route,
            COUNT(*) FILTER (WHERE status IN ('arrived','in_progress'))::int AS in_progress,
            COUNT(*) FILTER (WHERE status IN ('${ACTIVE_STATUSES.join("','")}')
                               AND "slaDeadlineAtMs" IS NOT NULL
                               AND "slaDeadlineAtMs" < $${nowIdx}
                               AND arrived_at IS NULL)::int AS delayed,
            COUNT(*) FILTER (WHERE status = 'finished' AND "invoicedAtMs" IS NULL)::int AS pending_invoice
       FROM svc`,
    lParams,
  );
  const l = live.rows[0];
  put("services_pending", l.pending);
  put("services_assigned", l.assigned);
  put("services_en_route", l.en_route);
  put("services_in_progress", l.in_progress);
  put("services_delayed", l.delayed);
  put("pending_invoice_count", l.pending_invoice);

  // ── 3. Ofertas, reasignaciones y proveedores ──────────────────────────
  const aParams: unknown[] = [f.from, f.to];
  let aWhere = `asg."sentAtMs" BETWEEN $1 AND $2`;
  if (f.workshopId) { aParams.push(f.workshopId); aWhere += ` AND asg."workshopId" = $${aParams.length}`; }
  if (f.providerCompanyId) { aParams.push(f.providerCompanyId); aWhere += ` AND w."providerCompanyId" = $${aParams.length}`; }
  const assignments = await db.query(
    `SELECT COUNT(*)::int AS offered,
            COUNT(*) FILTER (WHERE asg.status = 'accepted')::int AS accepted,
            COUNT(*) FILTER (WHERE asg.status IN ('rejected','expired'))::int AS declined,
            AVG((asg."respondedAtMs" - asg."sentAtMs")/60000.0)
              FILTER (WHERE asg.status = 'accepted' AND asg."respondedAtMs" IS NOT NULL) AS accept_min,
            COUNT(*) FILTER (WHERE asg.status = 'accepted' AND asg."respondedAtMs" IS NOT NULL)::int AS n_accept,
            COUNT(DISTINCT asg."assistanceId") FILTER (WHERE asg.rank IS NOT NULL AND asg.rank > 1)::int AS reassigned_ids
       FROM connect_assignments asg
       LEFT JOIN connect_workshops w ON w.id = asg."workshopId"
      WHERE ${aWhere}`,
    aParams,
  );
  const a = assignments.rows[0];
  put("avg_acceptance_min", r1(a.accept_min), a.n_accept);
  put("provider_acceptance_pct", a.offered > 0 ? r1((a.accepted / a.offered) * 100) : null, a.offered);
  put("provider_rejection_pct", a.offered > 0 ? r1((a.declined / a.offered) * 100) : null, a.offered);

  // Reasignados: asistencias del periodo con más de una asignación registrada
  const reassigned = await db.query(
    `${svcCte(pWhere)}
     SELECT COUNT(*) FILTER (WHERE k.n > 1)::int AS reassigned, COUNT(*)::int AS total
       FROM svc
       JOIN LATERAL (SELECT COUNT(*)::int AS n FROM connect_assignments WHERE "assistanceId" = svc.id) k ON true`,
    pParams,
  );
  const rs = reassigned.rows[0];
  put("reassigned_pct", rs.total > 0 ? r1((rs.reassigned / rs.total) * 100) : null, rs.total);

  // Score medio de la red (o del taller filtrado)
  const scoreParams: unknown[] = [];
  let scoreWhere = `"connectStatus" <> 'excluded'`;
  if (f.workshopId) { scoreParams.push(f.workshopId); scoreWhere += ` AND id = $${scoreParams.length}`; }
  if (f.providerCompanyId) { scoreParams.push(f.providerCompanyId); scoreWhere += ` AND "providerCompanyId" = $${scoreParams.length}`; }
  const score = await db.query(
    `SELECT AVG("currentScore") AS avg_score, COUNT(*)::int AS n FROM connect_workshops WHERE ${scoreWhere}`,
    scoreParams,
  );
  put("provider_score", r1(score.rows[0].avg_score), score.rows[0].n);
  put("provider_services", p.finished, p.finished);

  // ── 4. Flota (unidades móviles) ───────────────────────────────────────
  const fParams: unknown[] = [Date.now() - 15 * 60_000];
  let fWhere = `1 = 1`;
  if (f.providerCompanyId) { fParams.push(f.providerCompanyId); fWhere += ` AND "providerCompanyId" = $${fParams.length}`; }
  const fleet = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('available','at_base'))::int AS available,
            COUNT(*) FILTER (WHERE status IN ('assigned','en_route_to_assistance','working','reserved','finishing','waiting_material','waiting_instructions'))::int AS busy,
            COUNT(*) FILTER (WHERE status IN ('out_of_service','breakdown','no_connection','unavailable'))::int AS out,
            COUNT(*) FILTER (WHERE "activeAssistanceId" IS NOT NULL)::int AS with_service,
            COUNT(*) FILTER (WHERE "activeAssistanceId" IS NOT NULL
                               AND ("lastReportAtMs" IS NULL OR "lastReportAtMs" < $1))::int AS stale_gps
       FROM connect_mobile_units WHERE ${fWhere}`,
    fParams,
  );
  const fl = fleet.rows[0];
  put("fleet_availability_pct", fl.total > 0 ? r1((fl.available / fl.total) * 100) : null, fl.total);
  put("fleet_utilization_pct", fl.total > 0 ? r1((fl.busy / fl.total) * 100) : null, fl.total);
  put("fleet_out_of_service", fl.out, fl.total);
  put("no_gps_pct", fl.with_service > 0 ? r1((fl.stale_gps / fl.with_service) * 100) : null, fl.with_service);
  put("fleet_services_per_unit", fl.total > 0 ? r1(p.finished / fl.total) : null, fl.total);

  // ── 5. Calidad (incidencias) ──────────────────────────────────────────
  const iParams: unknown[] = [f.from, f.to];
  let iWhere = `i."createdAtMs" BETWEEN $1 AND $2`;
  if (f.providerCompanyId) { iParams.push(f.providerCompanyId); iWhere += ` AND i."providerCompanyId" = $${iParams.length}`; }
  if (f.workshopId) { iParams.push(f.workshopId); iWhere += ` AND i."workshopId" = $${iParams.length}`; }
  const incidents = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE type IN ('complaint','damages'))::int AS complaints,
            COUNT(*) FILTER (WHERE type IN ('incomplete_docs','insufficient_photos','incomplete_service'))::int AS docs,
            AVG(("resolvedAtMs" - "createdAtMs")/60000.0) FILTER (WHERE "resolvedAtMs" IS NOT NULL) AS resolution_min,
            COUNT(*) FILTER (WHERE "resolvedAtMs" IS NOT NULL)::int AS n_resolved
       FROM connect_incidents i WHERE ${iWhere}`,
    iParams,
  );
  const inc = incidents.rows[0];
  put("incidents_total", inc.total, inc.total);
  put("complaints_total", inc.complaints, inc.total);
  put("incident_resolution_min", r1(inc.resolution_min), inc.n_resolved);
  put("incomplete_docs_pct", p.finished > 0 ? r1((inc.docs / p.finished) * 100) : null, p.finished);
  put("provider_incidents", inc.total, inc.total);

  // ── 6. Precisión del ETA (predicciones ya evaluadas) ──────────────────
  const eta = await db.query(
    `SELECT AVG("predictedValue") AS avg_eta, COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE "actualValue" IS NOT NULL)::int AS n_eval,
            COUNT(*) FILTER (WHERE "actualValue" IS NOT NULL AND "actualValue" <= "predictedValue" + 10)::int AS on_time
       FROM ai_prediction
      WHERE "predictionType" = 'eta' AND "predictionAtMs" BETWEEN $1 AND $2`,
    [f.from, f.to],
  );
  const e = eta.rows[0];
  put("eta_predicted_min", r1(e.avg_eta), e.n);
  put("provider_eta_accuracy_pct", e.n_eval > 0 ? r1((e.on_time / e.n_eval) * 100) : null, e.n_eval);

  // ── 7. KPIs del catálogo sin fuente de datos todavía ──────────────────
  for (const def of KPI_CATALOG) {
    if (def.available === false) {
      out[def.code] = { code: def.code, value: null, sampleSize: 0, available: false, missingData: def.missingData };
    } else if (!out[def.code]) {
      out[def.code] = { code: def.code, value: null, sampleSize: 0, available: true };
    }
  }
  return out;
}

/**
 * Semáforo del KPI. Gris cuando no hay dato o no hay muestra suficiente:
 * preferimos "datos insuficientes" a un verde engañoso.
 */
export function kpiStatus(def: KpiDefinition, value: number | null, sampleSize: number, minSample = 1): KpiStatus {
  if (value === null || def.available === false) return "grey";
  if (def.targetValue == null) return sampleSize >= minSample ? "green" : "grey";
  if (sampleSize < minSample) return "grey";

  const target = def.targetValue;
  const warn = def.warningThreshold ?? 0.1;
  const crit = def.criticalThreshold ?? 0.25;

  // Desviación relativa en la dirección "mala". Con objetivo 0 se usa la
  // magnitud absoluta como desviación (p. ej. "0 servicios con retraso").
  const deviation = def.direction === "down_good"
    ? (target === 0 ? value : (value - target) / Math.abs(target))
    : (target === 0 ? -value : (target - value) / Math.abs(target));

  if (deviation <= warn) return "green";
  if (deviation <= crit) return "amber";
  return "red";
}

export interface KpiCardOutput {
  code: string;
  name: string;
  category: string;
  unit: string;
  description: string;
  direction: string;
  value: number | null;
  target: number | null;
  status: KpiStatus;
  sampleSize: number;
  available: boolean;
  missingData?: string;
  vsPrevDay: number | null;
  vsPrevWeek: number | null;
  trend: "up" | "down" | "flat" | null;
  isLive: boolean;
}

/** Variación porcentual entre dos valores; null si no es interpretable. */
function variation(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/**
 * Devuelve las tarjetas del panel con valor, objetivo, semáforo, variaciones y
 * tendencia. Las comparativas de los KPIs "en vivo" salen de las fotos que
 * guarda el worker en operational_kpi_value (no se pueden recalcular a pasado).
 */
export async function buildKpiCards(
  codes: string[],
  f: KpiFilters,
  overrides: Record<string, Partial<KpiDefinition>> = {},
): Promise<KpiCardOutput[]> {
  const span = Math.max(f.to - f.from, 60_000);
  const [current, prevDay, prevWeek] = await Promise.all([
    computeKpis(f),
    computeKpis({ ...f, from: f.from - span, to: f.to - span }),
    computeKpis({ ...f, from: f.from - 7 * 86400_000, to: f.to - 7 * 86400_000 }),
  ]);

  const liveCodes = codes.filter(isLiveKpi);
  const snapshots = liveCodes.length ? await loadLiveSnapshots(liveCodes) : {};

  return codes.map((code) => {
    const base = KPI_BY_CODE[code];
    if (!base) {
      return {
        code, name: code, category: "operational", unit: "", description: "", direction: "up_good",
        value: null, target: null, status: "grey" as KpiStatus, sampleSize: 0, available: false,
        missingData: "KPI no definido en el catálogo", vsPrevDay: null, vsPrevWeek: null, trend: null, isLive: false,
      };
    }
    const def: KpiDefinition = { ...base, ...(overrides[code] ?? {}) };
    const res = current[code] ?? { code, value: null, sampleSize: 0, available: def.available !== false };
    const live = isLiveKpi(code);
    const prevD = live ? (snapshots[code]?.day ?? null) : (prevDay[code]?.value ?? null);
    const prevW = live ? (snapshots[code]?.week ?? null) : (prevWeek[code]?.value ?? null);
    const vsPrevDay = variation(res.value, prevD);
    const better = def.direction === "down_good" ? -1 : 1;

    return {
      code: def.code,
      name: def.name,
      category: def.category,
      unit: def.unit,
      description: def.description,
      direction: def.direction,
      value: res.value,
      target: def.targetValue ?? null,
      status: kpiStatus(def, res.value, res.sampleSize),
      sampleSize: res.sampleSize,
      available: res.available,
      missingData: res.missingData ?? def.missingData,
      vsPrevDay,
      vsPrevWeek: variation(res.value, prevW),
      trend: vsPrevDay === null ? null : vsPrevDay * better > 1 ? "up" : vsPrevDay * better < -1 ? "down" : "flat",
      isLive: live,
    };
  });
}

/** Últimas fotos guardadas hace ~1 día y ~7 días de los KPIs en vivo. */
async function loadLiveSnapshots(codes: string[]): Promise<Record<string, { day: number | null; week: number | null }>> {
  const now = Date.now();
  const r = await db.query(
    `SELECT "kpiCode",
            (SELECT value FROM operational_kpi_value v2
              WHERE v2."kpiCode" = v."kpiCode" AND v2."entityType" = 'global' AND v2.granularity = 'live'
                AND v2."periodEnd" <= $2 ORDER BY v2."periodEnd" DESC LIMIT 1) AS day_value,
            (SELECT value FROM operational_kpi_value v3
              WHERE v3."kpiCode" = v."kpiCode" AND v3."entityType" = 'global' AND v3.granularity = 'live'
                AND v3."periodEnd" <= $3 ORDER BY v3."periodEnd" DESC LIMIT 1) AS week_value
       FROM operational_kpi_value v
      WHERE v."kpiCode" = ANY($1::text[]) AND v.granularity = 'live'
      GROUP BY v."kpiCode"`,
    [codes, now - 86400_000, now - 7 * 86400_000],
  );
  const out: Record<string, { day: number | null; week: number | null }> = {};
  for (const row of r.rows) {
    out[row.kpiCode] = {
      day: row.day_value != null ? Number(row.day_value) : null,
      week: row.week_value != null ? Number(row.week_value) : null,
    };
  }
  return out;
}

/**
 * Guarda una foto de los KPIs (la ejecuta el worker). `granularity` distingue
 * las fotos instantáneas ("live", cada pocos minutos) de los cierres diarios.
 */
export async function snapshotKpis(granularity: "live" | "day", f: KpiFilters): Promise<number> {
  const values = await computeKpis(f);
  const now = Date.now();
  let saved = 0;
  for (const [code, res] of Object.entries(values)) {
    if (res.value === null) continue;
    const def = KPI_BY_CODE[code];
    if (!def) continue;
    if (granularity === "live" && !isLiveKpi(code)) continue;
    await db.query(
      `INSERT INTO operational_kpi_value
         ("kpiCode", "entityType", "entityId", "periodStart", "periodEnd", granularity,
          value, "targetValue", "sampleSize", status, "calculatedAtMs")
       VALUES ($1,'global',NULL,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT ("kpiCode", "entityType", COALESCE("entityId", ''), "periodStart", granularity)
       DO UPDATE SET value = EXCLUDED.value, "sampleSize" = EXCLUDED."sampleSize",
                     status = EXCLUDED.status, "calculatedAtMs" = EXCLUDED."calculatedAtMs"`,
      [
        code, f.from, f.to, granularity, res.value, def.targetValue ?? null, res.sampleSize,
        kpiStatus(def, res.value, res.sampleSize), now,
      ],
    );
    saved++;
  }
  return saved;
}

/** Serie temporal de un KPI a partir de las fotos guardadas. */
export async function kpiSeries(code: string, granularity: string, limit = 60): Promise<Array<{ t: number; value: number; status: string }>> {
  const r = await db.query(
    `SELECT "periodEnd", value, status FROM operational_kpi_value
      WHERE "kpiCode" = $1 AND granularity = $2 AND "entityType" = 'global'
      ORDER BY "periodEnd" DESC LIMIT $3`,
    [code, granularity, Math.min(limit, 500)],
  );
  return r.rows.reverse().map((x) => ({ t: Number(x.periodEnd), value: Number(x.value), status: x.status }));
}

/**
 * Serie diaria calculada al vuelo (para gráficas de tendencia sin depender de
 * que el worker lleve semanas ejecutándose).
 */
export async function dailyTrend(f: KpiFilters, days: number): Promise<Array<Record<string, unknown>>> {
  const params: unknown[] = [];
  const where = assistanceFilters({ ...f, from: f.to - days * 86400_000, to: f.to }, params, { period: true });
  const r = await db.query(
    `${svcCte(where)}
     SELECT (("createdAtMs" / 86400000)::bigint * 86400000) AS day,
            COUNT(*)::int AS received,
            COUNT(*) FILTER (WHERE status = 'finished')::int AS finished,
            COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            AVG((assigned_at - "createdAtMs")/60000.0) AS assignment_min,
            AVG((arrived_at - "createdAtMs")/60000.0) AS arrival_min,
            COUNT(*) FILTER (WHERE "slaDeadlineAtMs" IS NOT NULL)::int AS n_sla,
            COUNT(*) FILTER (WHERE "slaDeadlineAtMs" IS NOT NULL AND arrived_at IS NOT NULL AND arrived_at <= "slaDeadlineAtMs")::int AS sla_ok,
            SUM(amount) FILTER (WHERE status = 'finished') AS revenue
       FROM svc GROUP BY 1 ORDER BY 1`,
    params,
  );
  return r.rows.map((x) => ({
    day: Number(x.day),
    received: x.received,
    finished: x.finished,
    cancelled: x.cancelled,
    assignmentMin: r1(x.assignment_min),
    arrivalMin: r1(x.arrival_min),
    slaPct: x.n_sla > 0 ? r1((x.sla_ok / x.n_sla) * 100) : null,
    revenue: r1(x.revenue ?? 0),
  }));
}
