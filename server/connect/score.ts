/**
 * Connect Pro — Score Inteligente del taller (0–100), versión 1.
 *
 * Ventana móvil de 90 días. Componentes:
 *   35 % fiabilidad  → tasa de aceptación de ofertas + tasa de finalización
 *   25 % velocidad   → tiempo medio de aceptación + tiempo hasta llegada
 *   25 % calidad     → incidencias por cada 100 asistencias (inverso)
 *   15 % compromiso  → volumen/antigüedad de colaboración (log-normalizado)
 *
 * Suavizado bayesiano hacia la media de la red cuando la muestra es pequeña
 * (k = 30): score = w·score_propio + (1−w)·media_red, con w = n/(n+k).
 * La confianza (0..1) se publica junto al score; nunca se bloquea a un taller
 * automáticamente (cap. 8 del diseño: la exclusión es siempre humana).
 */

import db from "../db.ts";
import { createAlert } from "./alerts.ts";

const WINDOW_MS = 90 * 24 * 3600_000;
const BAYES_K = 30;

export interface ScoreComponents {
  acceptanceRate: number | null;   // 0..1
  completionRate: number | null;   // 0..1
  avgAcceptMin: number | null;
  avgArrivalMin: number | null;
  incidentsPer100: number | null;
  volume90d: number;
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

function rawScore(c: ScoreComponents): number {
  // Cada factor se normaliza a 0..1; los ausentes usan un neutro 0,7
  const acceptance = c.acceptanceRate ?? 0.7;
  const completion = c.completionRate ?? 0.7;
  const speedAccept = c.avgAcceptMin == null ? 0.7 : clamp01(1 - c.avgAcceptMin / 30);       // 0 min→1, 30 min→0
  const speedArrival = c.avgArrivalMin == null ? 0.7 : clamp01(1 - (c.avgArrivalMin - 20) / 100); // ≤20 min→1, 120 min→0
  const quality = c.incidentsPer100 == null ? 0.7 : clamp01(1 - c.incidentsPer100 / 20);     // 20 incid./100→0
  const commitment = clamp01(Math.log10(1 + c.volume90d) / 2);                               // 100 asistencias→1

  return 100 * (
    0.20 * acceptance + 0.15 * completion +   // fiabilidad 35 %
    0.10 * speedAccept + 0.15 * speedArrival + // velocidad 25 %
    0.25 * quality +                           // calidad 25 %
    0.15 * commitment                          // compromiso 15 %
  );
}

export function tierFor(score: number): string {
  if (score >= 90) return "excelente";
  if (score >= 80) return "muy_recomendable";
  if (score >= 70) return "correcto";
  if (score >= 60) return "observacion";
  if (score >= 40) return "bajo_rendimiento";
  return "no_recomendable";
}

async function componentsFor(workshopId: number, since: number): Promise<ScoreComponents> {
  const [offers, completion, times, incidents] = await Promise.all([
    db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted,
              COUNT(*) FILTER (WHERE status IN ('rejected','expired'))::int AS declined,
              AVG(("respondedAtMs" - "sentAtMs") / 60000.0)
                FILTER (WHERE status = 'accepted' AND mode = 'offer') AS avg_accept_min
         FROM connect_assignments
        WHERE "workshopId" = $1 AND "sentAtMs" >= $2`,
      [workshopId, since],
    ),
    db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'finished')::int AS finished,
              COUNT(*) FILTER (WHERE status = 'cancelled' AND "coreAssistanceId" IS NOT NULL)::int AS cancelled_after
         FROM connect_assistances
        WHERE "workshopId" = $1 AND "createdAtMs" >= $2`,
      [workshopId, since],
    ),
    db.query(
      // Tiempo asignada → llegada (en el punto) desde el historial de estados
      `SELECT AVG((arr."occurredAtMs" - asg."occurredAtMs") / 60000.0) AS avg_arrival_min
         FROM connect_assistances ca
         JOIN connect_status_history asg ON asg."assistanceId" = ca.id AND asg."toStatus" = 'assigned'
         JOIN connect_status_history arr ON arr."assistanceId" = ca.id AND arr."toStatus" = 'arrived'
        WHERE ca."workshopId" = $1 AND ca."createdAtMs" >= $2`,
      [workshopId, since],
    ),
    db.query(
      `SELECT COUNT(*)::int AS n FROM connect_incidents
        WHERE "workshopId" = $1 AND "scoreImpact" = true AND "createdAtMs" >= $2`,
      [workshopId, since],
    ),
  ]);

