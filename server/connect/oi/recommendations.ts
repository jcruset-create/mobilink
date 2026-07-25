/**
 * Centro de Inteligencia Operacional — motor de recomendaciones.
 *
 * Reglas sobre las predicciones y los KPIs que producen propuestas
 * ACCIONABLES y explicadas: qué se ha detectado, con qué datos, qué factores
 * pesan, qué acción se propone y qué impacto se espera (cap. 7.6 y 16).
 *
 * Principio de diseño: la IA recomienda, la persona decide. Ninguna regla
 * ejecuta cambios por su cuenta; aceptar una recomendación registra la
 * decisión y devuelve el enlace a la pantalla donde ejecutarla. La
 * automatización (fase 6) solo debe abrirse cuando el histórico de
 * aceptación/impacto real demuestre precisión suficiente.
 */

import db from "../../db.ts";
import { findCandidates } from "../service.ts";
import {
  forecastDemand, computeDelayRisks, zoneSaturation, predictEta, loadZones, zoneFor,
} from "./predictions.ts";

export type Priority = "low" | "medium" | "high" | "critical";

export interface RecommendationDraft {
  type: string;
  dedupKey: string;
  title: string;
  description: string;
  priority: Priority;
  affectedEntityType?: string;
  affectedEntityId?: string;
  expectedImpact?: string;
  impactValue?: number;
  impactUnit?: string;
  proposedAction: { type: string; label: string; link?: string; params?: Record<string, unknown> };
  explanation: {
    detected: string;
    dataUsed: string[];
    factors: Array<{ name: string; detail: string }>;
    confidence: number;
    alternatives?: string[];
  };
  expiresInMin?: number;
}

const DAY_MS = 86400_000;

/** Inserta la recomendación si no hay ya una viva con la misma clave. */
async function upsert(d: RecommendationDraft): Promise<boolean> {
  const now = Date.now();
  const r = await db.query(
    `INSERT INTO ai_recommendation
       ("recommendationType","dedupKey",title,description,priority,
        "affectedEntityType","affectedEntityId","expectedImpact","impactValue","impactUnit",
        "proposedAction",explanation,"expiresAtMs","createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT ("dedupKey") WHERE status = 'pending' DO NOTHING
     RETURNING id`,
    [
      d.type, d.dedupKey, d.title, d.description, d.priority,
      d.affectedEntityType ?? null, d.affectedEntityId ?? null,
      d.expectedImpact ?? null, d.impactValue ?? null, d.impactUnit ?? null,
      JSON.stringify(d.proposedAction), JSON.stringify(d.explanation),
      d.expiresInMin ? now + d.expiresInMin * 60_000 : now + 6 * 3600_000,
      now,
    ],
  );
  return r.rows.length > 0;
}

/** Caduca las recomendaciones vencidas para que el panel no acumule ruido. */
export async function expireRecommendations(): Promise<number> {
  const r = await db.query(
    `UPDATE ai_recommendation SET status = 'expired'
      WHERE status = 'pending' AND "expiresAtMs" IS NOT NULL AND "expiresAtMs" < $1
      RETURNING id`,
    [Date.now()],
  );
  return r.rows.length;
}

/**
 * Ejecuta todas las reglas y devuelve cuántas recomendaciones NUEVAS se han
 * generado. Cada regla se aísla: un fallo en una no tumba el resto.
 */
export async function generateRecommendations(): Promise<number> {
  const rules = [
    ruleDemandSurge, ruleCoverageGap, ruleDelayRiskBatch, ruleReassignment,
    ruleProviderDegradation, ruleServiceTypeTrend, ruleUnassignedBacklog, ruleUnbilledServices,
  ];
  let created = 0;
  for (const rule of rules) {
    try {
      created += await rule();
    } catch (err: any) {
      console.error(`[OI] regla ${rule.name} falló:`, err?.message);
    }
  }
  await expireRecommendations();
  return created;
}

// ── Reglas ──────────────────────────────────────────────────────────────────

