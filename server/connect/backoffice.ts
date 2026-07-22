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

function err(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

export function createConnectBackofficeRouter(): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  // ── Sesión ────────────────────────────────────────────────

  router.get("/me", ...requireConnectRole("analyst"), async (req, res) => {
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
         ("coreWorkshopId", "providerCompanyId", "branchId", name, phone, latitude, longitude, "radiusKm", services, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
      [
        b.coreWorkshopId ?? null, b.providerCompanyId ?? null, b.branchId ?? null,
        b.name.trim(), b.phone ?? null, b.latitude, b.longitude, Number(b.radiusKm) || 60,
        JSON.stringify(Array.isArray(b.services) && b.services.length ? b.services : []),
        now,
      ],
    );
    await auditConnect({ req, action: "workshop.created", resourceType: "workshop", resourceId: r.rows[0].id });
    res.status(201).json(r.rows[0]);
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

  router.get("/assistances/:id/timeline", ...requireConnectRole("analyst"), async (req, res) => {
    const r = await db.query(
      `SELECT * FROM connect_status_history WHERE "assistanceId" = $1 ORDER BY id`,
      [Number(req.params.id)],
    );
    res.json({ data: r.rows });
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
    const { status, preferred, excluded } = req.body ?? {};
    const r = await db.query(
      `UPDATE connect_provider_authorizations
          SET status = COALESCE($1, status), preferred = COALESCE($2, preferred),
              excluded = COALESCE($3, excluded), "updatedAtMs" = $4
        WHERE id = $5 RETURNING *`,
      [status ?? null, preferred ?? null, excluded ?? null, Date.now(), Number(req.params.id)],
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

  // ── Catálogos ─────────────────────────────────────────────

  router.get("/catalogs", ...requireConnectRole("analyst"), async (_req, res) => {
    const [types, reasons] = await Promise.all([
      db.query(`SELECT * FROM connect_service_types ORDER BY "sortOrder"`),
      db.query(`SELECT * FROM connect_rejection_reasons ORDER BY "sortOrder"`),
    ]);
    res.json({ service_types: types.rows, rejection_reasons: reasons.rows });
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
