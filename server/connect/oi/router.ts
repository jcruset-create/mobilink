/**
 * Centro de Inteligencia Operacional — API REST.
 *
 * Se monta en /api/operational-intelligence y reutiliza la autenticación y los
 * roles de Connect Pro (sesión unificada Supabase + connect_users). Todas las
 * lecturas pasan por el ámbito del usuario (scope.ts) y las acciones quedan
 * auditadas en connect_audit_logs.
 */

import { Router, json, type Response } from "express";
import db from "../../db.ts";
import { requireConnectRole, requireConnectUser, auditConnect } from "../rbac.ts";
import { DASHBOARD_KPIS, KPI_BY_CODE, KPI_CATALOG, type KpiDefinition } from "./catalog.ts";
import { buildKpiCards, dailyTrend, kpiSeries, type KpiFilters } from "./kpi.ts";
import {
  forecastDemand, predictEta, delayRiskFor, computeDelayRisks, modelAccuracy, zoneSaturation,
} from "./predictions.ts";
import {
  generateRecommendations, decideRecommendation, recommendationStats, coverageOverview,
} from "./recommendations.ts";
import {
  acknowledgeAlert, resolveAlert, commentAlert, assignAlert, runAlertRules,
} from "./alerts.ts";
import { askAssistant, ASSISTANT_SUGGESTIONS } from "./assistant.ts";
import { generateReport, reportToCsv, REPORT_CATALOG, nextRunAt } from "./reports.ts";
import { scopeForUser, applyScope } from "./scope.ts";
import { findCandidates } from "../service.ts";