/** Demanda prevista muy por encima de la media en las próximas horas. */
async function ruleDemandSurge(): Promise<number> {
  const slots = await forecastDemand({ hours: 6 });
  const byZone = new Map<string, typeof slots>();
  for (const s of slots) {
    const list = byZone.get(s.zoneId) ?? byZone.set(s.zoneId, []).get(s.zoneId)!;
    list.push(s);
  }
  let n = 0;
  for (const [zoneId, list] of byZone) {
    const relevant = list.filter((s) => s.vsAveragePct != null && s.vsAveragePct >= 25 && s.predicted >= 1 && s.confidenceScore >= 0.4);
    if (relevant.length < 2) continue;

    const first = relevant[0];
    const last = relevant[relevant.length - 1];
    const peak = relevant.reduce((a, b) => (b.predicted > a.predicted ? b : a));
    const totalPredicted = Math.round(relevant.reduce((s, x) => s + x.predicted, 0) * 10) / 10;
    const avgOver = Math.round(relevant.reduce((s, x) => s + (x.vsAveragePct ?? 0), 0) / relevant.length);
    const hourLabel = (ms: number) => new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

    const created = await upsert({
      type: "demand_surge",
      dedupKey: `demand_surge|${zoneId}|${new Date(first.targetAtMs).toISOString().slice(0, 13)}`,
      title: `Demanda prevista un ${avgOver} % superior a la media en ${first.zoneLabel}`,
      description:
        `Entre las ${hourLabel(first.targetAtMs)} y las ${hourLabel(last.targetAtMs + 3600_000)} se esperan ` +
        `${totalPredicted} asistencias en ${first.zoneLabel}, con pico a las ${hourLabel(peak.targetAtMs)} ` +
        `(${peak.predicted}, intervalo ${peak.confidenceMin}–${peak.confidenceMax}).`,
      priority: avgOver >= 60 ? "high" : "medium",
      affectedEntityType: "zone",
      affectedEntityId: zoneId,
      expectedImpact: `Cubrir el pico evitaría retrasos en ~${Math.ceil(totalPredicted)} servicios`,
      impactValue: peak.recommendedUnits,
      impactUnit: "unidades",
      proposedAction: {
        type: "increase_coverage",
        label: `Reforzar con ${peak.recommendedUnits} unidad(es) en ${first.zoneLabel}`,
        link: "/connect/inteligencia/demanda",
        params: { zoneId, units: peak.recommendedUnits, fromMs: first.targetAtMs, toMs: last.targetAtMs },
      },
      explanation: {
        detected: `Previsión por encima de la media histórica de la zona en ${relevant.length} franjas consecutivas`,
        dataUsed: ["connect_assistances (90 días)", "Zonas derivadas de connect_workshops", "Modelo demand-seasonal-naive v1"],
        factors: relevant.slice(0, 4).map((s) => ({
          name: `${hourLabel(s.targetAtMs)}`,
          detail: `${s.predicted} previstas (${s.vsAveragePct} % vs media), ${s.sampleSize} observaciones históricas`,
        })),
        confidence: Math.round((relevant.reduce((s, x) => s + x.confidenceScore, 0) / relevant.length) * 100) / 100,
        alternatives: ["Mantener la cobertura actual y priorizar por SLA", "Ampliar el radio de los talleres vecinos"],
      },
      expiresInMin: 180,
    });
    if (created) n++;
  }
  return n;
}

