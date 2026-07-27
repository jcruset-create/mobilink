/**
 * Connect Pro — API del backoffice del centro de control (/api/connect/bo).
 *
 * Autenticación: sesión unificada Supabase + rol Connect (rbac.ts).
 * Sprint 1: me, resumen del dashboard, empresas proveedoras (+delegaciones,
 * talleres, autorizaciones), usuarios, catálogos y auditoría.
 */

import crypto from "node:crypto";
import { Router, json, type Response } from "express";
import db from "../db.ts";
import { requireConnectRole, auditConnect } from "./rbac.ts";
import {
  createAssistance, submitDraft, assignAssistance, transition, InvalidTransitionError,
  findCandidates, offerToWorkshop, acceptAssignment, rejectAssignment, withdrawAndReassign,
} from "./service.ts";
import { requireProviderUser, requireConnectUser } from "./rbac.ts";
import { assistanceKpis, hashPin, newPinSalt } from "./lite.ts";
import {
  WORKSHOP_INTEGRATION_TYPES, WORKSHOP_TIER, LITE_STATUS_LABELS, computeLiteKpis, statusQualityScore,
} from "./liteRules.ts";
import { connectBus } from "./bus.ts";
import { setManualStatus } from "./mobileunits.ts";
import { kpiDashboard, demandOutlook } from "./intelligence.ts";
import { createAlert } from "./alerts.ts";