function err(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

const DAY_MS = 86400_000;

/** Filtros de la petición: periodo (por defecto, hoy) más dimensiones. */
function parseFilters(query: Record<string, unknown>): KpiFilters {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const num = (v: unknown) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const str = (v: unknown) => (v != null && v !== "" ? String(v) : null);
  return {
    from: num(query.from) ?? dayStart.getTime(),
    to: num(query.to) ?? Date.now(),
    clientId: num(query.clientId),
    partnerId: num(query.partnerId),
    providerCompanyId: num(query.providerCompanyId),
    workshopId: num(query.workshopId),
    serviceType: str(query.serviceType),
    priority: str(query.priority),
  };
}

/** Umbrales configurados por centro de control, si los hay. */
async function loadOverrides(controlCenterId: number | null): Promise<Record<string, Partial<KpiDefinition>>> {
  const r = await db.query(
    `SELECT code, name, "targetValue", "warningThreshold", "criticalThreshold", active
       FROM operational_kpi_definition
      WHERE "controlCenterId" = $1`,
    [controlCenterId],
  );
  const out: Record<string, Partial<KpiDefinition>> = {};
  for (const row of r.rows) {
    out[row.code] = {
      name: row.name ?? undefined,
      targetValue: row.targetValue != null ? Number(row.targetValue) : undefined,
      warningThreshold: row.warningThreshold != null ? Number(row.warningThreshold) : undefined,
      criticalThreshold: row.criticalThreshold != null ? Number(row.criticalThreshold) : undefined,
    };
  }
  return out;
}

export function createOperationalIntelligenceRouter(): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  // ── 1. Panel principal y KPIs ───────────────────────────────────────────

  router.get("/dashboard", ...requireConnectRole("analyst"), async (req, res) => {
    const scope = scopeForUser(req.connectUser!);
    const filters = applyScope(parseFilters(req.query as any), scope);
    const overrides = await loadOverrides(scope.controlCenterId);
    const [cards, trend, coverage, risks] = await Promise.all([
      buildKpiCards(DASHBOARD_KPIS, filters, overrides),
      dailyTrend(filters, 14),
      coverageOverview(),
      computeDelayRisks(),
    ]);
    res.json({
      generatedAtMs: Date.now(),
      scope: { role: scope.role, providerCompanyId: scope.providerCompanyId, full: scope.full },
      filters,
      kpis: cards,
      trend,
      coverage,
      riskSummary: {
        critical: risks.filter((r) => r.level === "critical").length,
        high: risks.filter((r) => r.level === "high").length,
        medium: risks.filter((r) => r.level === "medium").length,
        low: risks.filter((r) => r.level === "low").length,
      },
    });
  });

  router.get("/kpis", ...requireConnectRole("analyst"), async (req, res) => {
    const scope = scopeForUser(req.connectUser!);
    const filters = applyScope(parseFilters(req.query as any), scope);
    const category = req.query.category ? String(req.query.category) : null;
    const codes = KPI_CATALOG.filter((k) => !category || k.category === category).map((k) => k.code);
    const overrides = await loadOverrides(scope.controlCenterId);
    res.json({ filters, data: await buildKpiCards(codes, filters, overrides) });
  });

  router.get("/kpis/catalog", ...requireConnectRole("analyst"), async (req, res) => {
    const scope = scopeForUser(req.connectUser!);
    const overrides = await loadOverrides(scope.controlCenterId);
    res.json({
      data: KPI_CATALOG.map((k) => ({ ...k, ...(overrides[k.code] ?? {}), configured: !!overrides[k.code] })),
    });
  });

  router.get("/kpis/:code", ...requireConnectRole("analyst"), async (req, res) => {
    const code = String(req.params.code);
    const def = KPI_BY_CODE[code];
    if (!def) return err(res, 404, "not_found", "KPI no encontrado");
    const scope = scopeForUser(req.connectUser!);
    const filters = applyScope(parseFilters(req.query as any), scope);
    const overrides = await loadOverrides(scope.controlCenterId);
    const [card] = await buildKpiCards([code], filters, overrides);
    const granularity = String(req.query.granularity || (def.category === "operational" ? "live" : "day"));
    res.json({ definition: { ...def, ...(overrides[code] ?? {}) }, card, series: await kpiSeries(code, granularity) });
  });

  router.post("/kpis/configuration", ...requireConnectRole("cc_admin"), async (req, res) => {
    const scope = scopeForUser(req.connectUser!);
    const { code, targetValue, warningThreshold, criticalThreshold, active } = req.body ?? {};
    if (!code || !KPI_BY_CODE[String(code)]) return err(res, 422, "validation_failed", "code de KPI no válido");
    const base = KPI_BY_CODE[String(code)];
    const now = Date.now();
    await db.query(
      `INSERT INTO operational_kpi_definition
         (code, name, description, category, formula, unit, direction,
          "targetValue","warningThreshold","criticalThreshold","controlCenterId",active,"createdAtMs","updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
       ON CONFLICT (code, "controlCenterId") WHERE "controlCenterId" IS NOT NULL
       DO UPDATE SET "targetValue" = EXCLUDED."targetValue",
                     "warningThreshold" = EXCLUDED."warningThreshold",
                     "criticalThreshold" = EXCLUDED."criticalThreshold",
                     active = EXCLUDED.active,
                     "updatedAtMs" = EXCLUDED."updatedAtMs"`,
      [
        base.code, base.name, base.description, base.category, base.formula, base.unit, base.direction,
        targetValue != null ? Number(targetValue) : null,
        warningThreshold != null ? Number(warningThreshold) : null,
        criticalThreshold != null ? Number(criticalThreshold) : null,
        scope.controlCenterId, active !== false, now,
      ],
    );
    await auditConnect({ req, action: "oi.kpi.configure", resourceType: "kpi", resourceId: base.code, detail: req.body });
    res.json({ ok: true });
  });

  router.get("/trend", ...requireConnectRole("analyst"), async (req, res) => {
    const scope = scopeForUser(req.connectUser!);
    const filters = applyScope(parseFilters(req.query as any), scope);
    const days = Math.min(Number(req.query.days) || 30, 180);
    res.json({ data: await dailyTrend(filters, days) });
  });

  // ── 2. Operación en tiempo real ─────────────────────────────────────────

  router.get("/live-operation", ...requireConnectRole("operator"), async (req, res) => {
    const scope = scopeForUser(req.connectUser!);
    const params: unknown[] = [];
    let where = `ca.status IN ('pending','searching','awaiting_acceptance','assigned','technician_assigned','en_route','arrived','in_progress')`;
    if (scope.providerCompanyId) { params.push(scope.providerCompanyId); where += ` AND w."providerCompanyId" = $${params.length}`; }
    if (req.query.serviceType) { params.push(String(req.query.serviceType)); where += ` AND ca."serviceType" = $${params.length}`; }
    if (req.query.priority) { params.push(String(req.query.priority)); where += ` AND ca.priority = $${params.length}`; }
    if (req.query.status) { params.push(String(req.query.status)); where += ` AND ca.status = $${params.length}`; }
    if (req.query.workshopId) { params.push(Number(req.query.workshopId)); where += ` AND ca."workshopId" = $${params.length}`; }

    const [services, units, risks] = await Promise.all([
      db.query(
        `SELECT ca.id, ca.status, ca.priority, ca."serviceType", ca."createdAtMs", ca.address,
                ca.latitude, ca.longitude, ca."slaDeadlineAtMs", ca."expedientNumber",
                ca."customerName", w.name AS workshop, pc.name AS provider,
                mu.id AS "unitId", mu.name AS "unitName", mu."lastReportAtMs"
           FROM connect_assistances ca
           LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
           LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
           LEFT JOIN connect_mobile_units mu ON mu."activeAssistanceId" = ca.id
          WHERE ${where} ORDER BY ca."createdAtMs"`,
        params,
      ),
      db.query(
        scope.providerCompanyId
          ? `SELECT id, name, plate, status, latitude, longitude, "lastReportAtMs", "activeAssistanceId", "speedKmh"
               FROM connect_mobile_units WHERE "providerCompanyId" = $1`
          : `SELECT id, name, plate, status, latitude, longitude, "lastReportAtMs", "activeAssistanceId", "speedKmh"
               FROM connect_mobile_units`,
        scope.providerCompanyId ? [scope.providerCompanyId] : [],
      ),
      computeDelayRisks(),
    ]);

    const riskById = new Map(risks.map((r) => [r.assistanceId, r]));
    const now = Date.now();
    res.json({
      generatedAtMs: now,
      services: services.rows.map((s) => {
        const risk = riskById.get(s.id);
        return {
          ...s,
          waitingMin: Math.round((now - Number(s.createdAtMs)) / 60000),
          gpsStale: s.unitId != null && (s.lastReportAtMs == null || Number(s.lastReportAtMs) < now - 15 * 60_000),
          risk: risk ? { score: risk.score, level: risk.level, explanation: risk.explanation, etaMinutes: risk.etaMinutes, minutesToDeadline: risk.minutesToDeadline } : null,
        };
      }),
      units: units.rows,
      zones: Object.values(await zoneSaturation()),
    });
  });

  router.get("/critical-services", ...requireConnectRole("operator"), async (req, res) => {
    const risks = (await computeDelayRisks()).filter((r) => r.level === "high" || r.level === "critical");
    if (!risks.length) return res.json({ data: [] });
    const r = await db.query(
      `SELECT ca.id, ca.status, ca."serviceType", ca.priority, ca.address, ca."slaDeadlineAtMs",
              w.name AS workshop FROM connect_assistances ca
         LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
        WHERE ca.id = ANY($1::int[])`,
      [risks.map((x) => x.assistanceId)],
    );
    const byId = new Map(r.rows.map((x) => [x.id, x]));
    res.json({ data: risks.map((risk) => ({ ...risk, assistance: byId.get(risk.assistanceId) ?? null })) });
  });

  router.get("/resource-availability", ...requireConnectRole("operator"), async (req, res) => {
    const scope = scopeForUser(req.connectUser!);
    const params = scope.providerCompanyId ? [scope.providerCompanyId] : [];
    const where = scope.providerCompanyId ? `WHERE "providerCompanyId" = $1` : "";
    const [byStatus, coverage] = await Promise.all([
      db.query(`SELECT status, COUNT(*)::int AS n FROM connect_mobile_units ${where} GROUP BY status ORDER BY 2 DESC`, params),
      coverageOverview(),
    ]);
    res.json({ byStatus: byStatus.rows, coverage });
  });

  // ── 3. Predicciones ─────────────────────────────────────────────────────

  router.get("/predictions/demand", ...requireConnectRole("analyst"), async (req, res) => {
    const hours = Math.min(Number(req.query.hours) || 12, 72);
    const slots = await forecastDemand({
      hours,
      serviceType: req.query.serviceType ? String(req.query.serviceType) : null,
      zoneId: req.query.zoneId ? String(req.query.zoneId) : null,
      historyDays: Math.min(Number(req.query.historyDays) || 90, 365),
    });
    res.json({ generatedAtMs: Date.now(), horizonHours: hours, data: slots });
  });

  router.get("/predictions/eta/:serviceId", ...requireConnectRole("operator"), async (req, res) => {
    const id = Number(req.params.serviceId);
    if (!Number.isFinite(id)) return err(res, 422, "validation_failed", "serviceId no válido");
    const prediction = await predictEta(id, { persist: req.query.persist === "1" });
    if (!prediction) return err(res, 404, "not_found", "Asistencia no encontrada");
    const stored = await db.query(
      `SELECT "predictedValue", "actualValue", "errorValue", "predictionAtMs"
         FROM ai_prediction WHERE "predictionType" = 'eta' AND "entityId" = $1 ORDER BY id DESC LIMIT 5`,
      [String(id)],
    );
    res.json({ prediction, history: stored.rows });
  });

  router.get("/predictions/delay-risk/:serviceId", ...requireConnectRole("operator"), async (req, res) => {
    const id = Number(req.params.serviceId);
    if (!Number.isFinite(id)) return err(res, 422, "validation_failed", "serviceId no válido");
    const risk = await delayRiskFor(id);
    if (!risk) return err(res, 404, "not_found", "La asistencia no está activa o no existe");
    res.json({ risk });
  });

  router.get("/predictions/accuracy", ...requireConnectRole("analyst"), async (req, res) => {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const models = await db.query(`SELECT * FROM ai_model_registry ORDER BY "modelType"`);
    res.json({ accuracy: await modelAccuracy(days), models: models.rows });
  });

  // ── 4. Recomendaciones ──────────────────────────────────────────────────

  router.get("/recommendations", ...requireConnectRole("analyst"), async (req, res) => {
    const status = req.query.status ? String(req.query.status) : "pending";
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const r = await db.query(
      `SELECT * FROM ai_recommendation
        WHERE ($1 = 'all' OR status = $1)
        ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, id DESC
        LIMIT $2`,
      [status, limit],
    );
    res.json({ data: r.rows.map(publicRecommendation), stats: await recommendationStats(30) });
  });

  router.get("/recommendations/:id", ...requireConnectRole("analyst"), async (req, res) => {
    const r = await db.query(`SELECT * FROM ai_recommendation WHERE id = $1`, [Number(req.params.id)]);
    if (!r.rows[0]) return err(res, 404, "not_found", "Recomendación no encontrada");
    const feedback = await db.query(
      `SELECT * FROM ai_feedback WHERE "recommendationId" = $1 ORDER BY id`, [Number(req.params.id)]);
    res.json({ recommendation: publicRecommendation(r.rows[0]), feedback: feedback.rows });
  });

  router.post("/recommendations/:id/accept", ...requireConnectRole("operator"), async (req, res) => {
    const user = req.connectUser!;
    const out = await decideRecommendation({
      id: Number(req.params.id), accept: true, userId: user.id, userName: user.name || user.email,
      reason: req.body?.comment ?? null,
    });
    if (!out.ok) return err(res, 409, "invalid_state", "La recomendación ya no está pendiente");
    await auditConnect({ req, action: "oi.recommendation.accept", resourceType: "recommendation", resourceId: String(req.params.id) });
    // La aceptación registra la decisión y devuelve dónde ejecutarla: ninguna
    // acción operativa se aplica automáticamente (fase 6 del plan).
    res.json({ ok: true, recommendation: publicRecommendation(out.recommendation) });
  });

  router.post("/recommendations/:id/reject", ...requireConnectRole("operator"), async (req, res) => {
    const user = req.connectUser!;
    const out = await decideRecommendation({
      id: Number(req.params.id), accept: false, userId: user.id, userName: user.name || user.email,
      reason: req.body?.reason ?? null,
    });
    if (!out.ok) return err(res, 409, "invalid_state", "La recomendación ya no está pendiente");
    await auditConnect({ req, action: "oi.recommendation.reject", resourceType: "recommendation", resourceId: String(req.params.id), detail: req.body });
    res.json({ ok: true, recommendation: publicRecommendation(out.recommendation) });
  });

  router.post("/recommendations/refresh", ...requireConnectRole("supervisor"), async (req, res) => {
    const created = await generateRecommendations();
    await auditConnect({ req, action: "oi.recommendation.refresh", detail: { created } });
    res.json({ ok: true, created });
  });

  // ── 5. Optimización de asignaciones ─────────────────────────────────────

  router.post("/assignment/recommend", ...requireConnectRole("operator"), async (req, res) => {
    const { assistanceId, latitude, longitude, serviceType } = req.body ?? {};
    let lat = Number(latitude);
    let lng = Number(longitude);
    let type = String(serviceType || "other");
    let currentWorkshopId: number | null = null;

    if (assistanceId) {
      const a = (await db.query(
        `SELECT latitude, longitude, "serviceType", "workshopId" FROM connect_assistances WHERE id = $1`,
        [Number(assistanceId)],
      )).rows[0];
      if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");
      lat = Number(a.latitude); lng = Number(a.longitude); type = String(a.serviceType);
      currentWorkshopId = a.workshopId ?? null;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return err(res, 422, "validation_failed", "Se requieren latitude y longitude (o una asistencia con posición)");
    }

    const candidates = await findCandidates(lat, lng, type);
    if (!candidates.length) {
      return res.json({ recommended: null, alternatives: [], explanation: "No hay talleres con cobertura para este punto y tipo de servicio." });
    }

    // Coste estimado por tarifa vigente del taller para ese tipo de servicio
    const withCost = await Promise.all(candidates.slice(0, 5).map(async (c) => {
      const t = (await db.query(
        `SELECT tl."baseAmount", tl."perKmAmount" FROM connect_tariff_lines tl
           JOIN connect_provider_authorizations pa ON pa.id = tl."authorizationId"
           JOIN connect_workshops w ON w."providerCompanyId" = pa."providerCompanyId"
          WHERE w.id = $1 AND tl."serviceTypeCode" = $2 AND tl.active LIMIT 1`,
        [c.workshopId, type],
      )).rows[0];
      const estimatedCost = t ? Math.round((Number(t.baseAmount) + Number(t.perKmAmount) * c.distanceKm) * 100) / 100 : null;
      return {
        workshopId: c.workshopId,
        name: c.name,
        providerName: c.providerName ?? null,
        distanceKm: c.distanceKm,
        etaMinutes: c.etaMinutes,
        score: c.score,
        acceptProbability: c.acceptProbability ?? null,
        activeLoad: c.activeLoad ?? 0,
        estimatedCost,
        isCurrent: c.workshopId === currentWorkshopId,
        // Riesgo de incumplimiento aproximado a partir del ETA frente al SLA típico
        riskHint: c.etaMinutes > 60 ? "alto" : c.etaMinutes > 40 ? "medio" : "bajo",
        explanation: c.explanation,
      };
    }));

    const best = withCost[0];
    res.json({
      recommended: best,
      alternatives: withCost.slice(1),
      explanation:
        `Se recomienda ${best.name} porque está a ${best.distanceKm} km (ETA ${best.etaMinutes} min), ` +
        `tiene un score de red de ${Math.round(best.score)}/100, ` +
        `${Math.round((best.acceptProbability ?? 0) * 100)} % de probabilidad de aceptar la oferta ` +
        `y ${best.activeLoad} servicio(s) activo(s) ahora mismo` +
        `${best.estimatedCost != null ? `, con un coste estimado de ${best.estimatedCost} €` : ""}.`,
      decisionMode: "semiautomatic",
      note: "La asignación efectiva se realiza desde la ficha de la asistencia: el motor solo propone.",
    });
  });

  router.post("/resources/optimize", ...requireConnectRole("supervisor"), async (req, res) => {
    const coverage = await coverageOverview();
    const deficits = coverage.filter((z) => z.status === "deficit");
    res.json({
      generatedAtMs: Date.now(),
      coverage,
      proposals: deficits.map((z) => ({
        zoneId: z.zoneId,
        label: z.label,
        action: "refuerzo",
        units: Math.max(1, Math.ceil(((z.demand3h as number) - (z.capacity3h as number)) / 4.5)),
        explanation: `${z.label}: demanda prevista de ${z.demand3h} servicios en 3 h frente a una capacidad de ${z.capacity3h} (${z.availableUnits} unidades disponibles).`,
      })),
    });
  });

  // ── 6. Alertas inteligentes ─────────────────────────────────────────────

  router.get("/alerts", ...requireConnectRole("operator"), async (req, res) => {
    const status = req.query.status ? String(req.query.status) : "open";
    const category = req.query.category ? String(req.query.category) : null;
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const r = await db.query(
      `SELECT a.*, u.name AS "assignedUserName" FROM operational_alert a
         LEFT JOIN connect_users u ON u.id = a."assignedUserId"
        WHERE ($1 = 'all' OR a.status = $1) AND ($2::text IS NULL OR a.category = $2)
        ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                 a.id DESC LIMIT $3`,
      [status, category, limit],
    );
    const counts = await db.query(
      `SELECT category, severity, COUNT(*)::int AS n FROM operational_alert
        WHERE status IN ('open','acknowledged') GROUP BY 1, 2`,
    );
    res.json({
      data: r.rows.map((a) => ({ ...a, comments: safeJson(a.comments) })),
      counts: counts.rows,
    });
  });

  router.post("/alerts/:id/acknowledge", ...requireConnectRole("operator"), async (req, res) => {
    const user = req.connectUser!;
    const ok = await acknowledgeAlert(Number(req.params.id), user.name || user.email, user.id);
    if (!ok) return err(res, 409, "invalid_state", "La alerta no está abierta");
    await auditConnect({ req, action: "oi.alert.acknowledge", resourceType: "alert", resourceId: String(req.params.id) });
    res.json({ ok: true });
  });

  router.post("/alerts/:id/resolve", ...requireConnectRole("operator"), async (req, res) => {
    const user = req.connectUser!;
    const resolution = String(req.body?.resolution || "").trim();
    if (!resolution) return err(res, 422, "validation_failed", "Indica cómo se ha resuelto la alerta");
    const ok = await resolveAlert(Number(req.params.id), user.name || user.email, resolution);
    if (!ok) return err(res, 409, "invalid_state", "La alerta ya estaba resuelta");
    await auditConnect({ req, action: "oi.alert.resolve", resourceType: "alert", resourceId: String(req.params.id), detail: { resolution } });
    res.json({ ok: true });
  });

  router.post("/alerts/:id/comment", ...requireConnectRole("operator"), async (req, res) => {
    const user = req.connectUser!;
    const text = String(req.body?.text || "").trim();
    if (!text) return err(res, 422, "validation_failed", "El comentario está vacío");
    const ok = await commentAlert(Number(req.params.id), user.name || user.email, text.slice(0, 1000));
    if (!ok) return err(res, 404, "not_found", "Alerta no encontrada");
    res.json({ ok: true });
  });

  router.post("/alerts/:id/assign", ...requireConnectRole("supervisor"), async (req, res) => {
    const userId = Number(req.body?.userId);
    if (!Number.isFinite(userId)) return err(res, 422, "validation_failed", "userId no válido");
    const ok = await assignAlert(Number(req.params.id), userId);
    if (!ok) return err(res, 404, "not_found", "Alerta no encontrada");
    await auditConnect({ req, action: "oi.alert.assign", resourceType: "alert", resourceId: String(req.params.id), detail: { userId } });
    res.json({ ok: true });
  });

  router.post("/alerts/refresh", ...requireConnectRole("supervisor"), async (_req, res) => {
    res.json({ ok: true, created: await runAlertRules() });
  });

  // ── 7. Informes ─────────────────────────────────────────────────────────

  router.get("/reports", ...requireConnectRole("analyst"), async (_req, res) => {
    const schedules = await db.query(`SELECT * FROM operational_report_schedule ORDER BY id DESC`);
    res.json({
      catalog: REPORT_CATALOG,
      schedules: schedules.rows.map((s) => ({ ...s, recipients: safeJson(s.recipients) })),
    });
  });

  router.post("/reports/generate", ...requireConnectRole("analyst"), async (req, res) => {
    const scope = scopeForUser(req.connectUser!);
    const kind = String(req.body?.kind || "");
    const filters = applyScope(parseFilters(req.body ?? {}), scope);
    const report = await generateReport(kind, filters, scope);
    if (!report) return err(res, 404, "not_found", `Informe no disponible. Tipos: ${REPORT_CATALOG.map((r) => r.kind).join(", ")}`);
    await auditConnect({ req, action: "oi.report.generate", resourceType: "report", resourceId: kind, detail: { from: filters.from, to: filters.to } });

    if (String(req.body?.format || "json") === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${kind}-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(reportToCsv(report));
    }
    res.json(report);
  });

  router.post("/reports/schedule", ...requireConnectRole("cc_admin"), async (req, res) => {
    const user = req.connectUser!;
    const b = req.body ?? {};
    const kind = String(b.kind || "");
    if (!REPORT_CATALOG.some((r) => r.kind === kind)) return err(res, 422, "validation_failed", "Tipo de informe no válido");
    const recipients = Array.isArray(b.recipients) ? b.recipients.map((x: unknown) => String(x).trim()).filter(Boolean) : [];
    if (!recipients.length) return err(res, 422, "validation_failed", "Indica al menos un destinatario");
    const frequency = ["daily", "weekly", "monthly"].includes(String(b.frequency)) ? String(b.frequency) : "daily";
    const hourUtc = Math.min(23, Math.max(0, Number(b.hourUtc ?? 6)));
    const now = Date.now();
    const r = await db.query(
      `INSERT INTO operational_report_schedule
         ("controlCenterId","reportKind",name,frequency,"hourUtc",recipients,format,filters,
          "nextRunAtMs","createdByUserId","createdAtMs","updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`,
      [
        user.controlCenterId, kind, String(b.name || REPORT_CATALOG.find((r) => r.kind === kind)!.name),
        frequency, hourUtc, JSON.stringify(recipients), String(b.format || "csv"),
        JSON.stringify(b.filters ?? {}), nextRunAt(frequency, hourUtc), user.id, now,
      ],
    );
    await auditConnect({ req, action: "oi.report.schedule", resourceType: "report_schedule", resourceId: r.rows[0].id, detail: { kind, frequency, recipients: recipients.length } });
    res.status(201).json({ ...r.rows[0], recipients });
  });

  router.delete("/reports/schedule/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    await db.query(`UPDATE operational_report_schedule SET active = false, "updatedAtMs" = $2 WHERE id = $1`, [Number(req.params.id), Date.now()]);
    await auditConnect({ req, action: "oi.report.schedule.disable", resourceType: "report_schedule", resourceId: String(req.params.id) });
    res.status(204).end();
  });

  // ── 8. Asistente operacional ────────────────────────────────────────────

  router.post("/assistant/query", ...requireConnectUser(), async (req, res) => {
    const user = req.connectUser!;
    const scope = scopeForUser(user);
    const question = String(req.body?.question || "");
    const answer = await askAssistant(question, scope, {
      userId: user.id, userName: user.name || user.email, userRole: user.role, controlCenterId: user.controlCenterId,
    });
    res.json(answer);
  });

  router.get("/assistant/suggestions", ...requireConnectUser(), (_req, res) => {
    res.json({ data: ASSISTANT_SUGGESTIONS });
  });

  router.get("/assistant/history", ...requireConnectRole("cc_admin"), async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const r = await db.query(
      `SELECT id, "userName", "userRole", question, intent, "durationMs", "createdAtMs"
         FROM ai_assistant_query ORDER BY id DESC LIMIT $1`,
      [limit],
    );
    res.json({ data: r.rows });
  });

  // ── 9. Configuración y gobierno de la IA ────────────────────────────────

  router.get("/models", ...requireConnectRole("analyst"), async (_req, res) => {
    const [models, accuracy, feedback] = await Promise.all([
      db.query(`SELECT * FROM ai_model_registry ORDER BY "modelType"`),
      modelAccuracy(30),
      db.query(
        `SELECT accepted, COUNT(*)::int AS n FROM ai_feedback WHERE "createdAtMs" >= $1 GROUP BY 1`,
        [Date.now() - 30 * DAY_MS],
      ),
    ]);
    res.json({
      models: models.rows.map((m) => ({ ...m, accuracyMetrics: safeJson(m.accuracyMetrics), configuration: safeJson(m.configuration) })),
      accuracy,
      feedback: feedback.rows,
    });
  });

  router.patch("/models/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    const status = String(req.body?.status || "");
    if (!["active", "shadow", "retired"].includes(status)) return err(res, 422, "validation_failed", "status no válido");
    await db.query(`UPDATE ai_model_registry SET status = $2 WHERE id = $1`, [Number(req.params.id), status]);
    await auditConnect({ req, action: "oi.model.update", resourceType: "ai_model", resourceId: String(req.params.id), detail: { status } });
    res.json({ ok: true });
  });

  /** Inventario de datos: qué KPIs pueden calcularse hoy y qué falta para el resto. */
  router.get("/data-inventory", ...requireConnectRole("analyst"), async (_req, res) => {
    const available = KPI_CATALOG.filter((k) => k.available !== false);
    const missing = KPI_CATALOG.filter((k) => k.available === false);
    res.json({
      totals: { total: KPI_CATALOG.length, available: available.length, missing: missing.length },
      available: available.map((k) => ({ code: k.code, name: k.name, category: k.category, formula: k.formula })),
      missing: missing.map((k) => ({ code: k.code, name: k.name, category: k.category, missingData: k.missingData })),
    });
  });

  return router;
}

function publicRecommendation(r: any) {
  return {
    ...r,
    proposedAction: safeJson(r.proposedAction),
    explanation: safeJson(r.explanation),
  };
}

function safeJson(v: unknown): any {
  try { return typeof v === "string" ? JSON.parse(v) : (v ?? {}); } catch { return {}; }
}