  const o = offers.rows[0];
  const co = completion.rows[0];
  const offered = o.accepted + o.declined;
  const totalDone = co.finished + co.cancelled_after;
  const volume = co.finished;

  return {
    acceptanceRate: offered > 0 ? o.accepted / offered : null,
    completionRate: totalDone > 0 ? co.finished / totalDone : null,
    avgAcceptMin: o.avg_accept_min != null ? Number(o.avg_accept_min) : null,
    avgArrivalMin: times.rows[0].avg_arrival_min != null ? Number(times.rows[0].avg_arrival_min) : null,
    incidentsPer100: volume > 0 ? (incidents.rows[0].n / volume) * 100 : (incidents.rows[0].n > 0 ? incidents.rows[0].n * 100 : null),
    volume90d: volume,
  };
}

/** Recalcula el score de todos los talleres activos y persiste el histórico. */
export async function computeWorkshopScores(): Promise<number> {
  const since = Date.now() - WINDOW_MS;
  const ws = await db.query(`SELECT id FROM connect_workshops WHERE "connectStatus" <> 'excluded'`);
  if (ws.rows.length === 0) return 0;

  const results: Array<{ id: number; raw: number; n: number; comp: ScoreComponents }> = [];
  for (const w of ws.rows) {
    const comp = await componentsFor(w.id, since);
    results.push({ id: w.id, raw: rawScore(comp), n: comp.volume90d, comp });
  }

  // Media de la red para el suavizado (ponderada por muestra, con suelo neutral 70)
  const totalN = results.reduce((s, r) => s + r.n, 0);
  const networkMean = totalN > 0
    ? results.reduce((s, r) => s + r.raw * r.n, 0) / totalN
    : 70;

  const now = Date.now();
  for (const r of results) {
    const w = r.n / (r.n + BAYES_K);
    const score = Math.round((w * r.raw + (1 - w) * networkMean) * 10) / 10;
    const tier = tierFor(score);
    await db.query(`UPDATE connect_workshops SET "currentScore" = $1, "updatedAtMs" = $2 WHERE id = $3`, [score, now, r.id]);
    await db.query(
      `INSERT INTO connect_workshop_scores ("workshopId", "computedAtMs", score, tier, components, confidence, "sampleSize")
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [r.id, now, score, tier, JSON.stringify({ ...r.comp, raw: Math.round(r.raw * 10) / 10, networkMean: Math.round(networkMean * 10) / 10 }), Math.round(w * 100) / 100, r.n],
    );
  }
  return results.length;
}

/**
 * Fase 4 — detección de anomalías por taller (reglas estadísticas):
 *   - exceso de rechazos: >25 % en 14 días con muestra mínima
 *   - caída brusca de score: −15 puntos frente a hace 14 días
 *   - inactividad: ofertas recibidas sin ninguna aceptación en 21 días
 * Cada alerta se deduplica: no se repite si ya hay una igual en 24 h.
 */
export async function detectAnomalies(): Promise<number> {
  const now = Date.now();
  const d14 = now - 14 * 24 * 3600_000;
  const d21 = now - 21 * 24 * 3600_000;
  const d1 = now - 24 * 3600_000;
  let created = 0;

  const ws = await db.query(`SELECT id, name, "currentScore" FROM connect_workshops WHERE "connectStatus" = 'active'`);
  for (const w of ws.rows) {
    const dup = async (type: string) => {
      const r = await db.query(
        `SELECT 1 FROM connect_alerts WHERE type = $1 AND "workshopId" = $2 AND "createdAtMs" > $3 LIMIT 1`,
        [type, w.id, d1],
      );
      return r.rows.length > 0;
    };

    const offers = await db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted,
              COUNT(*) FILTER (WHERE status IN ('rejected','expired'))::int AS declined,
              MAX("sentAtMs") FILTER (WHERE status = 'accepted') AS last_accept,
              COUNT(*) FILTER (WHERE "sentAtMs" >= $2)::int AS recent_offers
         FROM connect_assignments WHERE "workshopId" = $1 AND "sentAtMs" >= $3`,
      [w.id, d21, d14],
    );
    const o = offers.rows[0];
    const total14 = o.accepted + o.declined;

    if (total14 >= 4 && o.declined / total14 > 0.25 && !(await dup("provider_rejections"))) {
      await createAlert({
        type: "provider_rejections", severity: "warning",
        title: `${w.name}: ${Math.round((o.declined / total14) * 100)} % de rechazos/expiraciones en 14 días`,
        body: `${o.declined} de ${total14} ofertas no aceptadas`,
        workshopId: w.id,
      });
      created++;
    }

    const prev = await db.query(
      `SELECT score FROM connect_workshop_scores
        WHERE "workshopId" = $1 AND "computedAtMs" <= $2 ORDER BY id DESC LIMIT 1`,
      [w.id, d14],
    );
    if (prev.rows[0] && Number(prev.rows[0].score) - Number(w.currentScore) >= 15 && !(await dup("score_drop"))) {
      await createAlert({
        type: "score_drop", severity: "warning",
        title: `${w.name}: caída de score de ${Math.round(prev.rows[0].score)} a ${Math.round(w.currentScore)} en 14 días`,
        workshopId: w.id,
      });
      created++;
    }

    if (o.recent_offers > 0 && !o.last_accept && !(await dup("provider_inactive"))) {
      const anyAccept21 = await db.query(
        `SELECT 1 FROM connect_assignments WHERE "workshopId" = $1 AND status = 'accepted' AND "sentAtMs" >= $2 LIMIT 1`,
        [w.id, d21],
      );
      if (anyAccept21.rows.length === 0) {
        await createAlert({
          type: "provider_inactive", severity: "warning",
          title: `${w.name}: sin aceptaciones en 21 días pese a recibir ofertas`,
          workshopId: w.id,
        });
        created++;
      }
    }
  }
  return created;
}

