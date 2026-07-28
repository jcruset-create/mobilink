/**
 * Connect Pro — Centro de Inteligencia Operacional.
 *
 * Reutiliza los datos operacionales existentes (connect_assistances,
 * connect_assignments, connect_status_history, tarifas y alertas) sin
 * duplicarlos. Tres motores:
 *
 *   1. KPIs por ventana temporal con objetivo/semáforo y comparativas
 *      (hoy vs ayer vs misma jornada de la semana pasada).
 *   2. Predicción de demanda por hora (perfil histórico día-de-semana ×
 *      hora sobre 8 semanas, con intervalo de confianza) y medición
 *      continua de su precisión contra la demanda real.
 *   3. Recomendaciones accionables y explicables (picos de demanda,
 *      riesgo de SLA masivo, degradación de proveedor, huecos de
 *      cobertura), con aceptación/rechazo auditados.
 *
 * La IA actúa como sistema de recomendación: nunca ejecuta acciones solas.
 */

import db from "../db.ts";

// ────────────────────────────────────────────────────────────
// 1. KPIs
// ────────────────────────────────────────────────────────────

export interface KpiMetrics {
  created_today: number;
  pending_assign: number;
  active_now: number;
  delayed_now: number;
  avg_assign_min: number | null;
  avg_arrival_min: number | null;
  avg_resolution_min: number | null;
  sla_pct: number | null;
  acceptance_pct: number | null;
  cancel_pct: number | null;
  eta_accuracy_min: number | null;
  avg_cost: number | null;
  billing_today: number;
}