/** Zonas donde la demanda prevista supera a los recursos disponibles. */
async function ruleCoverageGap(): Promise<number> {
  const [slots, saturation] = await Promise.all([forecastDemand({ hours: 3 }), zoneSaturation()]);
  const byZone = new Map<string, number>();
  for (const s of slots) byZone.set(s.zoneId, (byZone.get(s.zoneId) ?? 0) + s.predicted);

  let n = 0;
  for (const [zoneId, predicted] of byZone) {
    const load = saturation[zoneId];
    if (!load) continue;
    const capacity = load.availableUnits * 1.5 * 3; // 1,5 servicios/hora por unidad, 3 horas
    if (predicted < 1 || predicted <= capacity) continue;

    const deficit = Math.ceil((predicted - capacity) / (1.5 * 3));
    const created = await upsert({
      type: "coverage_gap",
      dedupKey: `coverage_gap|${zoneId}|${new Date().toISOString().slice(0, 13)}`,
      title: `Cobertura insuficiente en ${load.label} para las próximas 3 horas`,
      description:
        `Se prevén ${Math.round(predicted * 10) / 10} asistencias y la capacidad disponible es de ` +
        `${Math.round(capacity * 10) / 10} (${load.availableUnits} unidades disponibles, ${load.active} servicios ya activos).`,
      priority: deficit >= 2 ? "critical" : "high",
      affectedEntityType: "zone",
      affectedEntityId: zoneId,
      expectedImpact: `Faltan ${deficit} unidad(es) para absorber la demanda prevista`,
      impactValue: deficit,
      impactUnit: "unidades",
      proposedAction: {
        type: "request_coverage",
        label: `Activar ${deficit} unidad(es) adicional(es) o abrir la zona a talleres vecinos`,
        link: "/connect/unidades",
        params: { zoneId, deficit },
      },
      explanation: {
        detected: "Demanda prevista superior a la capacidad disponible en la zona",
        dataUsed: ["Modelo demand-seasonal-naive v1", "connect_mobile_units (estado actual)", "connect_assistances activas"],
        factors: [
          { name: "Demanda prevista (3 h)", detail: `${Math.round(predicted * 10) / 10} asistencias` },
          { name: "Unidades disponibles", detail: `${load.availableUnits}` },
          { name: "Carga actual", detail: `${load.active} servicios activos (ratio ${load.ratio})` },
        ],
        confidence: 0.6,
        alternatives: ["Extender el radio de cobertura de talleres colindantes", "Priorizar urgentes y reprogramar el resto"],
      },
      expiresInMin: 120,
    });
    if (created) n++;
  }
  return n;
}

/** Concentración de servicios activos con riesgo alto o crítico. */
async function ruleDelayRiskBatch(): Promise<number> {
  const risks = await computeDelayRisks();
  const critical = risks.filter((r) => r.level === "high" || r.level === "critical");
  if (critical.length < 3) return 0;

  const created = await upsert({
    type: "sla_risk_batch",
    dedupKey: `sla_risk_batch|${new Date().toISOString().slice(0, 13)}`,
    title: `${critical.length} servicios activos con riesgo alto de incumplir el SLA`,
    description:
      `Servicios afectados: ${critical.slice(0, 8).map((r) => `#${r.assistanceId} (${Math.round(r.score * 100)} %)`).join(", ")}` +
      `${critical.length > 8 ? "…" : ""}. Revisar prioridades y reasignaciones antes de que venzan los plazos.`,
    priority: critical.some((r) => r.level === "critical") ? "critical" : "high",
    affectedEntityType: "assistance_set",
    affectedEntityId: critical.map((r) => r.assistanceId).join(","),
    expectedImpact: `Actuar ahora puede evitar ${critical.length} incumplimientos de SLA`,
    impactValue: critical.length,
    impactUnit: "servicios",
    proposedAction: {
      type: "review_services",
      label: "Revisar los servicios en riesgo en tiempo real",
      link: "/connect/inteligencia/tiempo-real",
      params: { assistanceIds: critical.map((r) => r.assistanceId) },
    },
    explanation: {
      detected: "Varios servicios activos superan el umbral de riesgo del modelo",
      dataUsed: ["Modelo delay-risk-rules v1", "connect_status_history", "connect_mobile_units (GPS)", "SLA de la asistencia"],
      factors: critical.slice(0, 5).map((r) => ({ name: `Servicio #${r.assistanceId}`, detail: r.explanation })),
      confidence: 0.7,
    },
    expiresInMin: 60,
  });
  return created ? 1 : 0;
}

/**
 * Reasignación: para cada servicio en riesgo alto todavía no desplazado, busca
 * un candidato con ETA sensiblemente mejor que el asignado.
 */