/** Avisos de SLA: emite webhooks sla_risk (<15 min) y sla_breached una sola vez. */
export async function notifySlaEvents(
  enqueue: (partnerId: number, type: string, data: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const now = Date.now();
  const riskAt = now + 15 * 60_000;
  const rows = await db.query(
    `SELECT id, uuid, "partnerId", "externalReference", "slaDeadlineAtMs",
            "slaRiskNotifiedAtMs", "slaBreachNotifiedAtMs"
       FROM connect_assistances
      WHERE "slaDeadlineAtMs" IS NOT NULL
        AND status NOT IN ('finished','cancelled','draft','arrived','in_progress')
        AND ("slaBreachNotifiedAtMs" IS NULL OR "slaRiskNotifiedAtMs" IS NULL)
        AND "slaDeadlineAtMs" < $1`,
    [riskAt],
  );
  for (const a of rows.rows) {
    const breached = Number(a.slaDeadlineAtMs) < now;
    const data = {
      assistance_id: a.uuid,
      external_reference: a.externalReference,
      sla_deadline: new Date(Number(a.slaDeadlineAtMs)).toISOString(),
    };
    if (breached && !a.slaBreachNotifiedAtMs) {
      if (a.partnerId) await enqueue(a.partnerId, "assistance.sla_breached", data);
      await createAlert({
        type: "sla_breached", severity: "critical",
        title: `SLA incumplido en la asistencia #${a.id}`,
        body: a.externalReference ? `Ref. externa ${a.externalReference}` : undefined,
        assistanceId: a.id,
      });
      await db.query(`UPDATE connect_assistances SET "slaBreachNotifiedAtMs" = $1 WHERE id = $2`, [now, a.id]);
    } else if (!breached && !a.slaRiskNotifiedAtMs) {
      if (a.partnerId) await enqueue(a.partnerId, "assistance.sla_risk", data);
      await createAlert({
        type: "sla_risk", severity: "warning",
        title: `SLA en riesgo (<15 min) en la asistencia #${a.id}`,
        assistanceId: a.id,
      });
      await db.query(`UPDATE connect_assistances SET "slaRiskNotifiedAtMs" = $1 WHERE id = $2`, [now, a.id]);
    }
  }
}
