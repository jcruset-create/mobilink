/**
 * Mobilink Assist — módulo de licencias: API REST.
 *
 * Endpoints de administración (protegidos con el middleware de rol que se
 * inyecta desde server/index.ts) y un endpoint público de validación para
 * que las instalaciones cliente comprueben su licencia.
 */

import { Router } from "express";
import type { RequestHandler } from "express";
import crypto from "crypto";
import db from "../db.ts";
import {
  buildActivationKey,
  verifyActivationKey,
  normalizeLicenseRow,
  refreshLicenseStatus,
  logLicenseAction,
  expiryFromActivation,
  LICENSE_STATUSES,
} from "./service.ts";

function performedBy(req: any): string {
  return String(req.headers["x-user-name"] || "admin");
}

async function getLicenseOr404(id: number, res: any): Promise<any | null> {
  const r = await db.query(`SELECT * FROM licenses WHERE id = $1`, [id]);
  if (!r.rows.length) {
    res.status(404).json({ error: "Licencia no encontrada" });
    return null;
  }
  return r.rows[0];
}

export function createLicensesRouter(requireAdmin: RequestHandler): Router {
  const router = Router();

  // ── Validación pública (instalaciones cliente) ──
  router.post("/validate", async (req, res) => {
    try {
      const uuid = String(req.body?.uuid || "").trim();
      const key = String(req.body?.key || "").trim();
      if (!uuid || !key) return res.status(400).json({ valid: false, error: "uuid y key requeridos" });

      const r = await db.query(`SELECT * FROM licenses WHERE uuid = $1`, [uuid]);
      if (!r.rows.length) return res.status(404).json({ valid: false, error: "Licencia no encontrada" });
      if (!verifyActivationKey(uuid, key)) {
        await logLicenseAction(r.rows[0].id, "validate_failed", "clave incorrecta", null);
        return res.status(403).json({ valid: false, error: "Clave no válida" });
      }

      const lic = await refreshLicenseStatus(r.rows[0]);
      return res.json({
        valid: !lic.blocked,
        status: lic.status,
        expiresAtMs: lic.expiresAtMs,
        daysLeft: lic.daysLeft,
        graceDays: lic.graceDays,
        maxUsers: lic.maxUsers,
        maxDevices: lic.maxDevices,
        aiMonthlyLimit: lic.aiMonthlyLimit,
        modules: lic.modules,
      });
    } catch (error) {
      console.error("POST /api/licenses/validate error:", error);
      return res.status(500).json({ valid: false, error: "Error validando licencia" });
    }
  });

  // ── Listado con filtros y búsqueda ──
  router.get("/", requireAdmin, async (req, res) => {
    try {
      const status = String(req.query.status || "").trim();
      const q = String(req.query.q || "").trim();
      const params: any[] = [];
      const where: string[] = [];
      if (status && (LICENSE_STATUSES as readonly string[]).includes(status)) {
        params.push(status);
        where.push(`status = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        where.push(`("customerName" ILIKE $${params.length} OR "companyName" ILIKE $${params.length} OR uuid ILIKE $${params.length} OR plan ILIKE $${params.length})`);
      }
      const r = await db.query(
        `SELECT * FROM licenses ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY "createdAtMs" DESC LIMIT 500`,
        params
      );
      const rows = [];
      for (const row of r.rows) rows.push(await refreshLicenseStatus(row));
      return res.json(rows);
    } catch (error) {
      console.error("GET /api/licenses error:", error);
      return res.status(500).json({ error: "Error obteniendo licencias" });
    }
  });

  // ── Crear (estado pending, clave firmada) ──
  router.post("/", requireAdmin, async (req, res) => {
    try {
      const b = req.body ?? {};
      const customerName = String(b.customerName || "").trim();
      if (!customerName) return res.status(400).json({ error: "customerName requerido" });

      const uuid = crypto.randomUUID();
      const now = Date.now();
      const modules = Array.isArray(b.modules) ? b.modules.map(String) : [];
      const r = await db.query(
        `INSERT INTO licenses
          (uuid, "customerName", "companyName", plan, status, "graceDays",
           "maxUsers", "maxDevices", "aiMonthlyLimit", modules, "activationKey",
           notes, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10,$11,$12,$12)
         RETURNING *`,
        [
          uuid,
          customerName,
          String(b.companyName || "").trim(),
          String(b.plan || "standard").trim(),
          Number.isFinite(Number(b.graceDays)) ? Number(b.graceDays) : 30,
          Number.isFinite(Number(b.maxUsers)) ? Number(b.maxUsers) : 5,
          Number.isFinite(Number(b.maxDevices)) ? Number(b.maxDevices) : 5,
          Number.isFinite(Number(b.aiMonthlyLimit)) ? Number(b.aiMonthlyLimit) : 1000,
          JSON.stringify(modules),
          buildActivationKey(uuid),
          b.notes ? String(b.notes).trim() : null,
          now,
        ]
      );
      await logLicenseAction(r.rows[0].id, "created", `plan ${r.rows[0].plan}`, performedBy(req));
      return res.status(201).json(normalizeLicenseRow(r.rows[0]));
    } catch (error) {
      console.error("POST /api/licenses error:", error);
      return res.status(500).json({ error: "Error creando licencia" });
    }
  });

  // ── Detalle + verificación de caducidad ──
  router.get("/:id", requireAdmin, async (req, res) => {
    try {
      const row = await getLicenseOr404(Number(req.params.id), res);
      if (!row) return;
      return res.json(await refreshLicenseStatus(row));
    } catch (error) {
      console.error("GET /api/licenses/:id error:", error);
      return res.status(500).json({ error: "Error obteniendo licencia" });
    }
  });

  // ── Historial completo (auditoría + renovaciones + avisos) ──
  router.get("/:id/history", requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const row = await getLicenseOr404(id, res);
      if (!row) return;
      const [history, renewals, notifications] = await Promise.all([
        db.query(`SELECT * FROM license_history WHERE "licenseId" = $1 ORDER BY "createdAtMs" DESC LIMIT 200`, [id]),
        db.query(`SELECT * FROM license_renewals WHERE "licenseId" = $1 ORDER BY "renewedAtMs" DESC`, [id]),
        db.query(`SELECT * FROM license_notifications WHERE "licenseId" = $1 ORDER BY "sentAtMs" DESC`, [id]),
      ]);
      return res.json({
        history: history.rows.map((h: any) => ({ ...h, createdAtMs: Number(h.createdAtMs) })),
        renewals: renewals.rows.map((h: any) => ({
          ...h,
          renewedAtMs: Number(h.renewedAtMs),
          previousExpiresAtMs: h.previousExpiresAtMs != null ? Number(h.previousExpiresAtMs) : null,
          newExpiresAtMs: Number(h.newExpiresAtMs),
        })),
        notifications: notifications.rows.map((n: any) => ({ ...n, sentAtMs: Number(n.sentAtMs), expiresAtMs: Number(n.expiresAtMs) })),
      });
    } catch (error) {
      console.error("GET /api/licenses/:id/history error:", error);
      return res.status(500).json({ error: "Error obteniendo historial" });
    }
  });

  // ── Activar: fija activación y caducidad (+4 años) ──
  router.post("/:id/activate", requireAdmin, async (req, res) => {
    try {
      const row = await getLicenseOr404(Number(req.params.id), res);
      if (!row) return;
      if (row.status !== "pending") return res.status(400).json({ error: "Solo se puede activar una licencia pendiente" });

      const now = Date.now();
      const expires = expiryFromActivation(now);
      const r = await db.query(
        `UPDATE licenses SET status = 'active', "activatedAtMs" = $2, "expiresAtMs" = $3, "updatedAtMs" = $2 WHERE id = $1 RETURNING *`,
        [row.id, now, expires]
      );
      await logLicenseAction(row.id, "activated", `caduca ${new Date(expires).toISOString().slice(0, 10)}`, performedBy(req));
      return res.json(normalizeLicenseRow(r.rows[0]));
    } catch (error) {
      console.error("POST /api/licenses/:id/activate error:", error);
      return res.status(500).json({ error: "Error activando licencia" });
    }
  });

  // ── Renovar: nueva caducidad +4 años, conserva historial ──
  router.post("/:id/renew", requireAdmin, async (req, res) => {
    try {
      const row = await getLicenseOr404(Number(req.params.id), res);
      if (!row) return;
      if (["cancelled"].includes(row.status)) return res.status(400).json({ error: "No se puede renovar una licencia cancelada" });

      const now = Date.now();
      const prev = row.expiresAtMs != null ? Number(row.expiresAtMs) : null;
      // Si aún no ha caducado, los 4 años cuentan desde la caducidad actual;
      // si ya caducó, desde hoy.
      const base = prev != null && prev > now ? prev : now;
      const newExpires = expiryFromActivation(base);

      const r = await db.query(
        `UPDATE licenses SET status = 'active', "expiresAtMs" = $2, "activatedAtMs" = COALESCE("activatedAtMs", $3), "updatedAtMs" = $3 WHERE id = $1 RETURNING *`,
        [row.id, newExpires, now]
      );
      await db.query(
        `INSERT INTO license_renewals ("licenseId", "renewedAtMs", "previousExpiresAtMs", "newExpiresAtMs", "renewedBy", note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [row.id, now, prev, newExpires, performedBy(req), req.body?.note ? String(req.body.note).trim() : null]
      );
      await logLicenseAction(row.id, "renewed", `nueva caducidad ${new Date(newExpires).toISOString().slice(0, 10)}`, performedBy(req));
      return res.json(normalizeLicenseRow(r.rows[0]));
    } catch (error) {
      console.error("POST /api/licenses/:id/renew error:", error);
      return res.status(500).json({ error: "Error renovando licencia" });
    }
  });

  // ── Suspender / reanudar / cancelar ──
  async function setManualStatus(req: any, res: any, status: "suspended" | "active" | "cancelled", action: string) {
    const row = await getLicenseOr404(Number(req.params.id), res);
    if (!row) return;
    if (row.status === "cancelled") return res.status(400).json({ error: "Licencia cancelada: estado final" });
    const r = await db.query(
      `UPDATE licenses SET status = $2, "updatedAtMs" = $3 WHERE id = $1 RETURNING *`,
      [row.id, status, Date.now()]
    );
    await logLicenseAction(row.id, action, req.body?.reason ? String(req.body.reason).trim() : null, performedBy(req));
    return res.json(await refreshLicenseStatus(r.rows[0]));
  }

  router.post("/:id/suspend", requireAdmin, (req, res) =>
    setManualStatus(req, res, "suspended", "suspended").catch((e) => {
      console.error("POST /api/licenses/:id/suspend error:", e);
      res.status(500).json({ error: "Error suspendiendo licencia" });
    })
  );
  router.post("/:id/resume", requireAdmin, (req, res) =>
    setManualStatus(req, res, "active", "resumed").catch((e) => {
      console.error("POST /api/licenses/:id/resume error:", e);
      res.status(500).json({ error: "Error reanudando licencia" });
    })
  );
  router.post("/:id/cancel", requireAdmin, (req, res) =>
    setManualStatus(req, res, "cancelled", "cancelled").catch((e) => {
      console.error("POST /api/licenses/:id/cancel error:", e);
      res.status(500).json({ error: "Error cancelando licencia" });
    })
  );

  return router;
}