async function ruleReassignment(): Promise<number> {
  const risks = await computeDelayRisks();
  const candidates = risks.filter((r) => r.score >= 0.6).slice(0, 10);
  let n = 0;

  for (const risk of candidates) {
    const a = (await db.query(
      `SELECT ca.id, ca.latitude, ca.longitude, ca."serviceType", ca.status, ca."workshopId",
              w.name AS workshop_name
         FROM connect_assistances ca
         LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
        WHERE ca.id = $1`,
      [risk.assistanceId],
    )).rows[0];
    // Solo tiene sentido reasignar antes de que la unidad esté en el punto
    if (!a || a.latitude == null || !["pending", "searching", "awaiting_acceptance", "assigned", "technician_assigned"].includes(a.status)) continue;

    const currentEta = a.workshopId ? (await predictEta(a.id))?.etaMinutes ?? null : null;
    const alternatives = await findCandidates(Number(a.latitude), Number(a.longitude), String(a.serviceType));
    const better = alternatives.find((c) => c.workshopId !== a.workshopId && (currentEta == null || c.etaMinutes <= currentEta - 10));
    if (!better) continue;

    const saved = currentEta != null ? currentEta - better.etaMinutes : null;
    const created = await upsert({
      type: "reassignment",
      dedupKey: `reassignment|${a.id}|${better.workshopId}`,
      title: saved != null
        ? `Reasignar el servicio #${a.id} a ${better.name} reduciría el ETA en ${saved} min`
        : `Asignar el servicio #${a.id} a ${better.name} (ETA ${better.etaMinutes} min)`,
      description:
        `El servicio #${a.id} tiene riesgo ${risk.level} (${Math.round(risk.score * 100)} %). ` +
        `${better.name} está a ${better.distanceKm} km con un ETA estimado de ${better.etaMinutes} min` +
        `${a.workshop_name ? `, frente a ${currentEta ?? "?"} min del proveedor actual (${a.workshop_name})` : ""}.`,
      priority: risk.level === "critical" ? "critical" : "high",
      affectedEntityType: "assistance",
      affectedEntityId: String(a.id),
      expectedImpact: saved != null ? `−${saved} min de ETA` : `ETA de ${better.etaMinutes} min`,
      impactValue: saved ?? better.etaMinutes,
      impactUnit: "min",
      proposedAction: {
        type: "reassign",
        label: `Reasignar a ${better.name}`,
        link: `/connect/asistencias/${a.id}`,
        params: { assistanceId: a.id, workshopId: better.workshopId, etaMinutes: better.etaMinutes },
      },
      explanation: {
        detected: `Existe un recurso más cercano y con mejor cumplimiento para un servicio en riesgo`,
        dataUsed: ["Modelo delay-risk-rules v1", "findCandidates (score de red, carga y probabilidad de aceptación)", "Modelo eta-historical-blend v1"],
        factors: [
          { name: "Riesgo actual", detail: risk.explanation },
          { name: "Distancia", detail: `${better.distanceKm} km hasta el punto` },
          { name: "Score del taller propuesto", detail: `${Math.round(better.score)} / 100` },
          { name: "Probabilidad de aceptación", detail: `${Math.round((better.acceptProbability ?? 0) * 100)} %` },
          { name: "Carga actual del taller", detail: `${better.activeLoad ?? 0} servicios activos` },
        ],
        confidence: 0.65,
        alternatives: alternatives.slice(0, 3)
          .filter((c) => c.workshopId !== better.workshopId)
          .map((c) => `${c.name}: ETA ${c.etaMinutes} min, score ${Math.round(c.score)}`),
      },
      expiresInMin: 45,
    });
    if (created) n++;
  }
  return n;
}

