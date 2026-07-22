/**
 * Connect Pro — API pública para partners bajo /api/connect/v1
 * y API de administración (partners/keys/talleres) bajo /api/connect/admin.
 *
 * Errores en formato uniforme: { error: { code, message, details? } }.
 */

import crypto from "node:crypto";
import { Router, json, type RequestHandler, type Response } from "express";
import db from "../db.ts";
import { requireConnectKey, generateApiKey } from "./auth.ts";
import {
  createAssistance, assignAssistance, findCandidates, transition,
  InvalidTransitionError,
} from "./service.ts";

function err(res: Response, status: number, code: string, message: string, details?: unknown) {
  return res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}

function toPublic(a: any) {
  return {
    id: a.uuid,
    external_reference: a.externalReference,
    status: a.status,
    priority: a.priority === "urgente" ? "urgente" : "normal",
    service_type: a.serviceType,
    description: a.description,
    location: a.latitude != null ? { lat: a.latitude, lng: a.longitude } : null,
    address: a.address,
    customer: { name: a.customerName, phone: a.customerPhone },
    vehicle: safeParse(a.vehicle),
    workshop_id: a.workshopId,
    assignment_explanation: a.assignmentExplanation,
    cancel_reason: a.cancelReason,
    created_at: new Date(Number(a.createdAtMs)).toISOString(),
    updated_at: new Date(Number(a.updatedAtMs)).toISOString(),
  };
}

function safeParse(v: unknown): any {
  try { return typeof v === "string" ? JSON.parse(v) : (v ?? {}); } catch { return {}; }
}