function err(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

/** Código corto e irrepetible que el taller Lite teclea en la APK (p. ej. TALLERSUR-7431). */
async function generateLiteCode(name: string): Promise<string> {
  const base = String(name || "taller")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "TALLER";
  for (let i = 0; i < 20; i++) {
    const code = `${base}-${crypto.randomInt(1000, 9999)}`;
    const hit = await db.query(`SELECT 1 FROM connect_workshops WHERE "liteCode" = $1`, [code]);
    if (!hit.rows[0]) return code;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export function createConnectBackofficeRouter(): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  // ── Sesión ────────────────────────────────────────────────

  router.get("/me", ...requireConnectUser(), async (req, res) => {
    const u = req.connectUser!;
    const cc = u.controlCenterId
      ? (await db.query(`SELECT id, name FROM connect_control_centers WHERE id = $1`, [u.controlCenterId])).rows[0]
      : null;
    res.json({ user: u, controlCenter: cc });
  });

  // ── Dashboard (resumen mínimo Sprint 1) ───────────────────

  router.get("/stats/overview", ...requireConnectRole("analyst"), async (_req, res) => {
    const now = Date.now();
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const [byStatus, today, providers, workshops] = await Promise.all([
      db.query(`SELECT status, COUNT(*)::int AS n FROM connect_assistances GROUP BY status`),
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'finished')::int AS finished,
           COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
           COUNT(*)::int AS created
         FROM connect_assistances WHERE "createdAtMs" >= $1`,
        [dayStart.getTime()],
      ),
      db.query(`SELECT COUNT(*)::int AS n FROM connect_provider_companies WHERE status = 'active' AND "deletedAtMs" IS NULL`),
      db.query(`SELECT COUNT(*)::int AS n FROM connect_workshops WHERE "connectStatus" = 'active'`),
    ]);
    const statusMap: Record<string, number> = {};
    for (const r of byStatus.rows) statusMap[r.status] = r.n;
    const active = (statusMap.assigned ?? 0) + (statusMap.technician_assigned ?? 0) +
      (statusMap.en_route ?? 0) + (statusMap.arrived ?? 0) + (statusMap.in_progress ?? 0);
    res.json({
      generated_at: now,
      cards: {
        active,
        pending: (statusMap.pending ?? 0) + (statusMap.searching ?? 0),
        unassigned_failed: (statusMap.assignment_failed ?? 0) + (statusMap.no_coverage ?? 0),
        en_route: statusMap.en_route ?? 0,
        in_progress: statusMap.in_progress ?? 0,
        finished_today: today.rows[0].finished,
        cancelled_today: today.rows[0].cancelled,
        created_today: today.rows[0].created,
        providers_active: providers.rows[0].n,
        workshops_active: workshops.rows[0].n,
      },
      by_status: statusMap,
    });
  });

  // ── Tiempo real y alertas (Fase 2) ────────────────────────

  // SSE: EventSource no admite cabeceras → el token viaja en ?access_token
  router.get(
    "/events",
    (req, _res, next) => {
      if (req.query.access_token && !req.headers.authorization) {
        req.headers.authorization = `Bearer ${String(req.query.access_token)}`;
      }
      next();
    },
    ...requireConnectRole("analyst"),
    (req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`event: hello\ndata: {}\n\n`);
      const onPush = (push: unknown) => res.write(`event: push\ndata: ${JSON.stringify(push)}\n\n`);
      connectBus.on("push", onPush);
      const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000);
      req.on("close", () => {
        clearInterval(heartbeat);
        connectBus.off("push", onPush);
      });
    },
  );

  router.get("/alerts", ...requireConnectRole("analyst"), async (req, res) => {
    const onlyUnread = req.query.unread === "true";
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const [rows, unread] = await Promise.all([
      db.query(
        `SELECT * FROM connect_alerts WHERE $1::bool = false OR status = 'unread' ORDER BY id DESC LIMIT $2`,
        [onlyUnread, limit],
      ),
      db.query(`SELECT COUNT(*)::int AS n FROM connect_alerts WHERE status = 'unread'`),
    ]);
    res.json({ data: rows.rows, unread: unread.rows[0].n });
  });

  router.post("/alerts/:id/read", ...requireConnectRole("operator"), async (req, res) => {
    await db.query(
      `UPDATE connect_alerts SET status = 'read', "readAtMs" = $1, "readByUserId" = $2 WHERE id = $3 AND status = 'unread'`,
      [Date.now(), req.connectUser!.id, Number(req.params.id)],
    );
    res.json({ ok: true });
  });

  router.post("/alerts/read-all", ...requireConnectRole("operator"), async (req, res) => {
    await db.query(
      `UPDATE connect_alerts SET status = 'read', "readAtMs" = $1, "readByUserId" = $2 WHERE status = 'unread'`,
      [Date.now(), req.connectUser!.id],
    );
    res.json({ ok: true });
  });

  // ── Centro de Inteligencia Operacional ────────────────────

  router.get("/oi/dashboard", ...requireConnectRole("analyst"), async (_req, res) => {
    res.json({ kpis: await kpiDashboard(), generated_at: Date.now() });
  });

  router.get("/oi/kpis/history", ...requireConnectRole("analyst"), async (req, res) => {
    const days = Math.min(Number(req.query.days) || 30, 120);
    const r = await db.query(
      `SELECT "kpiCode", "periodDate", value FROM connect_kpi_values
        WHERE "periodDate" >= to_char(now() - ($1 || ' days')::interval, 'YYYY-MM-DD')
        ORDER BY "periodDate"`,
      [days],
    );
    res.json({ data: r.rows });
  });

  router.patch("/oi/kpis/:code", ...requireConnectRole("cc_admin"), async (req, res) => {
    const b = req.body ?? {};
    const r = await db.query(
      `UPDATE connect_kpi_definitions SET
         "targetValue" = COALESCE($1, "targetValue"),
         "warningThreshold" = COALESCE($2, "warningThreshold"),
         "criticalThreshold" = COALESCE($3, "criticalThreshold"),
         active = COALESCE($4, active)
       WHERE code = $5 RETURNING *`,
      [b.targetValue ?? null, b.warningThreshold ?? null, b.criticalThreshold ?? null,
       b.active ?? null, String(req.params.code)],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "KPI no encontrado");
    await auditConnect({ req, action: "oi.kpi_configured", detail: { code: req.params.code, ...b } });
    res.json(r.rows[0]);
  });

  router.get("/oi/demand", ...requireConnectRole("analyst"), async (_req, res) => {
    res.json(await demandOutlook());
  });

  router.get("/oi/recommendations", ...requireConnectRole("analyst"), async (req, res) => {
    const status = req.query.status ? String(req.query.status) : "open";
    const r = await db.query(
      `SELECT * FROM connect_recommendations
        WHERE $1 = 'all' OR status = $1 ORDER BY priority = 'high' DESC, id DESC LIMIT 100`,
      [status],
    );
    res.json({ data: r.rows });
  });

  router.post("/oi/recommendations/:id/accept", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    const r = await db.query(
      `UPDATE connect_recommendations
          SET status = 'accepted', "resolvedByUserId" = $1, "resolvedByName" = $2, "resolvedAtMs" = $3
        WHERE id = $4 AND status = 'open' RETURNING *`,
      [u.id, u.name, Date.now(), Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Recomendación no encontrada o ya resuelta");
    await auditConnect({ req, action: "oi.recommendation_accepted", resourceType: "recommendation", resourceId: Number(req.params.id) });
    res.json(r.rows[0]);
  });

  router.post("/oi/recommendations/:id/reject", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    const reason = String(req.body?.reason || "").trim();
    const r = await db.query(
      `UPDATE connect_recommendations
          SET status = 'rejected', "resolvedByUserId" = $1, "resolvedByName" = $2,
              "resolvedAtMs" = $3, "rejectionReason" = $4
        WHERE id = $5 AND status = 'open' RETURNING *`,
      [u.id, u.name, Date.now(), reason || null, Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Recomendación no encontrada o ya resuelta");
    await auditConnect({ req, action: "oi.recommendation_rejected", resourceType: "recommendation", resourceId: Number(req.params.id), detail: { reason } });
    res.json(r.rows[0]);
  });

  // ── Estadísticas (Sprint 6) ───────────────────────────────

  router.get("/stats/providers", ...requireConnectRole("analyst"), async (req, res) => {
    const days = Math.min(Number(req.query.days) || 90, 365);
    const since = Date.now() - days * 24 * 3600_000;
    const r = await db.query(
      `SELECT w.id AS "workshopId", w.name AS "workshopName", w."currentScore",
              pc.id AS "providerCompanyId", pc.name AS "providerName",
              (SELECT COUNT(*)::int FROM connect_assignments a WHERE a."workshopId" = w.id AND a."sentAtMs" >= $1) AS offered,
              (SELECT COUNT(*)::int FROM connect_assignments a WHERE a."workshopId" = w.id AND a."sentAtMs" >= $1 AND a.status = 'accepted') AS accepted,
              (SELECT COUNT(*)::int FROM connect_assignments a WHERE a."workshopId" = w.id AND a."sentAtMs" >= $1 AND a.status = 'rejected') AS rejected,
              (SELECT COUNT(*)::int FROM connect_assignments a WHERE a."workshopId" = w.id AND a."sentAtMs" >= $1 AND a.status = 'expired') AS expired,
              (SELECT COUNT(*)::int FROM connect_assistances ca WHERE ca."workshopId" = w.id AND ca."createdAtMs" >= $1 AND ca.status = 'finished') AS finished,
              (SELECT COUNT(*)::int FROM connect_assistances ca WHERE ca."workshopId" = w.id AND ca.status IN ('assigned','technician_assigned','en_route','arrived','in_progress')) AS active,
              (SELECT COUNT(*)::int FROM connect_incidents i WHERE i."workshopId" = w.id AND i."createdAtMs" >= $1) AS incidents,
              (SELECT AVG((a."respondedAtMs" - a."sentAtMs") / 60000.0)
                 FROM connect_assignments a
                WHERE a."workshopId" = w.id AND a."sentAtMs" >= $1 AND a.status = 'accepted' AND a.mode = 'offer') AS "avgAcceptMin",
              (SELECT AVG((arr."occurredAtMs" - asg."occurredAtMs") / 60000.0)
                 FROM connect_assistances ca
                 JOIN connect_status_history asg ON asg."assistanceId" = ca.id AND asg."toStatus" = 'assigned'
                 JOIN connect_status_history arr ON arr."assistanceId" = ca.id AND arr."toStatus" = 'arrived'
                WHERE ca."workshopId" = w.id AND ca."createdAtMs" >= $1) AS "avgArrivalMin",
              sc.components AS "scoreComponents", sc.confidence, sc.tier, sc."sampleSize"
         FROM connect_workshops w
         LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
         LEFT JOIN LATERAL (
           SELECT components, confidence, tier, "sampleSize"
             FROM connect_workshop_scores WHERE "workshopId" = w.id ORDER BY id DESC LIMIT 1
         ) sc ON true
        ORDER BY w."currentScore" DESC`,
      [since],
    );
    res.json({ data: r.rows, window_days: days });
  });

  router.get("/stats/evolution", ...requireConnectRole("analyst"), async (req, res) => {
    const days = Math.min(Number(req.query.days) || 14, 90);
    const since = Date.now() - days * 24 * 3600_000;
    const [daily, byService] = await Promise.all([
      db.query(
        `SELECT to_char(to_timestamp("createdAtMs" / 1000), 'YYYY-MM-DD') AS day,
                COUNT(*)::int AS created,
                COUNT(*) FILTER (WHERE status = 'finished')::int AS finished,
                COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
           FROM connect_assistances
          WHERE "createdAtMs" >= $1 AND status <> 'draft'
          GROUP BY day ORDER BY day`,
        [since],
      ),
      db.query(
        `SELECT "serviceType", COUNT(*)::int AS n
           FROM connect_assistances
          WHERE "createdAtMs" >= $1 AND status <> 'draft'
          GROUP BY "serviceType" ORDER BY n DESC`,
        [since],
      ),
    ]);
    res.json({ daily: daily.rows, by_service: byService.rows, window_days: days });
  });

  // ── Centro de control operativo (Sprint 4) ────────────────

  router.get("/control-center", ...requireConnectRole("operator"), async (_req, res) => {
    const now = Date.now();
    const r = await db.query(
      `SELECT ca.id, ca.uuid, ca.status, ca.priority, ca."serviceType", ca.address,
              ca."customerName", ca."customerPhone", ca."expedientNumber", ca."externalReference",
              ca."clientName", ca.origin, ca."slaDeadlineAtMs", ca."createdAtMs", ca."updatedAtMs",
              ca.latitude, ca.longitude,
              p.name AS "partnerName", w.name AS "workshopName",
              ra."assignedTechName", ra.status AS "coreStatus",
              asg."acceptDeadlineMs"
         FROM connect_assistances ca
         LEFT JOIN connect_partners p ON p.id = ca."partnerId"
         LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
         LEFT JOIN roadside_assistances ra ON ra.id = ca."coreAssistanceId"
         LEFT JOIN LATERAL (
           SELECT "acceptDeadlineMs" FROM connect_assignments
            WHERE "assistanceId" = ca.id AND status = 'sent' ORDER BY id DESC LIMIT 1
         ) asg ON true
        WHERE ca.status NOT IN ('finished', 'cancelled')
        ORDER BY ca.priority = 'urgente' DESC, ca."createdAtMs" ASC`,
    );

    const pending: any[] = [], assigning: any[] = [], active: any[] = [], attention: any[] = [];
    for (const a of r.rows) {
      const slaRisk = a.slaDeadlineAtMs != null && Number(a.slaDeadlineAtMs) - now < 15 * 60_000;
      const slaBreached = a.slaDeadlineAtMs != null && Number(a.slaDeadlineAtMs) < now;
      const row = { ...a, slaRisk, slaBreached };
      if (["assignment_failed", "no_coverage"].includes(a.status) || slaBreached) attention.push(row);
      else if (["draft", "pending"].includes(a.status)) pending.push(row);
      else if (["searching", "awaiting_acceptance"].includes(a.status)) assigning.push(row);
      else active.push(row);
    }
    res.json({ generated_at: now, pending, assigning, active, attention });
  });

  // Mapa operativo: asistencias activas + talleres + posición de técnicos
  router.get("/map", ...requireConnectRole("operator"), async (_req, res) => {
    const [assistances, workshops] = await Promise.all([
      db.query(
        `SELECT ca.id, ca.status, ca.priority, ca."serviceType", ca.address, ca."customerName",
                ca.latitude, ca.longitude, w.name AS "workshopName", ra."assignedTechName",
                ra."webfleetVehicleId"
           FROM connect_assistances ca
           LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
           LEFT JOIN roadside_assistances ra ON ra.id = ca."coreAssistanceId"
          WHERE ca.status NOT IN ('finished', 'cancelled', 'draft')
            AND ca.latitude IS NOT NULL`,
      ),
      db.query(
        `SELECT w.id, w.name, w.latitude, w.longitude, w."radiusKm", w."connectStatus",
                w."currentScore", pc.name AS "providerName"
           FROM connect_workshops w
           LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"`,
      ),
    ]);
    res.json({ assistances: assistances.rows, workshops: workshops.rows });
  });

  // ── Empresas proveedoras ──────────────────────────────────

  router.get("/providers", ...requireConnectRole("analyst"), async (_req, res) => {
    const r = await db.query(
      `SELECT pc.*,
              (SELECT COUNT(*)::int FROM connect_branches b WHERE b."providerCompanyId" = pc.id AND b."deletedAtMs" IS NULL) AS branches,
              (SELECT COUNT(*)::int FROM connect_workshops w WHERE w."providerCompanyId" = pc.id) AS workshops
         FROM connect_provider_companies pc
        WHERE pc."deletedAtMs" IS NULL
        ORDER BY pc.name`,
    );
    res.json({ data: r.rows });
  });

  router.post("/providers", ...requireConnectRole("cc_admin"), async (req, res) => {
    const { name, contactEmail, contactPhone, licenseUuid, notes } = req.body ?? {};
    if (!name?.trim()) return err(res, 422, "validation_failed", "El nombre es obligatorio");
    const now = Date.now();
    const r = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "licenseUuid", "contactEmail", "contactPhone", notes, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
      [crypto.randomUUID(), name.trim(), licenseUuid ?? null, contactEmail ?? null, contactPhone ?? null, notes ?? null, now],
    );
    await auditConnect({ req, action: "provider.created", resourceType: "provider", resourceId: r.rows[0].id, detail: { name } });
    res.status(201).json(r.rows[0]);
  });

  router.patch("/providers/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    const id = Number(req.params.id);
    const { name, contactEmail, contactPhone, status, notes } = req.body ?? {};
    const r = await db.query(
      `UPDATE connect_provider_companies
          SET name = COALESCE($1, name), "contactEmail" = COALESCE($2, "contactEmail"),
              "contactPhone" = COALESCE($3, "contactPhone"), status = COALESCE($4, status),
              notes = COALESCE($5, notes), "updatedAtMs" = $6
        WHERE id = $7 AND "deletedAtMs" IS NULL RETURNING *`,
      [name ?? null, contactEmail ?? null, contactPhone ?? null, status ?? null, notes ?? null, Date.now(), id],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Empresa no encontrada");
    await auditConnect({ req, action: "provider.updated", resourceType: "provider", resourceId: id, detail: req.body });
    res.json(r.rows[0]);
  });

  router.get("/providers/:id/branches", ...requireConnectRole("analyst"), async (req, res) => {
    const r = await db.query(
      `SELECT * FROM connect_branches WHERE "providerCompanyId" = $1 AND "deletedAtMs" IS NULL ORDER BY name`,
      [Number(req.params.id)],
    );
    res.json({ data: r.rows });
  });

  router.post("/providers/:id/branches", ...requireConnectRole("cc_admin"), async (req, res) => {
    const { name, address, latitude, longitude, phone } = req.body ?? {};
    if (!name?.trim()) return err(res, 422, "validation_failed", "El nombre es obligatorio");
    const now = Date.now();
    const r = await db.query(
      `INSERT INTO connect_branches ("providerCompanyId", name, address, latitude, longitude, phone, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,
      [Number(req.params.id), name.trim(), address ?? null, latitude ?? null, longitude ?? null, phone ?? null, now],
    );
    await auditConnect({ req, action: "branch.created", resourceType: "branch", resourceId: r.rows[0].id });
    res.status(201).json(r.rows[0]);
  });

  router.get("/providers/:id/workshops", ...requireConnectRole("analyst"), async (req, res) => {
    const r = await db.query(`SELECT * FROM connect_workshops WHERE "providerCompanyId" = $1 ORDER BY name`, [Number(req.params.id)]);
    res.json({ data: r.rows });
  });

  // ── Talleres de la red ────────────────────────────────────

  router.get("/workshops", ...requireConnectRole("analyst"), async (_req, res) => {
    const r = await db.query(
      `SELECT w.*, pc.name AS "providerName", b.name AS "branchName"
         FROM connect_workshops w
         LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
         LEFT JOIN connect_branches b ON b.id = w."branchId"
        ORDER BY w.name`,
    );
    res.json({ data: r.rows });
  });

  router.post("/workshops", ...requireConnectRole("cc_admin"), async (req, res) => {
    const b = req.body ?? {};
    if (!b.name?.trim() || typeof b.latitude !== "number" || typeof b.longitude !== "number") {
      return err(res, 422, "validation_failed", "name, latitude y longitude son obligatorios");
    }
    const now = Date.now();
    const r = await db.query(
      `INSERT INTO connect_workshops
         ("coreWorkshopId", "providerCompanyId", "branchId", name, phone, latitude, longitude, "radiusKm", services, "integrationType", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`,
      [
        b.coreWorkshopId ?? null, b.providerCompanyId ?? null, b.branchId ?? null,
        b.name.trim(), b.phone ?? null, b.latitude, b.longitude, Number(b.radiusKm) || 60,
        JSON.stringify(Array.isArray(b.services) && b.services.length ? b.services : []),
        WORKSHOP_INTEGRATION_TYPES.includes(b.integrationType) ? b.integrationType : "assist",
        now,
      ],
    );
    // Los talleres Lite necesitan un código corto para el login de la APK
    if (r.rows[0].integrationType === "lite") {
      await db.query(`UPDATE connect_workshops SET "liteCode" = $1 WHERE id = $2 AND "liteCode" IS NULL`,
        [await generateLiteCode(r.rows[0].name), r.rows[0].id]);
    }
    await auditConnect({ req, action: "workshop.created", resourceType: "workshop", resourceId: r.rows[0].id });
    res.status(201).json(r.rows[0]);
  });

  // Actualizar taller (posición GPS desde el mapa, radio, teléfono…)
  router.patch("/workshops/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    const b = req.body ?? {};
    if ((b.latitude != null && typeof b.latitude !== "number") || (b.longitude != null && typeof b.longitude !== "number")) {
      return err(res, 422, "validation_failed", "latitude y longitude deben ser numéricos");
    }
    const u = req.connectUser!;
    const now = Date.now();
    const r = await db.query(
      `UPDATE connect_workshops SET
         name = COALESCE($1, name), phone = COALESCE($2, phone),
         latitude = COALESCE($3, latitude), longitude = COALESCE($4, longitude),
         "radiusKm" = COALESCE($5, "radiusKm"),
         "integrationType" = COALESCE($6, "integrationType"),
         "networkParticipation" = COALESCE($7, "networkParticipation"),
         "networkChangedBy" = CASE WHEN $7 IS NOT NULL THEN $8 ELSE "networkChangedBy" END,
         "networkChangedAtMs" = CASE WHEN $7 IS NOT NULL THEN $9 ELSE "networkChangedAtMs" END,
         "liteSettings" = COALESCE($11, "liteSettings"),
         features = COALESCE($12, features),
         "updatedAtMs" = $9
       WHERE id = $10 RETURNING *`,
      [b.name ?? null, b.phone ?? null, b.latitude ?? null, b.longitude ?? null,
       b.radiusKm != null ? Number(b.radiusKm) : null,
       WORKSHOP_INTEGRATION_TYPES.includes(b.integrationType) ? b.integrationType : null,
       typeof b.networkParticipation === "boolean" ? b.networkParticipation : null,
       u.name, now, Number(req.params.id),
       b.liteSettings ? JSON.stringify(b.liteSettings) : null,
       b.features ? JSON.stringify(b.features) : null],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Taller no encontrado");
    // Cambiar a Lite (o volver) no toca datos: solo el producto habilitado
    if (r.rows[0].integrationType === "lite" && !r.rows[0].liteCode) {
      const code = await generateLiteCode(r.rows[0].name);
      await db.query(`UPDATE connect_workshops SET "liteCode" = $1 WHERE id = $2`, [code, r.rows[0].id]);
      r.rows[0].liteCode = code;
    }
    if (b.integrationType) {
      await auditConnect({
        req, action: "workshop.tier_changed", resourceType: "workshop", resourceId: Number(req.params.id),
        detail: { integrationType: r.rows[0].integrationType, tier: WORKSHOP_TIER[r.rows[0].integrationType] },
      });
    }
    if (typeof b.networkParticipation === "boolean") {
      await auditConnect({
        req, action: b.networkParticipation ? "workshop.network_enabled" : "workshop.network_disabled",
        resourceType: "workshop", resourceId: Number(req.params.id),
      });
    }
    await auditConnect({ req, action: "workshop.updated", resourceType: "workshop", resourceId: Number(req.params.id), detail: b });
    res.json(r.rows[0]);
  });

  // ── Mobilink Assist Lite: operarios, dispositivos y seguimiento ──────────

  /** Operarios del taller Lite (equivalente a los técnicos de un taller FULL). */
  router.get("/workshops/:id/lite-users", ...requireConnectRole("analyst"), async (req, res) => {
    const r = await db.query(
      `SELECT u.id, u.name, u.username, u.email, u.phone, u.role, u.active, u."lastLoginAtMs", u."createdAtMs",
              (SELECT COUNT(*) FROM connect_lite_devices d WHERE d."userId" = u.id AND d."revokedAtMs" IS NULL) AS "devices"
         FROM connect_lite_users u WHERE u."workshopId" = $1 ORDER BY u.name`,
      [Number(req.params.id)],
    );
    res.json({ data: r.rows });
  });

  router.post("/workshops/:id/lite-users", ...requireConnectRole("cc_admin"), async (req, res) => {
    const workshopId = Number(req.params.id);
    const b = req.body ?? {};
    const name = String(b.name || "").trim();
    const username = String(b.username || "").trim().toLowerCase();
    const pin = String(b.pin || "").trim();
    if (!name || !username) return err(res, 422, "validation_failed", "name y username son obligatorios");
    if (!/^\d{4,8}$/.test(pin)) return err(res, 422, "validation_failed", "El PIN debe tener entre 4 y 8 dígitos");

    const w = await db.query(`SELECT id, "integrationType", "liteCode" FROM connect_workshops WHERE id = $1`, [workshopId]);
    if (!w.rows[0]) return err(res, 404, "not_found", "Taller no encontrado");
    if (w.rows[0].integrationType !== "lite") {
      return err(res, 409, "not_lite", "El taller no tiene Mobilink Assist Lite habilitado");
    }
    const salt = newPinSalt();
    const now = Date.now();
    try {
      const r = await db.query(
        `INSERT INTO connect_lite_users
           (uuid, "workshopId", "providerCompanyId", name, username, email, phone, "pinHash", "pinSalt", role, "createdAtMs", "updatedAtMs")
         SELECT $1, $2, w."providerCompanyId", $3, $4, $5, $6, $7, $8, $9, $10, $10
           FROM connect_workshops w WHERE w.id = $2
         RETURNING id, name, username, role, active, "createdAtMs"`,
        [
          crypto.randomUUID(), workshopId, name, username, b.email ?? null, b.phone ?? null,
          hashPin(pin, salt), salt, b.role === "workshop_admin" ? "workshop_admin" : "operator", now,
        ],
      );
      await auditConnect({ req, action: "lite.user_created", resourceType: "lite_user", resourceId: r.rows[0].id, detail: { workshopId, username } });
      res.status(201).json({ ...r.rows[0], workshopCode: w.rows[0].liteCode });
    } catch (e: any) {
      if (String(e?.message).includes("duplicate")) {
        return err(res, 409, "duplicate", "Ya existe un usuario con ese nombre de acceso en el taller");
      }
      throw e;
    }
  });

  router.patch("/lite-users/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body ?? {};
    const pin = b.pin != null ? String(b.pin).trim() : null;
    if (pin != null && !/^\d{4,8}$/.test(pin)) {
      return err(res, 422, "validation_failed", "El PIN debe tener entre 4 y 8 dígitos");
    }
    const salt = pin != null ? newPinSalt() : null;
    const r = await db.query(
      `UPDATE connect_lite_users SET
         name = COALESCE($1, name), role = COALESCE($2, role), active = COALESCE($3, active),
         email = COALESCE($4, email), phone = COALESCE($5, phone),
         "pinHash" = COALESCE($6, "pinHash"), "pinSalt" = COALESCE($7, "pinSalt"),
         "updatedAtMs" = $8
       WHERE id = $9 RETURNING id, name, username, role, active`,
      [
        b.name ?? null,
        b.role === "workshop_admin" || b.role === "operator" ? b.role : null,
        typeof b.active === "boolean" ? b.active : null,
        b.email ?? null, b.phone ?? null,
        pin != null && salt ? hashPin(pin, salt) : null, salt, Date.now(), id,
      ],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Usuario no encontrado");
    // Desactivar o cambiar el PIN cierra las sesiones abiertas
    if (b.active === false || pin != null) {
      await db.query(`UPDATE connect_lite_devices SET "revokedAtMs" = $1 WHERE "userId" = $2 AND "revokedAtMs" IS NULL`,
        [Date.now(), id]);
    }
    await auditConnect({
      req, action: pin != null ? "lite.user_pin_reset" : "lite.user_updated",
      resourceType: "lite_user", resourceId: id, detail: { active: b.active, role: b.role },
    });
    res.json(r.rows[0]);
  });

  router.get("/workshops/:id/lite-devices", ...requireConnectRole("analyst"), async (req, res) => {
    const r = await db.query(
      `SELECT d.id, d."deviceId", d.platform, d."osVersion", d."appVersion",
              d."gpsPermission", d."cameraPermission", d."notifPermission",
              d."fcmToken" IS NOT NULL AS "pushEnabled", d."lastSeenAtMs", d."revokedAtMs", d."createdAtMs",
              u.name AS "userName", u.id AS "userId"
         FROM connect_lite_devices d JOIN connect_lite_users u ON u.id = d."userId"
        WHERE d."workshopId" = $1 ORDER BY d."lastSeenAtMs" DESC NULLS LAST LIMIT 100`,
      [Number(req.params.id)],
    );
    res.json({ data: r.rows });
  });

  router.post("/lite-devices/:id/revoke", ...requireConnectRole("cc_admin"), async (req, res) => {
    const r = await db.query(
      `UPDATE connect_lite_devices SET "revokedAtMs" = $1, "fcmToken" = NULL
        WHERE id = $2 AND "revokedAtMs" IS NULL RETURNING id`,
      [Date.now(), Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Dispositivo no encontrado o ya revocado");
    await auditConnect({ req, action: "lite.device_revoked", resourceType: "lite_device", resourceId: Number(req.params.id) });
    res.json({ ok: true });
  });

  /** Todo lo que el taller ha reportado: rastro GPS, evidencias, firma y KPIs. */
  router.get("/assistances/:id/lite", ...requireConnectRole("analyst"), async (req, res) => {
    const id = Number(req.params.id);
    const a = await db.query(
      `SELECT ca.id, ca.status, ca."liteUserId", ca."liteUserName", ca."resultCode", ca."resolutionNotes",
              ca."odometerKm", ca."workedMinutes", ca."operatorLat", ca."operatorLng",
              ca."operatorAccuracyM", ca."operatorSpeedKmh", ca."operatorLocationAtMs",
              ca.latitude, ca.longitude, w.name AS "workshopName", w."integrationType",
              w.latitude AS "workshopLat", w.longitude AS "workshopLng"
         FROM connect_assistances ca
         LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
        WHERE ca.id = $1`,
      [id],
    );
    if (!a.rows[0]) return err(res, 404, "not_found", "Asistencia no encontrada");

    const [track, files, signature, device] = await Promise.all([
      db.query(
        `SELECT lat, lng, "accuracyM", "speedKmh", "headingDeg", status, "deviceTsMs"
           FROM connect_assistance_tracks WHERE "assistanceId" = $1 ORDER BY "deviceTsMs" LIMIT 2000`,
        [id],
      ),
      db.query(
        `SELECT id, category, url, "fileName", "sizeBytes", lat, lng, "createdAtMs"
           FROM connect_assistance_files WHERE "assistanceId" = $1 AND "deletedAtMs" IS NULL ORDER BY id`,
        [id],
      ),
      db.query(
        `SELECT id, "signerName", "signerDocument", url, "signedAtMs"
           FROM connect_assistance_signatures WHERE "assistanceId" = $1 ORDER BY id DESC LIMIT 1`,
        [id],
      ),
      db.query(
        `SELECT d."lastSeenAtMs", d.platform, d."appVersion", d."gpsPermission", d."notifPermission",
                d."fcmToken" IS NOT NULL AS "pushEnabled"
           FROM connect_lite_devices d
          WHERE d."userId" = (SELECT "liteUserId" FROM connect_assistances WHERE id = $1)
            AND d."revokedAtMs" IS NULL
          ORDER BY d."lastSeenAtMs" DESC NULLS LAST LIMIT 1`,
        [id],
      ),
    ]);

    const lastAtMs = a.rows[0].operatorLocationAtMs ? Number(a.rows[0].operatorLocationAtMs) : null;
    res.json({
      assistance: a.rows[0],
      tier: WORKSHOP_TIER[a.rows[0].integrationType] ?? null,
      track: track.rows.map((p: any) => ({ ...p, deviceTsMs: Number(p.deviceTsMs) })),
      files: files.rows,
      signature: signature.rows[0] ?? null,
      device: device.rows[0] ?? null,
      kpis: await assistanceKpis(id),
      // "Ubicación desactualizada" es información operativa, no un color
      locationStale: lastAtMs ? Date.now() - lastAtMs > 5 * 60_000 : null,
      lastLocationAtMs: lastAtMs,
    });
  });

  /** KPIs agregados del taller (sirven igual para FULL, LITE y EXTERNAL). */
  router.get("/workshops/:id/kpis", ...requireConnectRole("analyst"), async (req, res) => {
    const workshopId = Number(req.params.id);
    const days = Math.min(Number(req.query.days) || 30, 365);
    const since = Date.now() - days * 24 * 3600_000;

    const rows = await db.query(
      `SELECT ca.id, ca.status, ca."acceptedAtMs", ca."slaDeadlineAtMs", ca."resultCode"
         FROM connect_assistances ca
        WHERE ca."workshopId" = $1 AND ca."createdAtMs" > $2`,
      [workshopId, since],
    );
    const ids = rows.rows.map((r: any) => r.id);
    const history = ids.length
      ? (await db.query(
          `SELECT "assistanceId", "toStatus", "occurredAtMs" FROM connect_status_history
            WHERE "assistanceId" = ANY($1::int[]) ORDER BY id`,
          [ids],
        )).rows
      : [];
    const corrections = ids.length
      ? (await db.query(
          `SELECT "resourceId", COUNT(*)::int AS n FROM connect_audit_logs
            WHERE action = 'assistance.manual_status' AND "resourceId" = ANY($1::text[])
            GROUP BY "resourceId"`,
          [ids.map(String)],
        )).rows
      : [];
    const rejections = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_rejections WHERE "workshopId" = $1 AND "createdAtMs" > $2`,
      [workshopId, since],
    );
    const offers = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assignments WHERE "workshopId" = $1 AND "createdAtMs" > $2`,
      [workshopId, since],
    );

    const byAssistance = new Map<number, { toStatus: string; occurredAtMs: number }[]>();
    for (const h of history) {
      const list = byAssistance.get(h.assistanceId) ?? [];
      list.push({ toStatus: h.toStatus, occurredAtMs: Number(h.occurredAtMs) });
      byAssistance.set(h.assistanceId, list);
    }
    const correctionsById = new Map(corrections.map((c: any) => [Number(c.resourceId), c.n]));

    const per = rows.rows.map((r: any) => {
      const hist = byAssistance.get(r.id) ?? [];
      return {
        id: r.id,
        status: r.status,
        kpis: computeLiteKpis(hist, {
          acceptedAtMs: r.acceptedAtMs ? Number(r.acceptedAtMs) : null,
          slaDeadlineAtMs: r.slaDeadlineAtMs ? Number(r.slaDeadlineAtMs) : null,
        }),
        statusQuality: statusQualityScore(hist, correctionsById.get(r.id) ?? 0),
      };
    });

    const avg = (pick: (x: typeof per[number]) => number | null | undefined) => {
      const values = per.map(pick).filter((v): v is number => typeof v === "number");
      return values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;
    };
    const finished = per.filter((p) => ["finished", "at_workshop"].includes(p.status)).length;
    const slaValues = per.map((p) => p.kpis.slaMet).filter((v): v is boolean => typeof v === "boolean");

    res.json({
      days,
      services: per.length,
      finished,
      unresolved: rows.rows.filter((r: any) => r.resultCode === "not_repaired" || r.resultCode === "customer_absent").length,
      offers: offers.rows[0].n,
      rejections: rejections.rows[0].n,
      rejectionRate: offers.rows[0].n ? Math.round((rejections.rows[0].n / offers.rows[0].n) * 100) : null,
      acceptanceRate: offers.rows[0].n ? Math.round(((offers.rows[0].n - rejections.rows[0].n) / offers.rows[0].n) * 100) : null,
      slaCompliance: slaValues.length ? Math.round((slaValues.filter(Boolean).length / slaValues.length) * 100) : null,
      avgAcceptMin: avg((p) => p.kpis.acceptMin),
      avgTravelMin: avg((p) => p.kpis.travelMin),
      avgAssignToArrivalMin: avg((p) => p.kpis.assignToArrivalMin),
      avgWorkMin: avg((p) => p.kpis.workMin),
      avgTotalMin: avg((p) => p.kpis.totalMin),
      avgReturnMin: avg((p) => p.kpis.returnMin),
      avgStatusQuality: avg((p) => p.statusQuality),
    });
  });

  // Estados manuales para asistencias en talleres externos (sin Mobilink Assist)
  router.post("/assistances/:id/manual-status", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    const id = Number(req.params.id);
    const target = String(req.body?.status || "");
    const allowed = Object.keys(LITE_STATUS_LABELS);
    if (!allowed.includes(target)) return err(res, 422, "validation_failed", `Estado no permitido. Permitidos: ${allowed.join(", ")}`);
    const a = await db.query(
      `SELECT ca."coreAssistanceId", w."integrationType" FROM connect_assistances ca
        LEFT JOIN connect_workshops w ON w.id = ca."workshopId" WHERE ca.id = $1`,
      [id],
    );
    if (!a.rows[0]) return err(res, 404, "not_found", "Asistencia no encontrada");
    if (a.rows[0].coreAssistanceId != null && a.rows[0].integrationType !== "external") {
      return err(res, 409, "not_manual", "Esta asistencia está integrada con Mobilink Assist: los estados se sincronizan solos");
    }
    try {
      const tier = WORKSHOP_TIER[a.rows[0].integrationType] ?? "EXTERNAL";
      await transition(id, target as any, "user", `Corrección manual desde Central (taller ${tier}) por ${u.name}`);
      await auditConnect({ req, action: "assistance.manual_status", resourceType: "assistance", resourceId: id, detail: { target } });
      const r = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [id]);
      res.json(r.rows[0]);
    } catch (e: any) {
      if (e instanceof InvalidTransitionError) return err(res, 409, "invalid_state_transition", e.message);
      throw e;
    }
  });

  // ── Asistencias (lectura Sprint 1; gestión completa en S2/S3) ──

  router.get("/assistances", ...requireConnectRole("analyst"), async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const status = req.query.status ? String(req.query.status) : null;
    const r = await db.query(
      `SELECT ca.*, p.name AS "partnerName", w.name AS "workshopName"
         FROM connect_assistances ca
         LEFT JOIN connect_partners p ON p.id = ca."partnerId"
         LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
        WHERE $1::text IS NULL OR ca.status = $1
        ORDER BY ca.id DESC LIMIT $2`,
      [status, limit],
    );
    res.json({ data: r.rows });
  });

  router.get("/assistances/:id", ...requireConnectRole("analyst"), async (req, res) => {
    const r = await db.query(
      `SELECT ca.*, p.name AS "partnerName", w.name AS "workshopName", w.phone AS "workshopPhone",
              pc.name AS "providerName", u.name AS "createdByName",
              ra."assignedTechName", ra.status AS "coreStatus"
         FROM connect_assistances ca
         LEFT JOIN connect_partners p ON p.id = ca."partnerId"
         LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
         LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
         LEFT JOIN connect_users u ON u.id = ca."createdByUserId"
         LEFT JOIN roadside_assistances ra ON ra.id = ca."coreAssistanceId"
        WHERE ca.id = $1`,
      [Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Asistencia no encontrada");
    res.json(r.rows[0]);
  });

  router.get("/assistances/:id/timeline", ...requireConnectRole("analyst"), async (req, res) => {
    const r = await db.query(
      `SELECT * FROM connect_status_history WHERE "assistanceId" = $1 ORDER BY id`,
      [Number(req.params.id)],
    );
    res.json({ data: r.rows });
  });

  // Crear asistencia manual (borrador o directa)
  router.post("/assistances", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    const b = req.body ?? {};
    if (!b.draft) {
      const missing: string[] = [];
      if (!b.customer?.name && !b.customer?.phone) missing.push("cliente (nombre o teléfono)");
      if (!b.address && (typeof b.location?.lat !== "number" || typeof b.location?.lng !== "number")) missing.push("ubicación");
      if (missing.length) return err(res, 422, "validation_failed", `Faltan datos: ${missing.join(", ")}. Guarda como borrador si aún no los tienes.`);
    }
    // Cliente de cartera: hereda nombre, SLA y prioridad por defecto
    let clientName = b.clientName || null;
    let slaMinutes = b.slaMinutes ? Number(b.slaMinutes) : null;
    let priority = b.priority;
    if (b.clientId) {
      const c = await db.query(`SELECT * FROM connect_clients WHERE id = $1 AND active`, [Number(b.clientId)]);
      if (!c.rows[0]) return err(res, 404, "not_found", "Cliente no encontrado");
      clientName = clientName ?? c.rows[0].name;
      slaMinutes = slaMinutes ?? c.rows[0].defaultSlaMinutes;
      priority = priority ?? c.rows[0].defaultPriority;
    }
    try {
      const { row } = await createAssistance({
        origin: "manual",
        draft: b.draft === true,
        controlCenterId: u.controlCenterId,
        createdByUserId: u.id,
        expedientNumber: b.expedientNumber || null,
        clientName,
        externalReference: b.externalReference || null,
        priority,
        serviceType: b.serviceType,
        description: b.description,
        latitude: typeof b.location?.lat === "number" ? b.location.lat : null,
        longitude: typeof b.location?.lng === "number" ? b.location.lng : null,
        address: b.address,
        customerName: b.customer?.name,
        customerPhone: b.customer?.phone,
        requester: b.requester ?? {},
        locationDetails: b.locationDetails ?? {},
        vehicle: b.vehicle ?? {},
        slaMinutes,
      });
      if (b.clientId) {
        await db.query(`UPDATE connect_assistances SET "clientId" = $1 WHERE id = $2`, [Number(b.clientId), row.id]);
      }
      await auditConnect({ req, action: b.draft ? "assistance.draft_created" : "assistance.created", resourceType: "assistance", resourceId: row.id });
      res.status(201).json(row);
    } catch (e: any) {
      console.error("[Connect] bo crear asistencia:", e?.message);
      err(res, 500, "internal_error", "Error creando la asistencia");
    }
  });

  // Editar (solo en draft/pending: datos aún no enviados al proveedor)
  router.patch("/assistances/:id", ...requireConnectRole("operator"), async (req, res) => {
    const id = Number(req.params.id);
    const cur = await db.query(`SELECT status FROM connect_assistances WHERE id = $1`, [id]);
    if (!cur.rows[0]) return err(res, 404, "not_found", "Asistencia no encontrada");
    if (!["draft", "pending", "no_coverage", "assignment_failed"].includes(cur.rows[0].status)) {
      return err(res, 409, "invalid_state", "Solo se pueden editar asistencias en borrador o pendientes de asignación");
    }
    const b = req.body ?? {};
    const r = await db.query(
      `UPDATE connect_assistances SET
         "expedientNumber" = COALESCE($1, "expedientNumber"),
         "clientName" = COALESCE($2, "clientName"),
         "externalReference" = COALESCE($3, "externalReference"),
         priority = COALESCE($4, priority),
         "serviceType" = COALESCE($5, "serviceType"),
         description = COALESCE($6, description),
         latitude = COALESCE($7, latitude),
         longitude = COALESCE($8, longitude),
         address = COALESCE($9, address),
         "customerName" = COALESCE($10, "customerName"),
         "customerPhone" = COALESCE($11, "customerPhone"),
         requester = COALESCE($12, requester),
         "locationDetails" = COALESCE($13, "locationDetails"),
         vehicle = COALESCE($14, vehicle),
         "slaMinutes" = COALESCE($15, "slaMinutes"),
         "updatedAtMs" = $16
       WHERE id = $17 RETURNING *`,
      [
        b.expedientNumber ?? null, b.clientName ?? null, b.externalReference ?? null,
        b.priority ?? null, b.serviceType ?? null, b.description ?? null,
        typeof b.location?.lat === "number" ? b.location.lat : null,
        typeof b.location?.lng === "number" ? b.location.lng : null,
        b.address ?? null,
        b.customer?.name ?? null, b.customer?.phone ?? null,
        b.requester ? JSON.stringify(b.requester) : null,
        b.locationDetails ? JSON.stringify(b.locationDetails) : null,
        b.vehicle ? JSON.stringify(b.vehicle) : null,
        b.slaMinutes != null ? Number(b.slaMinutes) : null,
        Date.now(), id,
      ],
    );
    await auditConnect({ req, action: "assistance.updated", resourceType: "assistance", resourceId: id, detail: Object.keys(b) });
    res.json(r.rows[0]);
  });

  // Enviar borrador
  router.post("/assistances/:id/submit", ...requireConnectRole("operator"), async (req, res) => {
    const id = Number(req.params.id);
    try {
      await submitDraft(id);
      await auditConnect({ req, action: "assistance.submitted", resourceType: "assistance", resourceId: id });
      const r = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [id]);
      res.json(r.rows[0]);
    } catch (e: any) {
      if (e instanceof InvalidTransitionError) return err(res, 409, "invalid_state_transition", e.message);
      return err(res, 422, "validation_failed", e?.message || "No se pudo enviar el borrador");
    }
  });

  // Buscar y asignar proveedor automáticamente (la selección manual llega en S3)
  router.post("/assistances/:id/search-provider", ...requireConnectRole("operator"), async (req, res) => {
    const id = Number(req.params.id);
    try {
      await assignAssistance(id);
      await auditConnect({ req, action: "assistance.provider_search", resourceType: "assistance", resourceId: id });
      const r = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [id]);
      res.json(r.rows[0]);
    } catch (e: any) {
      return err(res, 409, "assignment_error", e?.message || "No se pudo buscar proveedor");
    }
  });

  // Comparador: candidatos ordenados con score y explicación
  router.get("/assistances/:id/candidates", ...requireConnectRole("operator"), async (req, res) => {
    const id = Number(req.params.id);
    const a = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [id]);
    if (!a.rows[0]) return err(res, 404, "not_found", "Asistencia no encontrada");
    if (a.rows[0].latitude == null || a.rows[0].longitude == null) {
      return err(res, 422, "no_coordinates", "La asistencia no tiene coordenadas; añádelas para buscar candidatos");
    }
    const excluded = await db.query(
      `SELECT DISTINCT "workshopId" FROM connect_assignments WHERE "assistanceId" = $1 AND status IN ('rejected','expired','withdrawn')`,
      [id],
    );
    const candidates = await findCandidates(
      a.rows[0].latitude, a.rows[0].longitude, a.rows[0].serviceType,
      excluded.rows.map((x) => x.workshopId),
    );
    res.json({ data: candidates });
  });

  // Historial de ofertas/asignaciones de la asistencia
  router.get("/assistances/:id/assignments", ...requireConnectRole("analyst"), async (req, res) => {
    const r = await db.query(
      `SELECT asg.*, w.name AS "workshopName", pc.name AS "providerName",
              rej."reasonCode", rej.comment AS "rejectionComment"
         FROM connect_assignments asg
         JOIN connect_workshops w ON w.id = asg."workshopId"
         LEFT JOIN connect_provider_companies pc ON pc.id = asg."providerCompanyId"
         LEFT JOIN connect_rejections rej ON rej."assignmentId" = asg.id
        WHERE asg."assistanceId" = $1 ORDER BY asg.id DESC`,
      [Number(req.params.id)],
    );
    res.json({ data: r.rows });
  });

  // Asignación manual a un taller (directa u oferta según autorización o forzado)
  router.post("/assistances/:id/assign", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    const id = Number(req.params.id);
    const workshopId = Number(req.body?.workshopId);
    const mode = req.body?.mode === "offer" ? "offer" : req.body?.mode === "direct" ? "direct" : "auto";
    if (!workshopId) return err(res, 422, "validation_failed", "workshopId es obligatorio");
    try {
      await offerToWorkshop(id, workshopId, { mode, byUserId: u.id, byName: u.name });
      await auditConnect({ req, action: "assistance.assigned_manual", resourceType: "assistance", resourceId: id, detail: { workshopId, mode } });
      const r = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [id]);
      res.json(r.rows[0]);
    } catch (e: any) {
      if (e instanceof InvalidTransitionError) return err(res, 409, "invalid_state_transition", e.message);
      return err(res, 409, "assignment_error", e?.message || "No se pudo asignar");
    }
  });

  // Aceptación telefónica / rechazo registrado por el operador
  router.post("/assignments/:id/accept", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    try {
      await acceptAssignment(Number(req.params.id), `${u.name} (aceptación telefónica)`);
      await auditConnect({ req, action: "assignment.accepted_by_operator", resourceType: "assignment", resourceId: Number(req.params.id) });
      res.json({ ok: true });
    } catch (e: any) { return err(res, 409, "assignment_error", e?.message); }
  });

  router.post("/assignments/:id/reject", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    const { reasonCode, comment } = req.body ?? {};
    if (!reasonCode) return err(res, 422, "validation_failed", "reasonCode es obligatorio");
    try {
      await rejectAssignment(Number(req.params.id), { reasonCode, comment, actorName: `${u.name} (en nombre del proveedor)` });
      await auditConnect({ req, action: "assignment.rejected_by_operator", resourceType: "assignment", resourceId: Number(req.params.id), detail: { reasonCode } });
      res.json({ ok: true });
    } catch (e: any) { return err(res, 409, "assignment_error", e?.message); }
  });

  // Reasignación
  router.post("/assistances/:id/reassign", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    const reason = String(req.body?.reason || "").trim();
    if (!reason) return err(res, 422, "validation_failed", "El motivo de la reasignación es obligatorio");
    try {
      await withdrawAndReassign(Number(req.params.id), reason, u.name);
      await auditConnect({ req, action: "assistance.reassigned", resourceType: "assistance", resourceId: Number(req.params.id), detail: { reason } });
      const r = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [Number(req.params.id)]);
      res.json(r.rows[0]);
    } catch (e: any) { return err(res, 409, "assignment_error", e?.message); }
  });

  // ── Portal del proveedor (rol provider_user) ──────────────

  router.get("/provider/offers", ...requireProviderUser(), async (req, res) => {
    const u = req.connectUser!;
    const r = await db.query(
      `SELECT asg.id, asg.status, asg."sentAtMs", asg."acceptDeadlineMs", asg.explanation,
              ca.id AS "assistanceId", ca."serviceType", ca.priority, ca.address,
              ca."customerName", ca.description, w.name AS "workshopName"
         FROM connect_assignments asg
         JOIN connect_assistances ca ON ca.id = asg."assistanceId"
         JOIN connect_workshops w ON w.id = asg."workshopId"
        WHERE ($1::int IS NULL OR asg."providerCompanyId" = $1)
        ORDER BY asg.id DESC LIMIT 100`,
      [u.role === "provider_user" ? u.providerCompanyId : null],
    );
    res.json({ data: r.rows });
  });

  router.post("/provider/offers/:id/accept", ...requireProviderUser(), async (req, res) => {
    const u = req.connectUser!;
    const asg = await db.query(`SELECT "providerCompanyId" FROM connect_assignments WHERE id = $1`, [Number(req.params.id)]);
    if (!asg.rows[0]) return err(res, 404, "not_found", "Oferta no encontrada");
    if (u.role === "provider_user" && asg.rows[0].providerCompanyId !== u.providerCompanyId) {
      return err(res, 403, "forbidden", "La oferta no pertenece a tu empresa");
    }
    try {
      await acceptAssignment(Number(req.params.id), u.name || u.email);
      await auditConnect({ req, action: "assignment.accepted_by_provider", resourceType: "assignment", resourceId: Number(req.params.id) });
      res.json({ ok: true });
    } catch (e: any) { return err(res, 409, "assignment_error", e?.message); }
  });

  router.post("/provider/offers/:id/reject", ...requireProviderUser(), async (req, res) => {
    const u = req.connectUser!;
    const { reasonCode, comment } = req.body ?? {};
    if (!reasonCode) return err(res, 422, "validation_failed", "El motivo de rechazo es obligatorio");
    const asg = await db.query(`SELECT "providerCompanyId" FROM connect_assignments WHERE id = $1`, [Number(req.params.id)]);
    if (!asg.rows[0]) return err(res, 404, "not_found", "Oferta no encontrada");
    if (u.role === "provider_user" && asg.rows[0].providerCompanyId !== u.providerCompanyId) {
      return err(res, 403, "forbidden", "La oferta no pertenece a tu empresa");
    }
    try {
      await rejectAssignment(Number(req.params.id), { reasonCode, comment, actorName: u.name || u.email });
      await auditConnect({ req, action: "assignment.rejected_by_provider", resourceType: "assignment", resourceId: Number(req.params.id), detail: { reasonCode } });
      res.json({ ok: true });
    } catch (e: any) { return err(res, 409, "assignment_error", e?.message); }
  });

  // Cancelar
  router.post("/assistances/:id/cancel", ...requireConnectRole("operator"), async (req, res) => {
    const id = Number(req.params.id);
    const reason = String(req.body?.reason || "").trim();
    if (!reason) return err(res, 422, "validation_failed", "El motivo de cancelación es obligatorio");
    const cur = await db.query(`SELECT status, "coreAssistanceId" FROM connect_assistances WHERE id = $1`, [id]);
    if (!cur.rows[0]) return err(res, 404, "not_found", "Asistencia no encontrada");
    try {
      await transition(id, "cancelled", "user", reason);
      await db.query(`UPDATE connect_assistances SET "cancelReason" = $1 WHERE id = $2`, [reason, id]);
      if (cur.rows[0].coreAssistanceId) {
        const now = Date.now();
        await db.query(
          `UPDATE roadside_assistances SET status = 'cancelada', "cancelledAtMs" = $1, "updatedAtMs" = $1 WHERE id = $2 AND status <> 'finalizada'`,
          [now, cur.rows[0].coreAssistanceId],
        );
        await db.query(
          `INSERT INTO roadside_assistance_events ("assistanceId", status, note, "createdBy", "createdAtMs")
           VALUES ($1, 'cancelada', $2, 'connect-pro', $3)`,
          [cur.rows[0].coreAssistanceId, reason, now],
        );
      }
      await auditConnect({ req, action: "assistance.cancelled", resourceType: "assistance", resourceId: id, detail: { reason } });
      const r = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [id]);
      res.json(r.rows[0]);
    } catch (e: any) {
      if (e instanceof InvalidTransitionError) return err(res, 409, "invalid_state_transition", e.message);
      throw e;
    }
  });

  // ── Autorizaciones centro ↔ empresa ───────────────────────

  router.get("/authorizations", ...requireConnectRole("analyst"), async (req, res) => {
    const u = req.connectUser!;
    const r = await db.query(
      `SELECT a.*, pc.name AS "providerName", b.name AS "branchName"
         FROM connect_provider_authorizations a
         JOIN connect_provider_companies pc ON pc.id = a."providerCompanyId"
         LEFT JOIN connect_branches b ON b.id = a."branchId"
        WHERE ($1::int IS NULL OR a."controlCenterId" = $1)
        ORDER BY pc.name`,
      [u.role === "superadmin" ? null : u.controlCenterId],
    );
    res.json({ data: r.rows });
  });

  router.post("/authorizations", ...requireConnectRole("cc_admin"), async (req, res) => {
    const u = req.connectUser!;
    const { providerCompanyId, branchId, serviceTypes, preferred, slaAcceptMin, slaArrivalMin, maxConcurrent } = req.body ?? {};
    if (!providerCompanyId) return err(res, 422, "validation_failed", "providerCompanyId es obligatorio");
    const now = Date.now();
    const r = await db.query(
      `INSERT INTO connect_provider_authorizations
         ("controlCenterId", "providerCompanyId", "branchId", "serviceTypes", preferred,
          "slaAcceptMin", "slaArrivalMin", "maxConcurrent", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       ON CONFLICT ("controlCenterId", "providerCompanyId", "branchId")
       DO UPDATE SET status = 'active', "serviceTypes" = EXCLUDED."serviceTypes",
                     preferred = EXCLUDED.preferred, "updatedAtMs" = EXCLUDED."updatedAtMs"
       RETURNING *`,
      [
        u.controlCenterId, Number(providerCompanyId), branchId ?? null,
        JSON.stringify(Array.isArray(serviceTypes) ? serviceTypes : []),
        preferred === true, slaAcceptMin ?? null, slaArrivalMin ?? null, maxConcurrent ?? null, now,
      ],
    );
    await auditConnect({ req, action: "authorization.upserted", resourceType: "authorization", resourceId: r.rows[0].id });
    res.status(201).json(r.rows[0]);
  });

  router.patch("/authorizations/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    const { status, preferred, excluded, requiresAcceptance, acceptTimeoutMin } = req.body ?? {};
    const r = await db.query(
      `UPDATE connect_provider_authorizations
          SET status = COALESCE($1, status), preferred = COALESCE($2, preferred),
              excluded = COALESCE($3, excluded),
              "requiresAcceptance" = COALESCE($4, "requiresAcceptance"),
              "acceptTimeoutMin" = COALESCE($5, "acceptTimeoutMin"), "updatedAtMs" = $6
        WHERE id = $7 RETURNING *`,
      [status ?? null, preferred ?? null, excluded ?? null, requiresAcceptance ?? null,
       acceptTimeoutMin != null ? Number(acceptTimeoutMin) : null, Date.now(), Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Autorización no encontrada");
    await auditConnect({ req, action: "authorization.updated", resourceType: "authorization", resourceId: r.rows[0].id, detail: req.body });
    res.json(r.rows[0]);
  });

  // ── Usuarios ──────────────────────────────────────────────

  router.get("/users", ...requireConnectRole("cc_admin"), async (req, res) => {
    const u = req.connectUser!;
    const r = await db.query(
      `SELECT id, "controlCenterId", email, name, role, "providerCompanyId", active, "createdAtMs"
         FROM connect_users
        WHERE $1::int IS NULL OR "controlCenterId" = $1
        ORDER BY name, email`,
      [u.role === "superadmin" ? null : u.controlCenterId],
    );
    res.json({ data: r.rows });
  });

  router.post("/users", ...requireConnectRole("cc_admin"), async (req, res) => {
    const u = req.connectUser!;
    const { email, name, role, providerCompanyId } = req.body ?? {};
    const validRoles = ["cc_admin", "supervisor", "operator", "analyst", "provider_user"];
    if (!email?.trim() || !validRoles.includes(role)) {
      return err(res, 422, "validation_failed", `email y role (${validRoles.join(", ")}) son obligatorios`);
    }
    if (role === "provider_user" && !providerCompanyId) {
      return err(res, 422, "validation_failed", "provider_user requiere providerCompanyId");
    }
    const now = Date.now();
    try {
      const r = await db.query(
        `INSERT INTO connect_users ("controlCenterId", email, name, role, "providerCompanyId", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id, email, name, role, "providerCompanyId", active`,
        [u.controlCenterId, email.trim().toLowerCase(), name ?? "", role, providerCompanyId ?? null, now],
      );
      await auditConnect({ req, action: "user.created", resourceType: "user", resourceId: r.rows[0].id, detail: { email, role } });
      res.status(201).json(r.rows[0]);
    } catch (e: any) {
      if (String(e?.message).includes("unique") || String(e?.code) === "23505") {
        return err(res, 409, "duplicate", "Ya existe un usuario con ese email");
      }
      throw e;
    }
  });

  router.patch("/users/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    const { role, active, name } = req.body ?? {};
    const r = await db.query(
      `UPDATE connect_users
          SET role = COALESCE($1, role), active = COALESCE($2, active), name = COALESCE($3, name), "updatedAtMs" = $4
        WHERE id = $5 AND role <> 'superadmin' RETURNING id, email, name, role, active`,
      [role ?? null, active ?? null, name ?? null, Date.now(), Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Usuario no encontrado (o es superadmin)");
    await auditConnect({ req, action: "user.updated", resourceType: "user", resourceId: r.rows[0].id, detail: req.body });
    res.json(r.rows[0]);
  });

  // ── Clientes y tarifas (Fase 2 S2) ────────────────────────

  router.get("/clients", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    const r = await db.query(
      `SELECT * FROM connect_clients WHERE $1::int IS NULL OR "controlCenterId" = $1 ORDER BY name`,
      [u.role === "superadmin" ? null : u.controlCenterId],
    );
    res.json({ data: r.rows });
  });

  router.post("/clients", ...requireConnectRole("cc_admin"), async (req, res) => {
    const u = req.connectUser!;
    const b = req.body ?? {};
    if (!b.name?.trim()) return err(res, 422, "validation_failed", "El nombre es obligatorio");
    const now = Date.now();
    const r = await db.query(
      `INSERT INTO connect_clients ("controlCenterId", name, "taxId", "contactEmail", "contactPhone",
         "defaultSlaMinutes", "defaultPriority", notes, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
      [
        u.controlCenterId, b.name.trim(), b.taxId ?? null, b.contactEmail ?? null, b.contactPhone ?? null,
        b.defaultSlaMinutes != null ? Number(b.defaultSlaMinutes) : null,
        b.defaultPriority === "urgente" ? "urgente" : "normal", b.notes ?? null, now,
      ],
    );
    await auditConnect({ req, action: "client.created", resourceType: "client", resourceId: r.rows[0].id });
    res.status(201).json(r.rows[0]);
  });

  router.patch("/clients/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    const b = req.body ?? {};
    const r = await db.query(
      `UPDATE connect_clients SET
         name = COALESCE($1, name), "contactEmail" = COALESCE($2, "contactEmail"),
         "contactPhone" = COALESCE($3, "contactPhone"),
         "defaultSlaMinutes" = COALESCE($4, "defaultSlaMinutes"),
         "defaultPriority" = COALESCE($5, "defaultPriority"),
         active = COALESCE($6, active), notes = COALESCE($7, notes), "updatedAtMs" = $8
       WHERE id = $9 RETURNING *`,
      [b.name ?? null, b.contactEmail ?? null, b.contactPhone ?? null,
       b.defaultSlaMinutes != null ? Number(b.defaultSlaMinutes) : null,
       b.defaultPriority ?? null, b.active ?? null, b.notes ?? null, Date.now(), Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Cliente no encontrado");
    await auditConnect({ req, action: "client.updated", resourceType: "client", resourceId: Number(req.params.id), detail: b });
    res.json(r.rows[0]);
  });

  router.get("/authorizations/:id/tariffs", ...requireConnectRole("analyst"), async (req, res) => {
    const r = await db.query(
      `SELECT * FROM connect_tariff_lines WHERE "authorizationId" = $1 ORDER BY "serviceTypeCode"`,
      [Number(req.params.id)],
    );
    res.json({ data: r.rows });
  });

  router.put("/authorizations/:id/tariffs/:code", ...requireConnectRole("cc_admin"), async (req, res) => {
    const { baseAmount, perKmAmount, active } = req.body ?? {};
    const r = await db.query(
      `INSERT INTO connect_tariff_lines ("authorizationId", "serviceTypeCode", "baseAmount", "perKmAmount", active, "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT ("authorizationId", "serviceTypeCode")
       DO UPDATE SET "baseAmount" = EXCLUDED."baseAmount", "perKmAmount" = EXCLUDED."perKmAmount",
                     active = EXCLUDED.active, "updatedAtMs" = EXCLUDED."updatedAtMs"
       RETURNING *`,
      [Number(req.params.id), String(req.params.code), Number(baseAmount) || 0, Number(perKmAmount) || 0,
       active !== false, Date.now()],
    );
    await auditConnect({ req, action: "tariff.upserted", resourceType: "authorization", resourceId: Number(req.params.id), detail: req.body });
    res.json(r.rows[0]);
  });

  // Coste final de la asistencia (cierre administrativo)
  router.patch("/assistances/:id/costs", ...requireConnectRole("operator"), async (req, res) => {
    const { finalCost } = req.body ?? {};
    if (finalCost == null || Number.isNaN(Number(finalCost))) {
      return err(res, 422, "validation_failed", "finalCost numérico es obligatorio");
    }
    const r = await db.query(
      `UPDATE connect_assistances SET "finalCost" = $1, "updatedAtMs" = $2 WHERE id = $3 RETURNING *`,
      [Number(finalCost), Date.now(), Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Asistencia no encontrada");
    await auditConnect({ req, action: "assistance.cost_set", resourceType: "assistance", resourceId: Number(req.params.id), detail: { finalCost } });
    res.json(r.rows[0]);
  });

  // ── Unidades móviles (Fase 3) ─────────────────────────────

  router.get("/mobile-units", ...requireConnectRole("operator"), async (_req, res) => {
    const r = await db.query(
      `SELECT mu.*, pc.name AS "providerName", ca."expedientNumber"
         FROM connect_mobile_units mu
         LEFT JOIN connect_provider_companies pc ON pc.id = mu."providerCompanyId"
         LEFT JOIN connect_assistances ca ON ca.id = mu."activeAssistanceId"
        ORDER BY mu.name`,
    );
    res.json({ data: r.rows });
  });

  router.get("/mobile-units/:id/events", ...requireConnectRole("operator"), async (req, res) => {
    const r = await db.query(
      `SELECT * FROM connect_mobile_unit_events WHERE "unitId" = $1 ORDER BY id DESC LIMIT 100`,
      [Number(req.params.id)],
    );
    res.json({ data: r.rows });
  });

  // El taller decide qué unidades comparte con Central (auditable: quién y cuándo)
  router.patch("/mobile-units/:id/share", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    const shared = req.body?.shared;
    if (typeof shared !== "boolean") return err(res, 422, "validation_failed", "shared (boolean) es obligatorio");
    const r = await db.query(
      `UPDATE connect_mobile_units
          SET "sharedWithCentral" = $1, "sharedChangedBy" = $2, "sharedChangedAtMs" = $3, "updatedAtMs" = $3
        WHERE id = $4 RETURNING *`,
      [shared, u.name, Date.now(), Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Unidad no encontrada");
    await auditConnect({
      req, action: shared ? "mobile_unit.shared_with_central" : "mobile_unit.removed_from_central",
      resourceType: "mobile_unit", resourceId: Number(req.params.id),
    });
    res.json(r.rows[0]);
  });

  router.patch("/mobile-units/:id/status", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    const { status, reason } = req.body ?? {};
    if (status && !reason?.trim()) {
      return err(res, 422, "validation_failed", "El motivo es obligatorio al fijar un estado manual");
    }
    try {
      await setManualStatus(Number(req.params.id), status ?? null, reason ?? null, u.name);
      await auditConnect({ req, action: "mobile_unit.status_set", resourceType: "mobile_unit", resourceId: Number(req.params.id), detail: { status, reason } });
      const r = await db.query(`SELECT * FROM connect_mobile_units WHERE id = $1`, [Number(req.params.id)]);
      res.json(r.rows[0]);
    } catch (e: any) {
      return err(res, 422, "validation_failed", e?.message);
    }
  });

  // ── Informes (por periodo, formato genérico columnas+filas) ──

  router.get("/reports/:kind", ...requireConnectRole("analyst"), async (req, res) => {
    const from = Number(req.query.from) || new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const to = Number(req.query.to) || Date.now();
    const kind = String(req.params.kind);
    const fmtMs = (v: unknown) => (v ? new Date(Number(v)).toISOString().replace("T", " ").slice(0, 16) : "");
    const min = (v: unknown) => (v != null ? Math.round(Number(v)) : "");

    if (kind === "actividad") {
      const r = await db.query(
        `SELECT ca.id, ca."expedientNumber", ca."createdAtMs",
                COALESCE(cl.name, ca."clientName", p.name) AS client,
                COALESCE(pc.name, w.name) AS provider,
                ca."serviceType", ca.priority, ca.status, ca.origin,
                acc.min AS accept_min, arr.min AS arrival_min, fin.min AS resolution_min
           FROM connect_assistances ca
           LEFT JOIN connect_clients cl ON cl.id = ca."clientId"
           LEFT JOIN connect_partners p ON p.id = ca."partnerId"
           LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
           LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
           LEFT JOIN LATERAL (SELECT (h2."occurredAtMs" - h1."occurredAtMs")/60000.0 AS min
              FROM connect_status_history h1 JOIN connect_status_history h2
                ON h1."assistanceId" = h2."assistanceId"
             WHERE h1."assistanceId" = ca.id AND h1."toStatus" = 'pending' AND h2."toStatus" = 'assigned' LIMIT 1) acc ON true
           LEFT JOIN LATERAL (SELECT (h2."occurredAtMs" - h1."occurredAtMs")/60000.0 AS min
              FROM connect_status_history h1 JOIN connect_status_history h2
                ON h1."assistanceId" = h2."assistanceId"
             WHERE h1."assistanceId" = ca.id AND h1."toStatus" = 'assigned' AND h2."toStatus" = 'arrived' LIMIT 1) arr ON true
           LEFT JOIN LATERAL (SELECT (h2."occurredAtMs" - h1."occurredAtMs")/60000.0 AS min
              FROM connect_status_history h1 JOIN connect_status_history h2
                ON h1."assistanceId" = h2."assistanceId"
             WHERE h1."assistanceId" = ca.id AND h1."toStatus" = 'arrived' AND h2."toStatus" = 'finished' LIMIT 1) fin ON true
          WHERE ca."createdAtMs" BETWEEN $1 AND $2 AND ca.status <> 'draft'
          ORDER BY ca.id`,
        [from, to],
      );
      return res.json({
        title: "Actividad de asistencias",
        columns: ["ID", "Expediente", "Fecha", "Cliente", "Proveedor", "Servicio", "Prioridad", "Estado", "Origen", "Min. asignación", "Min. llegada", "Min. resolución"],
        rows: r.rows.map((x) => [x.id, x.expedientNumber ?? "", fmtMs(x.createdAtMs), x.client ?? "", x.provider ?? "",
          x.serviceType, x.priority, x.status, x.origin, min(x.accept_min), min(x.arrival_min), min(x.resolution_min)]),
      });
    }

    if (kind === "sla") {
      const r = await db.query(
        `SELECT ca.id, ca."expedientNumber", ca."createdAtMs", ca."slaMinutes", ca."slaDeadlineAtMs",
                COALESCE(cl.name, ca."clientName") AS client, w.name AS workshop, ca.status,
                arr."occurredAtMs" AS arrived_at
           FROM connect_assistances ca
           LEFT JOIN connect_clients cl ON cl.id = ca."clientId"
           LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
           LEFT JOIN LATERAL (SELECT "occurredAtMs" FROM connect_status_history
             WHERE "assistanceId" = ca.id AND "toStatus" = 'arrived' ORDER BY id LIMIT 1) arr ON true
          WHERE ca."createdAtMs" BETWEEN $1 AND $2 AND ca."slaDeadlineAtMs" IS NOT NULL
          ORDER BY ca.id`,
        [from, to],
      );
      return res.json({
        title: "Cumplimiento de SLA",
        columns: ["ID", "Expediente", "Fecha", "Cliente", "Taller", "SLA (min)", "Límite", "Llegada", "Resultado", "Desvío (min)"],
        rows: r.rows.map((x) => {
          const arrived = x.arrived_at ? Number(x.arrived_at) : null;
          const deadline = Number(x.slaDeadlineAtMs);
          const result = arrived == null
            ? (x.status === "cancelled" ? "cancelada" : Date.now() > deadline ? "incumplido (sin llegada)" : "en curso")
            : arrived <= deadline ? "cumplido" : "incumplido";
          const dev = arrived != null ? Math.round((arrived - deadline) / 60000) : "";
          return [x.id, x.expedientNumber ?? "", fmtMs(x.createdAtMs), x.client ?? "", x.workshop ?? "",
            x.slaMinutes ?? "", fmtMs(deadline), fmtMs(arrived), result, dev];
        }),
      });
    }

    if (kind === "rechazos") {
      const r = await db.query(
        `SELECT rj."createdAtMs", rj."reasonCode", rr.label, rj.comment, rj."responseMs",
                rj."rejectedBy", w.name AS workshop, rj."assistanceId"
           FROM connect_rejections rj
           LEFT JOIN connect_rejection_reasons rr ON rr.code = rj."reasonCode"
           LEFT JOIN connect_workshops w ON w.id = rj."workshopId"
          WHERE rj."createdAtMs" BETWEEN $1 AND $2 ORDER BY rj.id`,
        [from, to],
      );
      return res.json({
        title: "Rechazos de ofertas",
        columns: ["Fecha", "Asistencia", "Taller", "Motivo", "Comentario", "Respondió en (min)", "Por"],
        rows: r.rows.map((x) => [fmtMs(x.createdAtMs), x.assistanceId, x.workshop ?? "",
          x.label ?? x.reasonCode, x.comment ?? "", min(Number(x.responseMs) / 60000), x.rejectedBy ?? ""]),
      });
    }

    if (kind === "incidencias") {
      const r = await db.query(
        `SELECT i.*, pc.name AS provider, u.name AS owner
           FROM connect_incidents i
           LEFT JOIN connect_provider_companies pc ON pc.id = i."providerCompanyId"
           LEFT JOIN connect_users u ON u.id = i."ownerUserId"
          WHERE i."createdAtMs" BETWEEN $1 AND $2 ORDER BY i.id`,
        [from, to],
      );
      return res.json({
        title: "Incidencias",
        columns: ["ID", "Fecha", "Tipo", "Gravedad", "Estado", "Asistencia", "Proveedor", "Responsable", "Descripción", "Resolución", "Resuelta"],
        rows: r.rows.map((x) => [x.id, fmtMs(x.createdAtMs), x.type, x.severity, x.status,
          x.assistanceId ?? "", x.provider ?? "", x.owner ?? "", x.description, x.resolution ?? "", fmtMs(x.resolvedAtMs)]),
      });
    }

    if (kind === "proveedores") {
      const r = await db.query(
        `SELECT w.name AS workshop, pc.name AS provider, w."currentScore",
                COUNT(*) FILTER (WHERE asg."sentAtMs" BETWEEN $1 AND $2)::int AS offered,
                COUNT(*) FILTER (WHERE asg."sentAtMs" BETWEEN $1 AND $2 AND asg.status = 'accepted')::int AS accepted,
                COUNT(*) FILTER (WHERE asg."sentAtMs" BETWEEN $1 AND $2 AND asg.status IN ('rejected','expired'))::int AS declined,
                (SELECT COUNT(*)::int FROM connect_assistances ca WHERE ca."workshopId" = w.id
                   AND ca."createdAtMs" BETWEEN $1 AND $2 AND ca.status = 'finished') AS finished,
                (SELECT COALESCE(SUM(COALESCE(ca."finalCost", ca."estimatedCost")), 0) FROM connect_assistances ca
                  WHERE ca."workshopId" = w.id AND ca."createdAtMs" BETWEEN $1 AND $2 AND ca.status = 'finished') AS revenue
           FROM connect_workshops w
           LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
           LEFT JOIN connect_assignments asg ON asg."workshopId" = w.id
          GROUP BY w.id, pc.name ORDER BY w.name`,
        [from, to],
      );
      return res.json({
        title: "Rendimiento de proveedores",
        columns: ["Taller", "Empresa", "Score", "Ofertadas", "Aceptadas", "Rechazadas/exp.", "Finalizadas", "Importe (€)"],
        rows: r.rows.map((x) => [x.workshop, x.provider ?? "", Math.round(x.currentScore),
          x.offered, x.accepted, x.declined, x.finished, Number(x.revenue).toFixed(2)]),
      });
    }

    return err(res, 404, "not_found", "Informe no disponible. Tipos: actividad, sla, rechazos, incidencias, proveedores");
  });

  // ── Facturación (Fase 2 S3) ───────────────────────────────

  router.get("/billing/summary", ...requireConnectRole("cc_admin"), async (req, res) => {
    const from = Number(req.query.from) || new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const to = Number(req.query.to) || Date.now();
    const [byClient, byProvider, totals] = await Promise.all([
      db.query(
        `SELECT COALESCE(c.name, ca."clientName", p.name, 'Sin cliente') AS name,
                COUNT(*)::int AS services,
                COALESCE(SUM(COALESCE(ca."finalCost", ca."estimatedCost")), 0) AS amount,
                COUNT(*) FILTER (WHERE ca."invoicedAtMs" IS NOT NULL)::int AS invoiced
           FROM connect_assistances ca
           LEFT JOIN connect_clients c ON c.id = ca."clientId"
           LEFT JOIN connect_partners p ON p.id = ca."partnerId"
          WHERE ca.status = 'finished' AND ca."createdAtMs" BETWEEN $1 AND $2
          GROUP BY 1 ORDER BY amount DESC`,
        [from, to],
      ),
      db.query(
        `SELECT COALESCE(pc.name, w.name, 'Sin proveedor') AS name,
                COUNT(*)::int AS services,
                COALESCE(SUM(COALESCE(ca."finalCost", ca."estimatedCost")), 0) AS amount,
                COUNT(*) FILTER (WHERE ca."invoicedAtMs" IS NOT NULL)::int AS invoiced
           FROM connect_assistances ca
           LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
           LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
          WHERE ca.status = 'finished' AND ca."createdAtMs" BETWEEN $1 AND $2
          GROUP BY 1 ORDER BY amount DESC`,
        [from, to],
      ),
      db.query(
        `SELECT COUNT(*)::int AS services,
                COALESCE(SUM(COALESCE("finalCost", "estimatedCost")), 0) AS amount,
                COUNT(*) FILTER (WHERE "finalCost" IS NULL)::int AS without_final,
                COUNT(*) FILTER (WHERE "invoicedAtMs" IS NULL)::int AS pending_invoice
           FROM connect_assistances
          WHERE status = 'finished' AND "createdAtMs" BETWEEN $1 AND $2`,
        [from, to],
      ),
    ]);
    res.json({ from, to, totals: totals.rows[0], by_client: byClient.rows, by_provider: byProvider.rows });
  });

  router.get("/billing/lines", ...requireConnectRole("cc_admin"), async (req, res) => {
    const from = Number(req.query.from) || new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const to = Number(req.query.to) || Date.now();
    const r = await db.query(
      `SELECT ca.id, ca."expedientNumber", ca."externalReference", ca."serviceType", ca."createdAtMs",
              COALESCE(c.name, ca."clientName", p.name) AS "clientName",
              COALESCE(pc.name, w.name) AS "providerName",
              ca."customerName", ca."estimatedCost", ca."finalCost", ca."costCurrency", ca."invoicedAtMs"
         FROM connect_assistances ca
         LEFT JOIN connect_clients c ON c.id = ca."clientId"
         LEFT JOIN connect_partners p ON p.id = ca."partnerId"
         LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
         LEFT JOIN connect_provider_companies pc ON pc.id = w."providerCompanyId"
        WHERE ca.status = 'finished' AND ca."createdAtMs" BETWEEN $1 AND $2
        ORDER BY ca.id DESC LIMIT 1000`,
      [from, to],
    );
    res.json({ data: r.rows, from, to });
  });

  router.post("/billing/mark-invoiced", ...requireConnectRole("cc_admin"), async (req, res) => {
    const ids: number[] = Array.isArray(req.body?.assistanceIds) ? req.body.assistanceIds.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return err(res, 422, "validation_failed", "assistanceIds es obligatorio");
    const r = await db.query(
      `UPDATE connect_assistances SET "invoicedAtMs" = $1
        WHERE id = ANY($2::int[]) AND status = 'finished' AND "invoicedAtMs" IS NULL
        RETURNING id`,
      [Date.now(), ids],
    );
    await auditConnect({ req, action: "billing.marked_invoiced", detail: { count: r.rows.length, ids: r.rows.map((x) => x.id) } });
    res.json({ marked: r.rows.length });
  });

  // ── Incidencias (Sprint 5) ────────────────────────────────

  const INCIDENT_TYPES = [
    "delay", "no_response", "rejection", "wrong_data", "customer_not_found", "tech_not_found",
    "unit_breakdown", "access_problem", "not_feasible", "incomplete_service", "incomplete_docs",
    "insufficient_photos", "complaint", "damages", "tariff_conflict", "duplicate",
    "integration_error", "other",
  ];
  const INCIDENT_STATUSES = ["open", "investigating", "pending_provider", "pending_client", "escalated", "resolved", "closed"];

  router.get("/incidents", ...requireConnectRole("operator"), async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const severity = req.query.severity ? String(req.query.severity) : null;
    const assistanceId = req.query.assistanceId ? Number(req.query.assistanceId) : null;
    const r = await db.query(
      `SELECT i.*, ca.uuid AS "assistanceUuid", ca."customerName", ca."expedientNumber",
              pc.name AS "providerName", u.name AS "ownerName", cu.name AS "createdByName"
         FROM connect_incidents i
         LEFT JOIN connect_assistances ca ON ca.id = i."assistanceId"
         LEFT JOIN connect_provider_companies pc ON pc.id = i."providerCompanyId"
         LEFT JOIN connect_users u ON u.id = i."ownerUserId"
         LEFT JOIN connect_users cu ON cu.id = i."createdByUserId"
        WHERE ($1::text IS NULL OR i.status = $1)
          AND ($2::text IS NULL OR i.severity = $2)
          AND ($3::int IS NULL OR i."assistanceId" = $3)
        ORDER BY i.status IN ('resolved','closed'), i.severity = 'critical' DESC, i."dueAtMs" NULLS LAST, i.id DESC
        LIMIT 300`,
      [status, severity, assistanceId],
    );
    res.json({ data: r.rows, types: INCIDENT_TYPES, statuses: INCIDENT_STATUSES });
  });

  router.post("/incidents", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    const b = req.body ?? {};
    if (!INCIDENT_TYPES.includes(b.type)) return err(res, 422, "validation_failed", "Tipo de incidencia no válido");
    if (!b.description?.trim()) return err(res, 422, "validation_failed", "La descripción es obligatoria");
    const now = Date.now();
    // Si va ligada a una asistencia, hereda proveedor/taller
    let providerCompanyId = b.providerCompanyId ?? null;
    let workshopId = null;
    if (b.assistanceId) {
      const a = await db.query(
        `SELECT ca."workshopId", w."providerCompanyId" FROM connect_assistances ca
          LEFT JOIN connect_workshops w ON w.id = ca."workshopId" WHERE ca.id = $1`,
        [Number(b.assistanceId)],
      );
      if (!a.rows[0]) return err(res, 404, "not_found", "Asistencia no encontrada");
      workshopId = a.rows[0].workshopId;
      providerCompanyId = providerCompanyId ?? a.rows[0].providerCompanyId;
    }
    const r = await db.query(
      `INSERT INTO connect_incidents
         ("controlCenterId", "assistanceId", "providerCompanyId", "workshopId", type, severity,
          "ownerUserId", description, "dueAtMs", "slaImpact", "scoreImpact", "createdByUserId",
          "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
      [
        u.controlCenterId, b.assistanceId ?? null, providerCompanyId, workshopId,
        b.type, ["low","medium","high","critical"].includes(b.severity) ? b.severity : "medium",
        b.ownerUserId ?? u.id, b.description.trim(), b.dueAtMs ?? null,
        b.slaImpact === true, b.scoreImpact === true, u.id, now,
      ],
    );
    await db.query(
      `INSERT INTO connect_incident_events ("incidentId", action, "byUserId", "byName", "createdAtMs")
       VALUES ($1, 'created', $2, $3, $4)`,
      [r.rows[0].id, u.id, u.name, now],
    );
    await auditConnect({ req, action: "incident.created", resourceType: "incident", resourceId: r.rows[0].id, detail: { type: b.type } });
    if (r.rows[0].severity === "critical") {
      await createAlert({
        type: "incident_critical", severity: "critical",
        title: `Incidencia crítica #${r.rows[0].id}: ${b.type}`,
        body: b.description?.slice(0, 200),
        assistanceId: b.assistanceId ?? null, workshopId, incidentId: r.rows[0].id,
      });
    }
    res.status(201).json(r.rows[0]);
  });

  router.patch("/incidents/:id", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    const id = Number(req.params.id);
    const b = req.body ?? {};
    if (b.status && !INCIDENT_STATUSES.includes(b.status)) return err(res, 422, "validation_failed", "Estado no válido");
    if ((b.status === "resolved" || b.status === "closed") && !b.resolution && !(await db.query(`SELECT resolution FROM connect_incidents WHERE id=$1`, [id])).rows[0]?.resolution) {
      return err(res, 422, "validation_failed", "Indica la resolución antes de resolver/cerrar");
    }
    const now = Date.now();
    const r = await db.query(
      `UPDATE connect_incidents SET
         status = COALESCE($1, status), severity = COALESCE($2, severity),
         "ownerUserId" = COALESCE($3, "ownerUserId"), resolution = COALESCE($4, resolution),
         "dueAtMs" = COALESCE($5, "dueAtMs"),
         "resolvedAtMs" = CASE WHEN $1 IN ('resolved','closed') THEN $6 ELSE "resolvedAtMs" END,
         "updatedAtMs" = $6
       WHERE id = $7 RETURNING *`,
      [b.status ?? null, b.severity ?? null, b.ownerUserId ?? null, b.resolution ?? null,
       b.dueAtMs ?? null, now, id],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Incidencia no encontrada");
    await db.query(
      `INSERT INTO connect_incident_events ("incidentId", action, note, "byUserId", "byName", "createdAtMs")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, b.status ? `status:${b.status}` : "updated", b.note ?? b.resolution ?? null, u.id, u.name, now],
    );
    await auditConnect({ req, action: "incident.updated", resourceType: "incident", resourceId: id, detail: b });
    res.json(r.rows[0]);
  });

  router.get("/incidents/:id/events", ...requireConnectRole("operator"), async (req, res) => {
    const r = await db.query(
      `SELECT * FROM connect_incident_events WHERE "incidentId" = $1 ORDER BY id`,
      [Number(req.params.id)],
    );
    res.json({ data: r.rows });
  });

  // ── Comunicaciones / notas de la asistencia ───────────────

  router.get("/assistances/:id/communications", ...requireConnectRole("analyst"), async (req, res) => {
    const r = await db.query(
      `SELECT * FROM connect_communications WHERE "assistanceId" = $1 ORDER BY id DESC LIMIT 200`,
      [Number(req.params.id)],
    );
    res.json({ data: r.rows });
  });

  router.post("/assistances/:id/communications", ...requireConnectRole("operator"), async (req, res) => {
    const u = req.connectUser!;
    const { channel, direction, toRef, body } = req.body ?? {};
    if (!body?.trim()) return err(res, 422, "validation_failed", "El texto es obligatorio");
    const r = await db.query(
      `INSERT INTO connect_communications ("assistanceId", channel, direction, "toRef", body, "byUserId", "byName", "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        Number(req.params.id),
        ["note","call","whatsapp","email"].includes(channel) ? channel : "note",
        ["internal","outbound","inbound"].includes(direction) ? direction : "internal",
        toRef ?? null, body.trim(), u.id, u.name, Date.now(),
      ],
    );
    res.status(201).json(r.rows[0]);
  });

  // ── Catálogos ─────────────────────────────────────────────

  router.get("/catalogs", ...requireConnectUser(), async (_req, res) => {
    const [types, reasons, vehicles] = await Promise.all([
      db.query(`SELECT * FROM connect_service_types ORDER BY "sortOrder"`),
      db.query(`SELECT * FROM connect_rejection_reasons ORDER BY "sortOrder"`),
      db.query(`SELECT * FROM connect_vehicle_types ORDER BY "sortOrder"`),
    ]);
    res.json({ service_types: types.rows, rejection_reasons: reasons.rows, vehicle_types: vehicles.rows });
  });

  // Tipos de vehículo (crear / renombrar / activar / eliminar)
  router.post("/catalogs/vehicle-types", ...requireConnectRole("cc_admin"), async (req, res) => {
    const { code, name } = req.body ?? {};
    if (!code?.trim() || !name?.trim()) return err(res, 422, "validation_failed", "code y name son obligatorios");
    const r = await db.query(
      `INSERT INTO connect_vehicle_types (code, name, "sortOrder")
       VALUES ($1, $2, (SELECT COALESCE(MAX("sortOrder"),0)+1 FROM connect_vehicle_types))
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = true RETURNING *`,
      [code.trim().toLowerCase().replace(/\s+/g, "_"), name.trim()],
    );
    await auditConnect({ req, action: "catalog.vehicle_type_upserted", detail: { code, name } });
    res.status(201).json(r.rows[0]);
  });

  router.patch("/catalogs/vehicle-types/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    const r = await db.query(
      `UPDATE connect_vehicle_types SET name = COALESCE($1, name), active = COALESCE($2, active) WHERE id = $3 RETURNING *`,
      [req.body?.name ?? null, req.body?.active ?? null, Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Tipo no encontrado");
    await auditConnect({ req, action: "catalog.vehicle_type_updated", detail: req.body });
    res.json(r.rows[0]);
  });

  router.delete("/catalogs/vehicle-types/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    const id = Number(req.params.id);
    const t = await db.query(`SELECT code FROM connect_vehicle_types WHERE id = $1`, [id]);
    if (!t.rows[0]) return err(res, 404, "not_found", "Tipo no encontrado");
    const used = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistances WHERE vehicle::json->>'type' = $1`,
      [t.rows[0].code],
    );
    if (used.rows[0].n > 0) {
      return err(res, 409, "in_use",
        `No se puede eliminar: usado en ${used.rows[0].n} asistencia(s). Desactívalo para que no se ofrezca más.`);
    }
    await db.query(`DELETE FROM connect_vehicle_types WHERE id = $1`, [id]);
    await auditConnect({ req, action: "catalog.vehicle_type_deleted", detail: { id, code: t.rows[0].code } });
    res.status(204).end();
  });

  // Edición de catálogos (cc_admin)
  router.post("/catalogs/service-types", ...requireConnectRole("cc_admin"), async (req, res) => {
    const { code, name } = req.body ?? {};
    if (!code?.trim() || !name?.trim()) return err(res, 422, "validation_failed", "code y name son obligatorios");
    const r = await db.query(
      `INSERT INTO connect_service_types (code, name, "sortOrder")
       VALUES ($1, $2, (SELECT COALESCE(MAX("sortOrder"),0)+1 FROM connect_service_types))
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = true RETURNING *`,
      [code.trim().toLowerCase().replace(/\s+/g, "_"), name.trim()],
    );
    await auditConnect({ req, action: "catalog.service_type_upserted", detail: { code, name } });
    res.status(201).json(r.rows[0]);
  });

  router.patch("/catalogs/service-types/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    const r = await db.query(
      `UPDATE connect_service_types SET name = COALESCE($1, name), active = COALESCE($2, active) WHERE id = $3 RETURNING *`,
      [req.body?.name ?? null, req.body?.active ?? null, Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Tipo no encontrado");
    await auditConnect({ req, action: "catalog.service_type_updated", detail: req.body });
    res.json(r.rows[0]);
  });

  router.delete("/catalogs/service-types/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    const id = Number(req.params.id);
    const t = await db.query(`SELECT code FROM connect_service_types WHERE id = $1`, [id]);
    if (!t.rows[0]) return err(res, 404, "not_found", "Tipo no encontrado");
    const used = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM connect_assistances WHERE "serviceType" = $1) AS assistances,
              (SELECT COUNT(*)::int FROM connect_tariff_lines WHERE "serviceTypeCode" = $1) AS tariffs`,
      [t.rows[0].code],
    );
    const u = used.rows[0];
    if (u.assistances > 0 || u.tariffs > 0) {
      return err(res, 409, "in_use",
        `No se puede eliminar: usado en ${u.assistances} asistencia(s) y ${u.tariffs} tarifa(s). Desactívalo para que no se ofrezca más.`);
    }
    await db.query(`DELETE FROM connect_service_types WHERE id = $1`, [id]);
    await auditConnect({ req, action: "catalog.service_type_deleted", detail: { id, code: t.rows[0].code } });
    res.status(204).end();
  });

  router.post("/catalogs/rejection-reasons", ...requireConnectRole("cc_admin"), async (req, res) => {
    const { code, label, affectsScoreDefault } = req.body ?? {};
    if (!code?.trim() || !label?.trim()) return err(res, 422, "validation_failed", "code y label son obligatorios");
    const r = await db.query(
      `INSERT INTO connect_rejection_reasons (code, label, "affectsScoreDefault", "sortOrder")
       VALUES ($1, $2, $3, (SELECT COALESCE(MAX("sortOrder"),0)+1 FROM connect_rejection_reasons))
       ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, active = true RETURNING *`,
      [code.trim().toLowerCase().replace(/\s+/g, "_"), label.trim(), affectsScoreDefault !== false],
    );
    await auditConnect({ req, action: "catalog.rejection_reason_upserted", detail: { code, label } });
    res.status(201).json(r.rows[0]);
  });

  router.patch("/catalogs/rejection-reasons/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    const r = await db.query(
      `UPDATE connect_rejection_reasons
          SET label = COALESCE($1, label), active = COALESCE($2, active),
              "affectsScoreDefault" = COALESCE($3, "affectsScoreDefault")
        WHERE id = $4 RETURNING *`,
      [req.body?.label ?? null, req.body?.active ?? null, req.body?.affectsScoreDefault ?? null, Number(req.params.id)],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Motivo no encontrado");
    await auditConnect({ req, action: "catalog.rejection_reason_updated", detail: req.body });
    res.json(r.rows[0]);
  });

  router.delete("/catalogs/rejection-reasons/:id", ...requireConnectRole("cc_admin"), async (req, res) => {
    const id = Number(req.params.id);
    const t = await db.query(`SELECT code FROM connect_rejection_reasons WHERE id = $1`, [id]);
    if (!t.rows[0]) return err(res, 404, "not_found", "Motivo no encontrado");
    const used = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_rejections WHERE "reasonCode" = $1`,
      [t.rows[0].code],
    );
    if (used.rows[0].n > 0) {
      return err(res, 409, "in_use",
        `No se puede eliminar: usado en ${used.rows[0].n} rechazo(s) históricos. Desactívalo para que no se ofrezca más.`);
    }
    await db.query(`DELETE FROM connect_rejection_reasons WHERE id = $1`, [id]);
    await auditConnect({ req, action: "catalog.rejection_reason_deleted", detail: { id, code: t.rows[0].code } });
    res.status(204).end();
  });

  // ── Auditoría ─────────────────────────────────────────────

  router.get("/audit", ...requireConnectRole("cc_admin"), async (req, res) => {
    const u = req.connectUser!;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const r = await db.query(
      `SELECT * FROM connect_audit_logs
        WHERE $1::int IS NULL OR "controlCenterId" = $1 OR "controlCenterId" IS NULL
        ORDER BY id DESC LIMIT $2`,
      [u.role === "superadmin" ? null : u.controlCenterId, limit],
    );
    res.json({ data: r.rows });
  });

  return router;
}