/** Degradación del tiempo medio de llegada de un proveedor. */
async function ruleProviderDegradation(): Promise<number> {
  const now = Date.now();
  const r = await db.query(
    `SELECT w.id, w.name,
            AVG(t.min) FILTER (WHERE ca."createdAtMs" >= $1) AS recent_min,
            COUNT(*) FILTER (WHERE ca."createdAtMs" >= $1)::int AS recent_n,
            AVG(t.min) FILTER (WHERE ca."createdAtMs" >= $2 AND ca."createdAtMs" < $1) AS prev_min,
            COUNT(*) FILTER (WHERE ca."createdAtMs" >= $2 AND ca."createdAtMs" < $1)::int AS prev_n
       FROM connect_workshops w
       JOIN connect_assistances ca ON ca."workshopId" = w.id
       JOIN LATERAL (
         SELECT (arr."occurredAtMs" - asg."occurredAtMs")/60000.0 AS min
           FROM connect_status_history asg
           JOIN connect_status_history arr ON arr."assistanceId" = asg."assistanceId" AND arr."toStatus" = 'arrived'
          WHERE asg."assistanceId" = ca.id AND asg."toStatus" = 'assigned' LIMIT 1) t ON true
      WHERE ca."createdAtMs" >= $2
      GROUP BY w.id, w.name`,
    [now - 14 * DAY_MS, now - 28 * DAY_MS],
  );

  let n = 0;
  for (const w of r.rows) {
    if (w.recent_n < 5 || w.prev_n < 5 || w.prev_min == null || w.recent_min == null) continue;
    const recent = Number(w.recent_min);
    const prev = Number(w.prev_min);
    const growth = ((recent - prev) / prev) * 100;
    if (growth < 15) continue;

    const created = await upsert({
      type: "provider_degradation",
      dedupKey: `provider_degradation|${w.id}|${new Date().toISOString().slice(0, 10)}`,
      title: `${w.name} presenta un incremento del ${Math.round(growth)} % en el tiempo medio de llegada`,
      description:
        `Media de los últimos 14 días: ${Math.round(recent)} min (${w.recent_n} servicios), ` +
        `frente a ${Math.round(prev)} min en los 14 anteriores (${w.prev_n} servicios).`,
      priority: growth >= 35 ? "high" : "medium",
      affectedEntityType: "workshop",
      affectedEntityId: String(w.id),
      expectedImpact: `Recuperar el nivel anterior ahorraría ${Math.round(recent - prev)} min por servicio`,
      impactValue: Math.round(recent - prev),
      impactUnit: "min",
      proposedAction: {
        type: "review_provider",
        label: `Revisar el rendimiento de ${w.name} con el proveedor`,
        link: "/connect/inteligencia/proveedores",
        params: { workshopId: w.id },
      },
      explanation: {
        detected: "Empeoramiento sostenido del tiempo asignación → llegada",
        dataUsed: ["connect_status_history (28 días)", "connect_assistances", "connect_workshops"],
        factors: [
          { name: "Últimos 14 días", detail: `${Math.round(recent)} min de media (${w.recent_n} servicios)` },
          { name: "14 días anteriores", detail: `${Math.round(prev)} min de media (${w.prev_n} servicios)` },
        ],
        confidence: Math.min(1, Math.round((Math.min(w.recent_n, w.prev_n) / 20) * 100) / 100),
        alternatives: ["Reducir temporalmente el peso del taller en la asignación automática", "Abrir incidencia de seguimiento"],
      },
      expiresInMin: 24 * 60,
    });
    if (created) n++;
  }
  return n;
}

/** Variación relevante del volumen por tipo de servicio (mes vs mes anterior). */
async function ruleServiceTypeTrend(): Promise<number> {
  const now = Date.now();
  const r = await db.query(
    `SELECT "serviceType",
            COUNT(*) FILTER (WHERE "createdAtMs" >= $1)::int AS recent,
            COUNT(*) FILTER (WHERE "createdAtMs" >= $2 AND "createdAtMs" < $1)::int AS prev
       FROM connect_assistances
      WHERE "createdAtMs" >= $2 AND status <> 'draft'
      GROUP BY 1`,
    [now - 30 * DAY_MS, now - 60 * DAY_MS],
  );

  let n = 0;
  for (const t of r.rows) {
    if (t.prev < 10) continue;
    const growth = ((t.recent - t.prev) / t.prev) * 100;
    if (Math.abs(growth) < 15) continue;

    const up = growth > 0;
    const created = await upsert({
      type: "service_type_trend",
      dedupKey: `service_type_trend|${t.serviceType}|${new Date().toISOString().slice(0, 7)}`,
      title: `Los servicios de tipo "${t.serviceType}" han ${up ? "aumentado" : "disminuido"} un ${Math.abs(Math.round(growth))} % respecto al mes anterior`,
      description: `${t.recent} servicios en los últimos 30 días frente a ${t.prev} en los 30 anteriores.`,
      priority: Math.abs(growth) >= 35 ? "medium" : "low",
      affectedEntityType: "service_type",
      affectedEntityId: String(t.serviceType),
      expectedImpact: up
        ? "Ajustar equipamiento y tarifas al mayor volumen"
        : "Revisar si la caída responde a un cambio de mix o a pérdida de actividad",
      impactValue: Math.round(growth),
      impactUnit: "%",
      proposedAction: {
        type: "review_service_type",
        label: "Analizar la evolución del tipo de servicio",
        link: "/connect/inteligencia/demanda",
        params: { serviceType: t.serviceType },
      },
      explanation: {
        detected: "Variación significativa del volumen mensual por tipo de servicio",
        dataUsed: ["connect_assistances (60 días)"],
        factors: [
          { name: "Últimos 30 días", detail: `${t.recent} servicios` },
          { name: "30 días anteriores", detail: `${t.prev} servicios` },
        ],
        confidence: Math.min(1, Math.round((t.prev / 40) * 100) / 100),
      },
      expiresInMin: 7 * 24 * 60,
    });
    if (created) n++;
  }
  return n;
}