async function loadOwnAssistance(partnerId: number, uuid: string) {
  const r = await db.query(
    `SELECT * FROM connect_assistances WHERE uuid = $1 AND "partnerId" = $2`,
    [uuid, partnerId],
  );
  return r.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// API pública de partners
// ---------------------------------------------------------------------------

export function createConnectRouter(): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  // --- Talleres / cotización ---

  router.post("/workshops/eta", requireConnectKey("workshops:read"), async (req, res) => {
    const { location, service_type: serviceType } = req.body ?? {};
    if (typeof location?.lat !== "number" || typeof location?.lng !== "number") {
      return err(res, 422, "validation_failed", "location.lat y location.lng son obligatorios");
    }
    const candidates = await findCandidates(location.lat, location.lng, String(serviceType || "other"));
    res.json({
      candidates: candidates.map((c) => ({
        workshop_id: c.workshopId,
        name: c.name,
        distance_km: c.distanceKm,
        eta_minutes: c.etaMinutes,
        score: c.score,
      })),
    });
  });

  // --- Asistencias ---

  router.post("/assistances", requireConnectKey("assistances:write"), async (req, res) => {
    const auth = req.connectAuth!;
    const b = req.body ?? {};
    const details: Array<{ field: string; issue: string }> = [];
    if (!b.customer?.name && !b.customer?.phone) details.push({ field: "customer", issue: "Se requiere nombre o teléfono" });
    if (!b.address && (typeof b.location?.lat !== "number" || typeof b.location?.lng !== "number")) {
      details.push({ field: "location", issue: "Se requiere location {lat,lng} o address" });
    }
    if (details.length) return err(res, 422, "validation_failed", "Datos de la asistencia incompletos", details);

    try {
      const { row, duplicated } = await createAssistance({
        partnerId: auth.partnerId,
        externalReference: b.external_reference,
        idempotencyKey: String(req.headers["idempotency-key"] || "") || undefined,
        priority: b.priority,
        serviceType: b.service_type,
        description: b.description,
        latitude: typeof b.location?.lat === "number" ? b.location.lat : null,
        longitude: typeof b.location?.lng === "number" ? b.location.lng : null,
        address: b.address,
        customerName: b.customer?.name,
        customerPhone: b.customer?.phone,
        vehicle: b.vehicle,
        metadata: b.metadata,
      });
      if (duplicated) return res.status(200).json(toPublic(row));

      // Modo auto: asignar en segundo plano; el partner recibe 201 inmediato
      const modeR = await db.query(`SELECT "assignmentMode" FROM connect_partners WHERE id = $1`, [auth.partnerId]);
      if (modeR.rows[0]?.assignmentMode === "auto") {
        assignAssistance(row.id).catch((e) => console.error("[Connect] error asignando:", e?.message));
      }
      res.status(201).json(toPublic(row));
    } catch (e: any) {
      console.error("[Connect] error creando asistencia:", e?.message);
      err(res, 500, "internal_error", "Error creando la asistencia");
    }
  });

  router.get("/assistances", requireConnectKey("assistances:read"), async (req, res) => {
    const auth = req.connectAuth!;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const status = req.query.status ? String(req.query.status) : null;
    const r = await db.query(
      `SELECT * FROM connect_assistances
        WHERE "partnerId" = $1 AND ($2::text IS NULL OR status = $2)
        ORDER BY id DESC LIMIT $3`,
      [auth.partnerId, status, limit],
    );
    res.json({ data: r.rows.map(toPublic) });
  });

  router.get("/assistances/:uuid", requireConnectKey("assistances:read"), async (req, res) => {
    const a = await loadOwnAssistance(req.connectAuth!.partnerId, String(req.params.uuid));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");
    // Enriquecer con datos del core si está inyectada (técnico, taller)
    let technician: { name: string } | null = null;
    let workshop: { id: number; name: string; phone: string | null } | null = null;
    if (a.coreAssistanceId) {
      const core = await db.query(
        `SELECT "assignedTechName" FROM roadside_assistances WHERE id = $1`, [a.coreAssistanceId]);
      if (core.rows[0]?.assignedTechName) technician = { name: core.rows[0].assignedTechName };
    }
    if (a.workshopId) {
      const w = await db.query(`SELECT id, name, phone FROM connect_workshops WHERE id = $1`, [a.workshopId]);
      if (w.rows[0]) workshop = w.rows[0];
    }
    res.json({ ...toPublic(a), technician, workshop });
  });

  router.get("/assistances/:uuid/timeline", requireConnectKey("assistances:read"), async (req, res) => {
    const a = await loadOwnAssistance(req.connectAuth!.partnerId, String(req.params.uuid));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");
    const h = await db.query(
      `SELECT "fromStatus", "toStatus", "actorType", reason, "occurredAtMs"
         FROM connect_status_history WHERE "assistanceId" = $1 ORDER BY id`,
      [a.id],
    );
    res.json({
      data: h.rows.map((e) => ({
        from_status: e.fromStatus,
        to_status: e.toStatus,
        actor: e.actorType,
        reason: e.reason,
        occurred_at: new Date(Number(e.occurredAtMs)).toISOString(),
      })),
    });
  });

  router.post("/assistances/:uuid/cancel", requireConnectKey("assistances:write"), async (req, res) => {
    const a = await loadOwnAssistance(req.connectAuth!.partnerId, String(req.params.uuid));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");
    const reason = String(req.body?.reason || "Cancelada por el partner");
    try {
      await transition(a.id, "cancelled", "api", reason);
      await db.query(`UPDATE connect_assistances SET "cancelReason" = $1 WHERE id = $2`, [reason, a.id]);
      // Propagar al core si ya estaba inyectada
      if (a.coreAssistanceId) {
        const now = Date.now();
        await db.query(
          `UPDATE roadside_assistances SET status = 'cancelada', "cancelledAtMs" = $1, "updatedAtMs" = $1 WHERE id = $2 AND status <> 'finalizada'`,
          [now, a.coreAssistanceId],
        );
        await db.query(
          `INSERT INTO roadside_assistance_events ("assistanceId", status, note, "createdBy", "createdAtMs")
           VALUES ($1, 'cancelada', $2, 'connect-pro', $3)`,
          [a.coreAssistanceId, reason, now],
        );
      }
      const updated = await loadOwnAssistance(req.connectAuth!.partnerId, String(req.params.uuid));
      res.json(toPublic(updated));
    } catch (e) {
      if (e instanceof InvalidTransitionError) return err(res, 409, "invalid_state_transition", e.message);
      throw e;
    }
  });

  // --- Webhooks del partner ---

  router.get("/webhook-endpoints", requireConnectKey("webhooks:manage"), async (req, res) => {
    const r = await db.query(
      `SELECT id, url, "eventTypes", status, "createdAtMs" FROM connect_webhook_endpoints WHERE "partnerId" = $1`,
      [req.connectAuth!.partnerId],
    );
    res.json({
      data: r.rows.map((e) => ({
        id: e.id, url: e.url, event_types: safeParse(e.eventTypes), status: e.status,
        created_at: new Date(Number(e.createdAtMs)).toISOString(),
      })),
    });
  });

  router.post("/webhook-endpoints", requireConnectKey("webhooks:manage"), async (req, res) => {
    const { url, event_types: eventTypes } = req.body ?? {};
    if (!/^https?:\/\//.test(String(url || ""))) return err(res, 422, "validation_failed", "url inválida");
    const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
    const r = await db.query(
      `INSERT INTO connect_webhook_endpoints ("partnerId", url, secret, "eventTypes", "createdAtMs")
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.connectAuth!.partnerId, url, secret, JSON.stringify(Array.isArray(eventTypes) ? eventTypes : ["*"]), Date.now()],
    );
    // El secreto se devuelve una única vez
    res.status(201).json({ id: r.rows[0].id, url, secret });
  });

  router.delete("/webhook-endpoints/:id", requireConnectKey("webhooks:manage"), async (req, res) => {
    await db.query(
      `UPDATE connect_webhook_endpoints SET status = 'disabled' WHERE id = $1 AND "partnerId" = $2`,
      [Number(req.params.id), req.connectAuth!.partnerId],
    );
    res.status(204).end();
  });

  return router;
}

// ---------------------------------------------------------------------------
// API de administración (protegida con el requireAdminRole del monolito)
// ---------------------------------------------------------------------------

export function createConnectAdminRouter(requireAdmin: RequestHandler): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));
  router.use(requireAdmin);

  router.get("/partners", async (_req, res) => {
    const r = await db.query(`SELECT * FROM connect_partners ORDER BY id`);
    res.json({ data: r.rows });
  });

  router.post("/partners", async (req, res) => {
    const { name, contactEmail, assignmentMode } = req.body ?? {};
    if (!name) return err(res, 422, "validation_failed", "name es obligatorio");
    const now = Date.now();
    const r = await db.query(
      `INSERT INTO connect_partners (uuid, name, "contactEmail", "assignmentMode", "createdAtMs", "updatedAtMs")
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
      [crypto.randomUUID(), String(name), contactEmail ?? null, assignmentMode === "manual" ? "manual" : "auto", now],
    );
    res.status(201).json(r.rows[0]);
  });

  router.post("/partners/:id/api-keys", async (req, res) => {
    const partnerId = Number(req.params.id);
    const environment = req.body?.environment === "test" ? "test" : "live";
    const { key, prefix, hash } = generateApiKey(environment);
    await db.query(
      `INSERT INTO connect_api_keys ("partnerId", name, "keyPrefix", "keyHash", environment, "createdAtMs")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [partnerId, String(req.body?.name || ""), prefix, hash, environment, Date.now()],
    );
    // La clave completa solo se muestra aquí, una vez
    res.status(201).json({ api_key: key, prefix, environment });
  });

  router.get("/workshops", async (_req, res) => {
    const r = await db.query(`SELECT * FROM connect_workshops ORDER BY id`);
    res.json({ data: r.rows });
  });

  router.post("/workshops", async (req, res) => {
    const b = req.body ?? {};
    if (!b.name || typeof b.latitude !== "number" || typeof b.longitude !== "number") {
      return err(res, 422, "validation_failed", "name, latitude y longitude son obligatorios");
    }
    const now = Date.now();
    const r = await db.query(
      `INSERT INTO connect_workshops ("coreWorkshopId", name, phone, latitude, longitude, "radiusKm", services, "createdAtMs", "updatedAtMs")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *`,
      [
        b.coreWorkshopId ?? null, String(b.name), b.phone ?? null, b.latitude, b.longitude,
        Number(b.radiusKm) || 60,
        JSON.stringify(Array.isArray(b.services) && b.services.length ? b.services : ["tow_truck", "mechanical", "tyres", "battery", "fuel", "lockout", "other"]),
        now,
      ],
    );
    res.status(201).json(r.rows[0]);
  });

  router.get("/assistances", async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const r = await db.query(
      `SELECT ca.*, p.name AS "partnerName", w.name AS "workshopName"
         FROM connect_assistances ca
         JOIN connect_partners p ON p.id = ca."partnerId"
         LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
        ORDER BY ca.id DESC LIMIT $1`,
      [limit],
    );
    res.json({ data: r.rows });
  });

  // Asignación manual desde el panel (modo manual o rescate de assignment_failed)
  router.post("/assistances/:id/assign", async (req, res) => {
    const id = Number(req.params.id);
    const workshopId = Number(req.body?.workshopId);
    if (!workshopId) return err(res, 422, "validation_failed", "workshopId es obligatorio");
    try {
      await assignAssistance(id, workshopId);
      const r = await db.query(`SELECT * FROM connect_assistances WHERE id = $1`, [id]);
      res.json(r.rows[0]);
    } catch (e: any) {
      err(res, 409, "assignment_error", e?.message || "No se pudo asignar");
    }
  });

  return router;
}