/** Calcula todas las métricas de una ventana [from, to). Los KPI "now" solo tienen sentido con to≈ahora. */
export async function computeMetrics(from: number, to: number): Promise<KpiMetrics> {
  const [counts, times, offers, eta, costs] = await Promise.all([
    db.query(
      `SELECT COUNT(*) FILTER (WHERE "createdAtMs" BETWEEN $1 AND $2 AND status <> 'draft')::int AS created,
              COUNT(*) FILTER (WHERE status IN ('pending','searching'))::int AS pending,
              COUNT(*) FILTER (WHERE status IN ('assigned','technician_assigned','en_route','arrived','in_progress','returning_to_workshop'))::int AS active,
              COUNT(*) FILTER (WHERE "slaDeadlineAtMs" IS NOT NULL AND "slaDeadlineAtMs" < $2
                AND status NOT IN ('finished','at_workshop','returning_to_workshop','cancelled','draft','arrived','in_progress'))::int AS delayed,
              COUNT(*) FILTER (WHERE "createdAtMs" BETWEEN $1 AND $2 AND status = 'cancelled')::int AS cancelled,
              COUNT(*) FILTER (WHERE "createdAtMs" BETWEEN $1 AND $2 AND status IN ('finished','at_workshop','cancelled'))::int AS closed
         FROM connect_assistances`,
      [from, to],
    ),
    db.query(
      `SELECT AVG(asg.min) AS assign_min, AVG(arr.min) AS arrival_min, AVG(fin.min) AS resolution_min,
              COUNT(*) FILTER (WHERE ca."slaDeadlineAtMs" IS NOT NULL)::int AS sla_total,
              COUNT(*) FILTER (WHERE ca."slaDeadlineAtMs" IS NOT NULL AND arrts.ms <= ca."slaDeadlineAtMs")::int AS sla_ok
         FROM connect_assistances ca
         LEFT JOIN LATERAL (SELECT (h2."occurredAtMs" - h1."occurredAtMs")/60000.0 AS min
            FROM connect_status_history h1 JOIN connect_status_history h2 ON h1."assistanceId" = h2."assistanceId"
           WHERE h1."assistanceId" = ca.id AND h1."toStatus" = 'pending' AND h2."toStatus" = 'assigned' LIMIT 1) asg ON true
         LEFT JOIN LATERAL (SELECT (h2."occurredAtMs" - h1."occurredAtMs")/60000.0 AS min
            FROM connect_status_history h1 JOIN connect_status_history h2 ON h1."assistanceId" = h2."assistanceId"
           WHERE h1."assistanceId" = ca.id AND h1."toStatus" = 'assigned' AND h2."toStatus" = 'arrived' LIMIT 1) arr ON true
         LEFT JOIN LATERAL (SELECT (h2."occurredAtMs" - h1."occurredAtMs")/60000.0 AS min
            FROM connect_status_history h1 JOIN connect_status_history h2 ON h1."assistanceId" = h2."assistanceId"
           WHERE h1."assistanceId" = ca.id AND h1."toStatus" = 'arrived' AND h2."toStatus" = 'finished' LIMIT 1) fin ON true
         LEFT JOIN LATERAL (SELECT "occurredAtMs" AS ms FROM connect_status_history
           WHERE "assistanceId" = ca.id AND "toStatus" = 'arrived' ORDER BY id LIMIT 1) arrts ON true
        WHERE ca."createdAtMs" BETWEEN $1 AND $2 AND ca.status <> 'draft'`,
      [from, to],
    ),
    db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted,
              COUNT(*) FILTER (WHERE status IN ('rejected','expired'))::int AS declined
         FROM connect_assignments WHERE "sentAtMs" BETWEEN $1 AND $2`,
      [from, to],
    ),
    db.query(
      // Desvío |llegada real − ETA prevista| de asignaciones aceptadas
      `SELECT AVG(ABS(arr.actual - (asg."scoreBreakdown"::json->>'etaMinutes')::float)) AS dev
         FROM connect_assignments asg
         JOIN LATERAL (
           SELECT (h2."occurredAtMs" - h1."occurredAtMs")/60000.0 AS actual
             FROM connect_status_history h1 JOIN connect_status_history h2 ON h1."assistanceId" = h2."assistanceId"
            WHERE h1."assistanceId" = asg."assistanceId" AND h1."toStatus" = 'assigned' AND h2."toStatus" = 'arrived' LIMIT 1
         ) arr ON true
        WHERE asg.status = 'accepted' AND asg."sentAtMs" BETWEEN $1 AND $2
          AND (asg."scoreBreakdown"::json->>'etaMinutes') IS NOT NULL`,
      [from, to],
    ),
    db.query(
      `SELECT AVG(COALESCE("finalCost", "estimatedCost")) AS avg_cost,
              COALESCE(SUM(COALESCE("finalCost", "estimatedCost")), 0) AS billing
         FROM connect_assistances
        WHERE "createdAtMs" BETWEEN $1 AND $2 AND status = 'finished'`,
      [from, to],
    ),
  ]);

  const c = counts.rows[0]; const t = times.rows[0]; const o = offers.rows[0];
  const offered = o.accepted + o.declined;
  const n = (v: unknown) => (v != null ? Math.round(Number(v) * 10) / 10 : null);
  return {
    created_today: c.created,
    pending_assign: c.pending,
    active_now: c.active,
    delayed_now: c.delayed,
    avg_assign_min: n(t.assign_min),
    avg_arrival_min: n(t.arrival_min),
    avg_resolution_min: n(t.resolution_min),
    sla_pct: t.sla_total > 0 ? Math.round((t.sla_ok / t.sla_total) * 100) : null,
    acceptance_pct: offered > 0 ? Math.round((o.accepted / offered) * 100) : null,
    cancel_pct: c.closed > 0 ? Math.round((c.cancelled / c.closed) * 100) : null,
    eta_accuracy_min: n(eta.rows[0].dev),
    avg_cost: n(costs.rows[0].avg_cost),
    billing_today: Math.round(Number(costs.rows[0].billing) * 100) / 100,
  };
}

function dayWindow(offsetDays: number): [number, number] {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const start = d.getTime() - offsetDays * 24 * 3600_000;
  return [start, start + 24 * 3600_000];
}

export function kpiStatus(
  value: number | null, direction: string,
  target: number | null, warn: number | null, crit: number | null,
): "green" | "yellow" | "red" | "gray" {
  if (value == null) return "gray";
  if (target == null && warn == null && crit == null) return "gray";
  const worse = (a: number, b: number) => (direction === "higher_better" ? a < b : a > b);
  if (crit != null && worse(value, crit)) return "red";
  if (warn != null && worse(value, warn)) return "yellow";
  return "green";
}

/** Dashboard: KPI actuales con objetivo, semáforo y variaciones vs ayer y vs hace 7 días. */
export async function kpiDashboard() {
  const now = Date.now();
  const [todayStart] = dayWindow(0);
  const [today, yesterday, lastWeek, defs] = await Promise.all([
    computeMetrics(todayStart, now),
    computeMetrics(...dayWindow(1)),
    computeMetrics(...dayWindow(7)),
    db.query(`SELECT * FROM connect_kpi_definitions WHERE active ORDER BY "sortOrder"`),
  ]);
  return defs.rows.map((d) => {
    const value = (today as any)[d.code] ?? null;
    const prev = (yesterday as any)[d.code] ?? null;
    const week = (lastWeek as any)[d.code] ?? null;
    return {
      code: d.code, name: d.name, category: d.category, unit: d.unit,
      direction: d.direction,
      value,
      target: d.targetValue,
      status: kpiStatus(value, d.direction, d.targetValue, d.warningThreshold, d.criticalThreshold),
      vs_yesterday: value != null && prev != null ? Math.round((value - prev) * 10) / 10 : null,
      vs_last_week: value != null && week != null ? Math.round((value - week) * 10) / 10 : null,
    };
  });
}

/** Cierra el snapshot diario de KPIs del día anterior (idempotente). */
export async function storeDailyKpiSnapshot(): Promise<void> {
  const [from, to] = dayWindow(1);
  const periodDate = new Date(from).toISOString().slice(0, 10);
  const exists = await db.query(`SELECT 1 FROM connect_kpi_values WHERE "periodDate" = $1 LIMIT 1`, [periodDate]);
  if (exists.rows[0]) return;
  const m = await computeMetrics(from, to);
  const now = Date.now();
  for (const [code, value] of Object.entries(m)) {
    await db.query(
      `INSERT INTO connect_kpi_values ("kpiCode", "periodDate", value, "calculatedAtMs")
       VALUES ($1, $2, $3, $4) ON CONFLICT ("kpiCode", "periodDate") DO NOTHING`,
      [code, periodDate, value, now],
    );
  }
}

// ────────────────────────────────────────────────────────────
// 2. Predicción de demanda (perfil histórico hora × día de semana)
// ────────────────────────────────────────────────────────────

function hourKey(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}`;
}

/** Predice la demanda por hora de las próximas 24 h y la persiste. */
export async function predictDemand(): Promise<void> {
  const weeks = 8;
  const now = Date.now();
  const since = now - weeks * 7 * 24 * 3600_000;
  // Conteo por (dow, hora) del histórico
  const hist = await db.query(
    `SELECT EXTRACT(DOW FROM to_timestamp("createdAtMs"/1000))::int AS dow,
            EXTRACT(HOUR FROM to_timestamp("createdAtMs"/1000))::int AS hour,
            to_char(to_timestamp("createdAtMs"/1000), 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS n
       FROM connect_assistances
      WHERE "createdAtMs" >= $1 AND status <> 'draft'
      GROUP BY 1, 2, 3`,
    [since],
  );
  // media y desviación por celda (dow,hora) contando también los ceros
  const cell = new Map<string, number[]>();
  for (const r of hist.rows) {
    const k = `${r.dow}-${r.hour}`;
    if (!cell.has(k)) cell.set(k, []);
    cell.get(k)!.push(r.n);
  }
  const stats = (k: string) => {
    const values = cell.get(k) ?? [];
    while (values.length < weeks) values.push(0); // semanas sin actividad = 0
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    return { mean, sd, n: values.length };
  };

  for (let h = 1; h <= 24; h++) {
    const target = new Date(now + h * 3600_000);
    target.setMinutes(0, 0, 0);
    const { mean, sd, n } = stats(`${target.getDay()}-${target.getHours()}`);
    const ci = 1.96 * (sd / Math.sqrt(Math.max(1, n)));
    await db.query(
      `INSERT INTO connect_predictions
         ("predictionType", "targetKey", "predictedValue", "confidenceMin", "confidenceMax", "sampleSize", "createdAtMs")
       VALUES ('demand_hourly', $1, $2, $3, $4, $5, $6)
       ON CONFLICT ("predictionType", "targetKey")
       DO UPDATE SET "predictedValue" = EXCLUDED."predictedValue",
                     "confidenceMin" = EXCLUDED."confidenceMin",
                     "confidenceMax" = EXCLUDED."confidenceMax"`,
      [hourKey(target), Math.round(mean * 100) / 100, Math.max(0, Math.round((mean - ci) * 100) / 100),
       Math.round((mean + ci) * 100) / 100, n, now],
    );
  }
}

/** Rellena la demanda real de horas ya pasadas y calcula el error (precisión del modelo). */
export async function backfillDemandActuals(): Promise<void> {
  const pending = await db.query(
    `SELECT id, "targetKey", "predictedValue" FROM connect_predictions
      WHERE "predictionType" = 'demand_hourly' AND "actualValue" IS NULL
      ORDER BY id LIMIT 100`,
  );
  const now = new Date();
  for (const p of pending.rows) {
    const start = new Date(`${p.targetKey}:00:00`);
    const end = new Date(start.getTime() + 3600_000);
    if (end.getTime() > now.getTime()) continue; // la hora aún no ha terminado
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistances
        WHERE "createdAtMs" >= $1 AND "createdAtMs" < $2 AND status <> 'draft'`,
      [start.getTime(), end.getTime()],
    );
    const actual = r.rows[0].n;
    await db.query(
      `UPDATE connect_predictions SET "actualValue" = $1, "errorValue" = $2 WHERE id = $3`,
      [actual, Math.abs(actual - Number(p.predictedValue)), p.id],
    );
  }
}

/** Próximas 24 h de demanda prevista + precisión reciente del modelo (MAE 7 días). */
export async function demandOutlook() {
  const [forecast, precision] = await Promise.all([
    db.query(
      `SELECT "targetKey", "predictedValue", "confidenceMin", "confidenceMax", "sampleSize"
         FROM connect_predictions
        WHERE "predictionType" = 'demand_hourly' AND "targetKey" >= $1
        ORDER BY "targetKey" LIMIT 24`,
      [hourKey(new Date())],
    ),
    db.query(
      `SELECT AVG("errorValue") AS mae, COUNT(*)::int AS n
         FROM connect_predictions
        WHERE "predictionType" = 'demand_hourly' AND "actualValue" IS NOT NULL
          AND "createdAtMs" >= $1`,
      [Date.now() - 7 * 24 * 3600_000],
    ),
  ]);
  return {
    forecast: forecast.rows,
    precision: {
      mae: precision.rows[0].mae != null ? Math.round(Number(precision.rows[0].mae) * 100) / 100 : null,
      evaluated_hours: precision.rows[0].n,
    },
  };
}

// ────────────────────────────────────────────────────────────
// 3. Recomendaciones (reglas explicables sobre los datos reales)
// ────────────────────────────────────────────────────────────

async function alreadyOpen(type: string, entityId: string | null): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM connect_recommendations
      WHERE "recommendationType" = $1 AND COALESCE("entityId",'') = COALESCE($2,'')
        AND status = 'open' AND "createdAtMs" > $3 LIMIT 1`,
    [type, entityId, Date.now() - 6 * 3600_000],
  );
  return r.rows.length > 0;
}

async function recommend(opts: {
  type: string; title: string; description: string; priority?: "low" | "medium" | "high";
  explanation?: string; proposedAction?: string; expectedImpact?: string;
  entityType?: string; entityId?: string;
}): Promise<boolean> {
  if (await alreadyOpen(opts.type, opts.entityId ?? null)) return false;
  await db.query(
    `INSERT INTO connect_recommendations
       ("recommendationType", title, description, priority, explanation, "proposedAction",
        "expectedImpact", "entityType", "entityId", "expiresAtMs", "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [opts.type, opts.title, opts.description, opts.priority ?? "medium", opts.explanation ?? null,
     opts.proposedAction ?? null, opts.expectedImpact ?? null, opts.entityType ?? null,
     opts.entityId ?? null, Date.now() + 24 * 3600_000, Date.now()],
  );
  return true;
}

export async function generateRecommendations(): Promise<number> {
  const now = Date.now();
  let created = 0;

  // 1. Pico de demanda previsto en las próximas 3 h (>50 % sobre la media prevista del día)
  const next3 = await db.query(
    `SELECT SUM("predictedValue") AS sum3,
            (SELECT AVG("predictedValue") FROM connect_predictions
              WHERE "predictionType" = 'demand_hourly' AND "targetKey" >= $1 LIMIT 24) AS avg_hour
       FROM (SELECT "predictedValue" FROM connect_predictions
              WHERE "predictionType" = 'demand_hourly' AND "targetKey" >= $1
              ORDER BY "targetKey" LIMIT 3) t`,
    [hourKey(new Date())],
  );
  const sum3 = Number(next3.rows[0].sum3 ?? 0);
  const avgHour = Number(next3.rows[0].avg_hour ?? 0);
  if (avgHour > 0 && sum3 > 3 * avgHour * 1.5 && sum3 >= 3) {
    if (await recommend({
      type: "demand_peak", priority: "high",
      title: `Pico de demanda previsto: ~${Math.round(sum3)} servicios en las próximas 3 horas`,
      description: `La demanda prevista para las próximas 3 horas es un ${Math.round(((sum3 / 3) / avgHour - 1) * 100)} % superior a la media horaria del día.`,
      explanation: `Modelo de perfil horario (8 semanas). Previsión 3 h: ${Math.round(sum3)}; media horaria: ${avgHour.toFixed(1)}.`,
      proposedAction: "Revisar disponibilidad de unidades y reforzar la franja con recursos adicionales.",
      expectedImpact: "Evitar retrasos de asignación durante el pico.",
    })) created++;
  }

  // 2. Varios servicios activos con riesgo de SLA
  const risk = await db.query(
    `SELECT COUNT(*)::int AS n FROM connect_assistances
      WHERE "slaDeadlineAtMs" IS NOT NULL AND "slaDeadlineAtMs" < $1
        AND status IN ('pending','searching','awaiting_acceptance','assigned','technician_assigned','en_route')`,
    [now + 30 * 60_000],
  );
  if (risk.rows[0].n >= 3) {
    if (await recommend({
      type: "sla_risk_bulk", priority: "high",
      title: `${risk.rows[0].n} servicios activos con riesgo de incumplir el SLA en 30 minutos`,
      description: "Varios servicios en curso agotarán su SLA en la próxima media hora sin haber llegado al punto.",
      explanation: "Servicios con slaDeadline dentro de 30 min y sin estado 'en el lugar'.",
      proposedAction: "Priorizar estos servicios en el Centro de control: contactar talleres, valorar reasignaciones.",
      expectedImpact: "Reducir incumplimientos de SLA del día.",
    })) created++;
  }

  // 3. Degradación de proveedor: llegada media +25 % vs las 2 semanas anteriores
  const degradation = await db.query(
    `SELECT w.id, w.name,
            AVG(CASE WHEN ca."createdAtMs" >= $1 THEN arr.min END) AS recent,
            AVG(CASE WHEN ca."createdAtMs" < $1 AND ca."createdAtMs" >= $2 THEN arr.min END) AS previous
       FROM connect_workshops w
       JOIN connect_assistances ca ON ca."workshopId" = w.id
       JOIN LATERAL (SELECT (h2."occurredAtMs" - h1."occurredAtMs")/60000.0 AS min
          FROM connect_status_history h1 JOIN connect_status_history h2 ON h1."assistanceId" = h2."assistanceId"
         WHERE h1."assistanceId" = ca.id AND h1."toStatus" = 'assigned' AND h2."toStatus" = 'arrived' LIMIT 1) arr ON true
      WHERE ca."createdAtMs" >= $2
      GROUP BY w.id, w.name
     HAVING COUNT(*) FILTER (WHERE ca."createdAtMs" >= $1) >= 5`,
    [now - 14 * 24 * 3600_000, now - 28 * 24 * 3600_000],
  );
  for (const d of degradation.rows) {
    if (d.recent != null && d.previous != null && Number(d.recent) > Number(d.previous) * 1.25) {
      if (await recommend({
        type: "provider_degradation", priority: "medium",
        entityType: "workshop", entityId: String(d.id),
        title: `${d.name}: el tiempo medio de llegada ha empeorado un ${Math.round((Number(d.recent) / Number(d.previous) - 1) * 100)} %`,
        description: `Llegada media reciente ${Math.round(d.recent)} min frente a ${Math.round(d.previous)} min en las dos semanas anteriores.`,
        explanation: "Comparativa de tiempo asignación→llegada: últimos 14 días vs 14 anteriores (mínimo 5 servicios).",
        proposedAction: "Revisar con el proveedor las causas (carga, rutas, plantilla) y su ficha de estadísticas.",
        expectedImpact: "Recuperar el tiempo de llegada y el cumplimiento de SLA de la zona.",
      })) created++;
    }
  }

  // 4. Hueco de cobertura: fallos de asignación/cobertura repetidos en 24 h
  const coverage = await db.query(
    `SELECT COUNT(*)::int AS n FROM connect_assistances
      WHERE status IN ('no_coverage','assignment_failed') AND "updatedAtMs" >= $1`,
    [now - 24 * 3600_000],
  );
  if (coverage.rows[0].n >= 2) {
    if (await recommend({
      type: "coverage_gap", priority: "high",
      title: `${coverage.rows[0].n} servicios sin proveedor en las últimas 24 horas`,
      description: "Se están recibiendo servicios que ningún taller de la red puede cubrir.",
      explanation: "Asistencias en estado sin cobertura o fallo de asignación durante las últimas 24 h.",
      proposedAction: "Revisar en el mapa las zonas afectadas y valorar ampliar radios de cobertura o incorporar proveedores.",
      expectedImpact: "Aumentar la tasa de asignación al primer intento.",
    })) created++;
  }

  // 5. Recomendación comercial: taller EXTERNO con volumen suficiente para
  //    implantar Mobilink Assist (umbral: ≥20 asistencias/30 días o ≥50/90 días).
  //    Nunca se envía nada automáticamente: solo se alerta al gestor comercial.
  const commercial = await db.query(
    `SELECT w.id, w.name,
            COUNT(*) FILTER (WHERE ca."createdAtMs" >= $1)::int AS n30,
            COUNT(*) FILTER (WHERE ca."createdAtMs" >= $2)::int AS n90,
            COUNT(*) FILTER (WHERE ca."createdAtMs" >= $2 AND ca.status = 'finished')::int AS finished90
       FROM connect_workshops w
       JOIN connect_assistances ca ON ca."workshopId" = w.id
      WHERE w."integrationType" = 'external'
      GROUP BY w.id, w.name`,
    [now - 30 * 24 * 3600_000, now - 90 * 24 * 3600_000],
  );
  for (const c of commercial.rows) {
    if (c.n30 >= 20 || c.n90 >= 50) {
      const clasificacion = c.n30 >= 40 ? "taller estratégico" : c.n30 >= 20 ? "colaborador frecuente" : "colaborador recurrente";
      if (await recommend({
        type: "commercial_assist", priority: "medium",
        entityType: "workshop", entityId: String(c.id),
        title: `${c.name}: volumen suficiente para recomendar la implantación de Mobilink Assist`,
        description: `Taller externo con ${c.n30} asistencias en 30 días y ${c.n90} en 90 días (${c.finished90} finalizadas). Clasificación: ${clasificacion}.`,
        explanation: `Umbral comercial: ≥20 asistencias/30 días o ≥50/90 días. La gestión manual de este volumen supone carga administrativa evitable.`,
        proposedAction: "Preparar propuesta comercial de Mobilink Assist (requiere autorización de un gestor; no se envía nada automáticamente).",
        expectedImpact: "Sincronización automática, menos llamadas manuales y trazabilidad completa del taller.",
      })) created++;
    }
  }

  // Caducar recomendaciones vencidas
  await db.query(
    `UPDATE connect_recommendations SET status = 'expired' WHERE status = 'open' AND "expiresAtMs" < $1`,
    [now],
  );
  return created;
}