/** Acumulación de asistencias sin asignar durante demasiado tiempo. */
async function ruleUnassignedBacklog(): Promise<number> {
  const r = await db.query(
    `SELECT id, "createdAtMs" FROM connect_assistances
      WHERE status IN ('pending','searching') AND "createdAtMs" < $1
      ORDER BY "createdAtMs"`,
    [Date.now() - 20 * 60_000],
  );
  if (r.rows.length < 2) return 0;

  const oldest = Math.round((Date.now() - Number(r.rows[0].createdAtMs)) / 60000);
  const created = await upsert({
    type: "unassigned_backlog",
    dedupKey: `unassigned_backlog|${new Date().toISOString().slice(0, 13)}`,
    title: `${r.rows.length} asistencias llevan más de 20 minutos sin proveedor asignado`,
    description: `La más antigua acumula ${oldest} min desde su recepción. Cada minuto sin asignar se traslada íntegro al tiempo de llegada.`,
    priority: r.rows.length >= 5 || oldest > 45 ? "high" : "medium",
    affectedEntityType: "assistance_set",
    affectedEntityId: r.rows.map((x) => x.id).join(","),
    expectedImpact: `Asignarlas ahora recorta hasta ${oldest} min del tiempo total de servicio`,
    impactValue: r.rows.length,
    impactUnit: "servicios",
    proposedAction: {
      type: "assign_pending",
      label: "Abrir el centro de control y asignar",
      link: "/connect/centro",
      params: { assistanceIds: r.rows.map((x) => x.id) },
    },
    explanation: {
      detected: "Cola de asistencias pendientes por encima del umbral operativo",
      dataUsed: ["connect_assistances (estado actual)"],
      factors: [
        { name: "Pendientes", detail: `${r.rows.length} asistencias` },
        { name: "Espera máxima", detail: `${oldest} min` },
      ],
      confidence: 1,
    },
    expiresInMin: 60,
  });
  return created ? 1 : 0;
}

/** Servicios finalizados hace días y todavía sin facturar. */
async function ruleUnbilledServices(): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(COALESCE("finalCost","estimatedCost")), 0) AS amount
       FROM connect_assistances
      WHERE status = 'finished' AND "invoicedAtMs" IS NULL AND "updatedAtMs" < $1`,
    [Date.now() - 7 * DAY_MS],
  );
  const n = r.rows[0].n as number;
  if (n < 5) return 0;
  const amount = Math.round(Number(r.rows[0].amount));

  const created = await upsert({
    type: "unbilled_services",
    dedupKey: `unbilled_services|${new Date().toISOString().slice(0, 10)}`,
    title: `${n} servicios finalizados hace más de 7 días siguen sin facturar`,
    description: `Importe pendiente estimado: ${amount} €. Revisar el cierre contable de esas líneas.`,
    priority: amount > 5000 ? "high" : "medium",
    affectedEntityType: "billing",
    expectedImpact: `${amount} € pendientes de facturar`,
    impactValue: amount,
    impactUnit: "€",
    proposedAction: {
      type: "review_billing",
      label: "Revisar la facturación pendiente",
      link: "/connect/facturacion",
    },
    explanation: {
      detected: "Servicios cerrados sin marca de facturación pasada una semana",
      dataUsed: ["connect_assistances (invoicedAtMs)"],
      factors: [
        { name: "Servicios", detail: `${n} finalizados sin facturar` },
        { name: "Importe", detail: `${amount} €` },
      ],
      confidence: 1,
    },
    expiresInMin: 3 * 24 * 60,
  });
  return created ? 1 : 0;
}

// ── Decisión humana sobre la recomendación ──────────────────────────────────

export async function decideRecommendation(opts: {
  id: number;
  accept: boolean;
  userId?: number | null;
  userName?: string | null;
  reason?: string | null;
}): Promise<{ ok: boolean; recommendation?: any }> {
  const now = Date.now();
  const r = await db.query(
    opts.accept
      ? `UPDATE ai_recommendation
            SET status = 'accepted', "acceptedBy" = $2, "acceptedAtMs" = $3
          WHERE id = $1 AND status = 'pending' RETURNING *`
      : `UPDATE ai_recommendation
            SET status = 'rejected', "rejectedBy" = $2, "rejectedAtMs" = $3, "rejectionReason" = $4
          WHERE id = $1 AND status = 'pending' RETURNING *`,
    opts.accept
      ? [opts.id, opts.userName ?? null, now]
      : [opts.id, opts.userName ?? null, now, opts.reason ?? null],
  );
  if (!r.rows[0]) return { ok: false };

  await db.query(
    `INSERT INTO ai_feedback ("recommendationId","userId","userName","feedbackType",accepted,comment,"createdAtMs")
     VALUES ($1,$2,$3,'decision',$4,$5,$6)`,
    [opts.id, opts.userId ?? null, opts.userName ?? null, opts.accept, opts.reason ?? null, now],
  );
  return { ok: true, recommendation: r.rows[0] };
}

/**
 * Tasa de aceptación e impacto acumulado: son los indicadores que deciden
 * cuándo una familia de recomendaciones está lista para automatizarse.
 */
export async function recommendationStats(days = 30): Promise<Array<Record<string, unknown>>> {
  const r = await db.query(
    `SELECT "recommendationType",
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted,
            COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
            COUNT(*) FILTER (WHERE status = 'expired')::int AS expired,
            COALESCE(SUM("impactValue") FILTER (WHERE status = 'accepted'), 0) AS impact,
            MAX("impactUnit") AS unit
       FROM ai_recommendation WHERE "createdAtMs" >= $1
      GROUP BY 1 ORDER BY 2 DESC`,
    [Date.now() - days * DAY_MS],
  );
  return r.rows.map((x) => ({
    type: x.recommendationType,
    total: x.total,
    accepted: x.accepted,
    rejected: x.rejected,
    expired: x.expired,
    acceptanceRate: x.accepted + x.rejected > 0 ? Math.round((x.accepted / (x.accepted + x.rejected)) * 100) : null,
    estimatedImpact: Math.round(Number(x.impact) * 10) / 10,
    impactUnit: x.unit,
  }));
}

/** Zonas con su carga actual, para el panel de cobertura. */
export async function coverageOverview(): Promise<Array<Record<string, unknown>>> {
  const [saturation, slots, zones] = await Promise.all([zoneSaturation(), forecastDemand({ hours: 3 }), loadZones()]);
  const predicted = new Map<string, number>();
  for (const s of slots) predicted.set(s.zoneId, (predicted.get(s.zoneId) ?? 0) + s.predicted);
  return zones.map((z) => {
    const load = saturation[z.id];
    const demand3h = Math.round((predicted.get(z.id) ?? 0) * 10) / 10;
    const capacity3h = Math.round((load?.availableUnits ?? 0) * 1.5 * 3 * 10) / 10;
    return {
      zoneId: z.id,
      label: z.label,
      workshopId: z.workshopId,
      latitude: z.latitude,
      longitude: z.longitude,
      active: load?.active ?? 0,
      availableUnits: load?.availableUnits ?? 0,
      ratio: load?.ratio ?? 0,
      demand3h,
      capacity3h,
      status: demand3h > capacity3h ? "deficit" : demand3h > capacity3h * 0.7 ? "tight" : "ok",
    };
  });
}

export { zoneFor };
