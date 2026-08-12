/**
 * Mobilink Assist Lite — API de la APK del taller colaborador
 * (/api/connect/lite).
 *
 * Un taller LITE no tiene Mobilink Assist instalado: sus operarios trabajan
 * directamente contra Central Pro con esta API. Por eso NO se inyecta nada en
 * el core (roadside_assistances); la asistencia de Connect es la única fuente
 * de verdad y produce la misma línea temporal, KPIs y auditoría que un taller
 * con el producto completo.
 *
 * Autenticación: token opaco por dispositivo (Authorization: Bearer lite_...).
 * Solo se almacena su hash SHA-256, igual que las API keys de partners.
 */

import crypto from "node:crypto";
import { Router, json, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import sharp from "sharp";
import db from "../db.ts";
import { supabase, SUPABASE_ROADSIDE_BUCKET } from "../supabase.ts";
import { transition, InvalidTransitionError, rejectAssignment, acceptAssignment } from "./service.ts";
import { publish } from "./bus.ts";
import { createAlert } from "./alerts.ts";
import { notifyLiteUser } from "./litePush.ts";
import { liteMetrics } from "./liteMetrics.ts";
import {
  hitLimit, limitKey, newLimitStore, pruneLimitStore, LITE_LIMITS, type LimitName,
} from "./liteLimits.ts";
import {
  DEFAULT_FINISH_RULES, DEFAULT_GEOFENCE, EVIDENCE_CATEGORIES, EVIDENCE_CATEGORY_LABELS,
  LITE_STATUS_LABELS, SERVICE_RESULTS, SERVICE_RESULT_LABELS, canLiteTransition, computeLiteKpis,
  dedupePoints, estimateEtaMinutes, geofenceHint, haversineMeters, isValidPoint, nextLiteStatus,
  shouldTrack, trackingIntervalSec, validateFinish,
  type FinishRules, type GeofenceConfig, type GpsPoint,
} from "./liteRules.ts";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function err(res: Response, status: number, code: string, message: string, extra?: unknown) {
  return res.status(status).json({ error: { code, message, detail: extra ?? undefined } });
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Número entero o null: lo que llega de la APK no siempre es un número. */
function entero(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function safeParse(value: unknown): any {
  try { return typeof value === "string" ? JSON.parse(value) : (value ?? {}); } catch { return {}; }
}

export interface LiteSession {
  userId: number;
  userName: string;
  role: "workshop_admin" | "operator";
  workshopId: number;
  workshopName: string;
  providerCompanyId: number | null;
  deviceId: number;
}

declare module "express-serve-static-core" {
  interface Request {
    liteSession?: LiteSession;
  }
}

/** Configuración operativa del taller (geovallas, reglas de cierre, flags). */
export interface LiteWorkshopConfig {
  geofence: GeofenceConfig;
  finishRules: FinishRules;
  trackWhileWorking: boolean;
  features: Record<string, boolean>;
}

const LITE_FEATURES: Record<string, boolean> = {
  assistances: true,
  states: true,
  gps: true,
  navigation: true,
  photos: true,
  signature: true,
  notes: true,
  messaging: true,
  history: true,
  profile: true,
  // Módulos del producto completo: deshabilitados en Lite
  ownClients: false,
  billing: false,
  accounting: false,
  inventory: false,
  agenda: false,
  campaigns: false,
  createOwnAssistances: false,
};

export function buildLiteConfig(workshopRow: any): LiteWorkshopConfig {
  const settings = safeParse(workshopRow?.liteSettings);
  const features = safeParse(workshopRow?.features);
  return {
    geofence: { ...DEFAULT_GEOFENCE, ...(settings.geofence ?? {}) },
    finishRules: { ...DEFAULT_FINISH_RULES, ...(settings.finishRules ?? {}) },
    trackWhileWorking: settings.trackWhileWorking !== false,
    features: { ...LITE_FEATURES, ...features },
  };
}

// ── Idempotencia de operaciones enviadas desde la APK ──────────────────────

async function findAction(clientActionId: string | undefined | null): Promise<any | null> {
  const id = String(clientActionId || "").trim();
  if (!id) return null;
  const r = await db.query(`SELECT result FROM connect_lite_actions WHERE "clientActionId" = $1`, [id]);
  if (!r.rows[0]) return null;
  return safeParse(r.rows[0].result);
}

async function recordAction(
  clientActionId: string | undefined | null,
  kind: string,
  session: LiteSession,
  assistanceId: number | null,
  result: unknown,
): Promise<void> {
  const id = String(clientActionId || "").trim();
  if (!id) return;
  await db.query(
    `INSERT INTO connect_lite_actions ("clientActionId", "liteUserId", "assistanceId", kind, result, "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ("clientActionId") DO NOTHING`,
    [id, session.userId, assistanceId, kind, JSON.stringify(result ?? {}).slice(0, 8000), Date.now()],
  ).catch((e: any) => console.error("[Lite] recordAction:", e?.message));
}

// ── Auditoría (misma tabla que Central Pro) ────────────────────────────────

export async function auditLite(opts: {
  session?: LiteSession;
  req?: Request;
  action: string;
  resourceType?: string;
  resourceId?: string | number;
  detail?: unknown;
}): Promise<void> {
  try {
    const s = opts.session ?? opts.req?.liteSession;
    await db.query(
      `INSERT INTO connect_audit_logs
         ("controlCenterId", "actorType", "actorId", "actorName", action, "resourceType", "resourceId", detail, ip, "createdAtMs")
       VALUES (NULL, 'lite', $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        s ? String(s.userId) : null,
        s ? `${s.userName} (${s.workshopName})` : null,
        opts.action,
        opts.resourceType ?? null,
        opts.resourceId != null ? String(opts.resourceId) : null,
        opts.detail != null ? JSON.stringify(opts.detail).slice(0, 4000) : null,
        opts.req?.ip ?? null,
        Date.now(),
      ],
    );
  } catch (e: any) {
    console.error("[Lite] audit error:", e?.message);
  }
}

// ── Autenticación ──────────────────────────────────────────────────────────

export function hashPin(pin: string, salt: string): string {
  return crypto.pbkdf2Sync(pin, salt, 60_000, 32, "sha256").toString("hex");
}

export function newPinSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Intentos fallidos de login por IP+usuario (memoria del proceso). */
const loginAttempts = new Map<string, { count: number; firstAtMs: number }>();
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_ATTEMPTS = 10;

function loginBlocked(key: string): boolean {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAtMs > LOGIN_WINDOW_MS) { loginAttempts.delete(key); return false; }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function registerFailedLogin(key: string): void {
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() - entry.firstAtMs > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAtMs: Date.now() });
  } else {
    entry.count++;
  }
}

// ── Límites de uso ─────────────────────────────────────────────────────────

const limitStore = newLimitStore();
let ultimaLimpiezaMs = 0;

/**
 * Freno por dispositivo (o por IP en el login, que aún no tiene sesión). El
 * tope general por dispositivo se comprueba siempre, además del de la familia.
 */
function limitar(name: LimitName) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now - ultimaLimpiezaMs > 300_000) {
      pruneLimitStore(limitStore, now);
      ultimaLimpiezaMs = now;
    }

    const sujeto = req.liteSession ? `d${req.liteSession.deviceId}` : `ip${req.ip ?? "?"}`;
    const comprobaciones: LimitName[] = name === "login" ? ["login"] : [name, "device"];

    for (const cual of comprobaciones) {
      const v = hitLimit(limitStore, limitKey(cual, sujeto), LITE_LIMITS[cual], now);
      if (!v.allowed) {
        liteMetrics.recordRateLimited(etiquetaRuta(req), now);
        res.setHeader("Retry-After", String(v.retryAfterSec));
        return err(res, 429, "rate_limited",
          "Demasiadas operaciones seguidas. Se reintentará en unos segundos.",
          { retryAfterSec: v.retryAfterSec, limit: cual });
      }
    }
    next();
  };
}

// ── Medición ───────────────────────────────────────────────────────────────

/**
 * Etiqueta estable por ruta (`POST /assistances/:id/files`), no por URL: si se
 * usara la URL real, cada asistencia crearía su propia serie y la métrica no
 * agregaría nada. De paso evita que un identificador acabe en las métricas.
 */
function etiquetaRuta(req: Request): string {
  const patron = (req as any).route?.path ?? req.path.replace(/\/\d+/g, "/:id");
  return `${req.method} ${patron}`;
}

function medir(req: Request, res: Response, next: NextFunction) {
  const inicio = Date.now();
  res.on("finish", () => {
    liteMetrics.recordApi(etiquetaRuta(req), res.statusCode, Date.now() - inicio);
  });
  next();
}

async function requireLite(req: Request, res: Response, next: NextFunction) {
  try {
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token.startsWith("lite_")) {
      return err(res, 401, "unauthorized", "Falta el token de sesión");
    }
    const r = await db.query(
      `SELECT d.id AS "deviceId", d."revokedAtMs", u.id AS "userId", u.name, u.role, u.active,
              w.id AS "workshopId", w.name AS "workshopName", w."providerCompanyId", w."integrationType"
         FROM connect_lite_devices d
         JOIN connect_lite_users u ON u.id = d."userId"
         JOIN connect_workshops w ON w.id = u."workshopId"
        WHERE d."tokenHash" = $1`,
      [sha256(token)],
    );
    const row = r.rows[0];
    if (!row || row.revokedAtMs || !row.active) {
      return err(res, 401, "unauthorized", "Sesión caducada o revocada. Vuelve a iniciar sesión.");
    }
    if (row.integrationType !== "lite") {
      return err(res, 403, "not_lite", "Este taller ya no opera con Mobilink Assist Lite");
    }
    req.liteSession = {
      userId: row.userId, userName: row.name, role: row.role,
      workshopId: row.workshopId, workshopName: row.workshopName,
      providerCompanyId: row.providerCompanyId, deviceId: row.deviceId,
    };
    db.query(`UPDATE connect_lite_devices SET "lastSeenAtMs" = $1 WHERE id = $2`, [Date.now(), row.deviceId])
      .catch(() => {});
    next();
  } catch (e: any) {
    console.error("[Lite] auth error:", e?.message);
    err(res, 500, "internal_error", "Error validando la sesión");
  }
}

/** Carga la asistencia comprobando que pertenece al taller (y al operario). */
async function loadAssistance(session: LiteSession, id: number, opts: { ownOnly?: boolean } = {}) {
  const r = await db.query(
    `SELECT ca.*, w.name AS "workshopName", w.latitude AS "workshopLat", w.longitude AS "workshopLng",
            w."liteSettings", w.features, cl.name AS "clientDisplayName"
       FROM connect_assistances ca
       JOIN connect_workshops w ON w.id = ca."workshopId"
       LEFT JOIN connect_clients cl ON cl.id = ca."clientId"
      WHERE ca.id = $1 AND ca."workshopId" = $2`,
    [id, session.workshopId],
  );
  const a = r.rows[0];
  if (!a) return null;
  // Un operario solo actúa sobre lo suyo o sobre lo aún no asignado
  const ownOnly = opts.ownOnly ?? session.role === "operator";
  if (ownOnly && a.liteUserId != null && Number(a.liteUserId) !== session.userId) return null;
  return a;
}

/** Vista de la asistencia para la APK: minimización de datos. */
function publicAssistance(a: any, opts: { detail?: boolean } = {}) {
  const vehicle = safeParse(a.vehicle);
  const requester = safeParse(a.requester);
  const locationDetails = safeParse(a.locationDetails);
  const base = {
    id: a.id,
    uuid: a.uuid,
    expedientNumber: a.expedientNumber,
    externalReference: a.externalReference,
    status: a.status,
    statusLabel: (LITE_STATUS_LABELS as Record<string, string>)[a.status] ?? a.status,
    nextStatus: nextLiteStatus(a.status),
    priority: a.priority,
    serviceType: a.serviceType,
    clientName: a.clientDisplayName ?? a.clientName,
    address: a.address,
    latitude: a.latitude,
    longitude: a.longitude,
    slaMinutes: a.slaMinutes,
    slaDeadlineAtMs: a.slaDeadlineAtMs ? Number(a.slaDeadlineAtMs) : null,
    createdAtMs: Number(a.createdAtMs),
    updatedAtMs: Number(a.updatedAtMs),
    liteUserId: a.liteUserId,
    liteUserName: a.liteUserName,
    vehicle: {
      type: vehicle.type ?? null, make: vehicle.make ?? null, model: vehicle.model ?? null,
      plate: vehicle.plate ?? null, trailer: !!vehicle.trailer, dangerousGoods: !!vehicle.dangerousGoods,
    },
  };
  if (!opts.detail) return base;
  return {
    ...base,
    description: a.description,
    customerName: a.customerName,
    customerPhone: a.customerPhone,
    requester: { name: requester.name ?? null, phone: requester.phone ?? null, language: requester.language ?? "es" },
    locationDetails,
    vin: vehicle.vin ?? null,
    fuel: vehicle.fuel ?? null,
    weight: vehicle.weight ?? null,
    cargo: vehicle.cargo ?? null,
    resultCode: a.resultCode,
    resolutionNotes: a.resolutionNotes,
    odometerKm: a.odometerKm,
    workshopLat: a.workshopLat,
    workshopLng: a.workshopLng,
    operator: a.operatorLat != null ? {
      lat: a.operatorLat, lng: a.operatorLng,
      accuracyM: a.operatorAccuracyM, atMs: a.operatorLocationAtMs ? Number(a.operatorLocationAtMs) : null,
    } : null,
  };
}

/** Guarda posiciones válidas y actualiza la última conocida. Devuelve pistas de geovalla. */
async function storePoints(
  session: LiteSession,
  a: any,
  rawPoints: Partial<GpsPoint>[],
): Promise<{ stored: number; hint: ReturnType<typeof geofenceHint> | null }> {
  const now = Date.now();
  const config = buildLiteConfig(a);
  const valid = rawPoints
    .map((p) => ({
      lat: Number(p.lat), lng: Number(p.lng), ts: Number(p.ts ?? now),
      accuracyM: p.accuracyM != null ? Number(p.accuracyM) : null,
      speedKmh: p.speedKmh != null ? Number(p.speedKmh) : null,
      headingDeg: p.headingDeg != null ? Number(p.headingDeg) : null,
    }))
    .filter((p) => isValidPoint(p, now));
  // Se miden las descartadas por inválidas, no las que quita `dedupePoints`:
  // un punto repetido no aporta nada y tirarlo no es perder información.
  liteMetrics.recordPoints(rawPoints.length, valid.length);
  const points = dedupePoints(valid as GpsPoint[]);
  if (points.length === 0) return { stored: 0, hint: null };

  for (const p of points) {
    await db.query(
      `INSERT INTO connect_assistance_tracks
         ("assistanceId", "liteUserId", "deviceId", lat, lng, "accuracyM", "speedKmh", "headingDeg",
          status, "deviceTsMs", "serverTsMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT DO NOTHING`,
      [a.id, session.userId, session.deviceId, p.lat, p.lng, p.accuracyM ?? null,
       p.speedKmh ?? null, p.headingDeg ?? null, a.status, p.ts, now],
    );
  }

  const last = points[points.length - 1];
  await db.query(
    `UPDATE connect_assistances
        SET "operatorLat" = $1, "operatorLng" = $2, "operatorAccuracyM" = $3,
            "operatorSpeedKmh" = $4, "operatorLocationAtMs" = $5
      WHERE id = $6 AND ("operatorLocationAtMs" IS NULL OR "operatorLocationAtMs" <= $5)`,
    [last.lat, last.lng, last.accuracyM ?? null, last.speedKmh ?? null, last.ts, a.id],
  );
  publish({ kind: "status", assistanceId: a.id, status: a.status });

  const hint = geofenceHint({
    status: a.status,
    point: last,
    target: a.latitude != null && a.longitude != null ? { lat: a.latitude, lng: a.longitude } : null,
    workshop: a.workshopLat != null && a.workshopLng != null ? { lat: a.workshopLat, lng: a.workshopLng } : null,
    config: config.geofence,
  });
  return { stored: points.length, hint };
}

async function assistanceEvidence(assistanceId: number) {
  const files = await db.query(
    `SELECT id, category, url, "fileName", "mimeType", "sizeBytes", "createdAtMs"
       FROM connect_assistance_files
      WHERE "assistanceId" = $1 AND "deletedAtMs" IS NULL
      ORDER BY id`,
    [assistanceId],
  );
  const sig = await db.query(
    `SELECT id, "signerName", "signerDocument", url, "signedAtMs"
       FROM connect_assistance_signatures WHERE "assistanceId" = $1 ORDER BY id DESC LIMIT 1`,
    [assistanceId],
  );
  return { files: files.rows, signature: sig.rows[0] ?? null };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
});

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export function createConnectLiteRouter(): Router {
  const router = Router();
  router.use(json({ limit: "2mb" }));
  router.use(medir);

  // ── Sesión ───────────────────────────────────────────────────────────────

  /** Login con código de taller + usuario + PIN. Devuelve token de dispositivo. */
  router.post("/login", limitar("login"), async (req, res) => {
    const workshopCode = String(req.body?.workshopCode || "").trim();
    const username = String(req.body?.username || "").trim().toLowerCase();
    const pin = String(req.body?.pin || "");
    const device = req.body?.device ?? {};
    const rateKey = `${req.ip}|${workshopCode}|${username}`;

    if (!workshopCode || !username || !pin) {
      return err(res, 422, "validation_failed", "Indica taller, usuario y PIN");
    }
    if (loginBlocked(rateKey)) {
      return err(res, 429, "too_many_attempts", "Demasiados intentos. Espera unos minutos.");
    }

    const r = await db.query(
      `SELECT u.*, w.name AS "workshopName", w."integrationType", w."providerCompanyId",
              w."liteSettings", w.features, w.latitude AS "workshopLat", w.longitude AS "workshopLng"
         FROM connect_lite_users u
         JOIN connect_workshops w ON w.id = u."workshopId"
        WHERE lower(u.username) = $1 AND u.active
          AND (w."liteCode" = $2 OR CAST(w.id AS TEXT) = $2)`,
      [username, workshopCode],
    );
    const u = r.rows[0];
    if (!u || hashPin(pin, u.pinSalt) !== u.pinHash) {
      registerFailedLogin(rateKey);
      await auditLite({ req, action: "lite.login_failed", resourceType: "lite_user", detail: { username, workshopCode } });
      return err(res, 401, "invalid_credentials", "Usuario o PIN incorrectos");
    }
    if (u.integrationType !== "lite") {
      return err(res, 403, "not_lite", "Este taller no tiene Mobilink Assist Lite habilitado");
    }

    loginAttempts.delete(rateKey);
    const token = `lite_${crypto.randomBytes(32).toString("hex")}`;
    const now = Date.now();
    const deviceId = String(device.deviceId || "").trim() || crypto.randomUUID();

    // Una sesión activa por dispositivo: se revoca la anterior del mismo equipo
    await db.query(
      `UPDATE connect_lite_devices SET "revokedAtMs" = $1
        WHERE "userId" = $2 AND "deviceId" = $3 AND "revokedAtMs" IS NULL`,
      [now, u.id, deviceId],
    );
    const ins = await db.query(
      `INSERT INTO connect_lite_devices
         ("userId", "workshopId", "deviceId", "tokenHash", platform, "osVersion", "appVersion",
          "gpsPermission", "cameraPermission", "notifPermission", "lastSeenAtMs", "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
      [
        u.id, u.workshopId, deviceId, sha256(token),
        device.platform ?? null, device.osVersion ?? null, device.appVersion ?? null,
        device.gpsPermission ?? null, device.cameraPermission ?? null, device.notifPermission ?? null,
        now,
      ],
    );
    await db.query(`UPDATE connect_lite_users SET "lastLoginAtMs" = $1 WHERE id = $2`, [now, u.id]);

    const session: LiteSession = {
      userId: u.id, userName: u.name, role: u.role, workshopId: u.workshopId,
      workshopName: u.workshopName, providerCompanyId: u.providerCompanyId, deviceId: ins.rows[0].id,
    };
    await auditLite({ session, req, action: "lite.login", resourceType: "lite_user", resourceId: u.id, detail: { deviceId, platform: device.platform } });

    res.json({
      token,
      user: { id: u.id, name: u.name, role: u.role, username: u.username },
      workshop: {
        id: u.workshopId, name: u.workshopName,
        latitude: u.workshopLat, longitude: u.workshopLng,
      },
      config: buildLiteConfig(u),
    });
  });

  router.use(requireLite);

  router.post("/logout", async (req, res) => {
    const s = req.liteSession!;
    await db.query(`UPDATE connect_lite_devices SET "revokedAtMs" = $1, "fcmToken" = NULL WHERE id = $2`,
      [Date.now(), s.deviceId]);
    await auditLite({ req, action: "lite.logout", resourceType: "lite_user", resourceId: s.userId });
    res.json({ ok: true });
  });

  router.get("/me", async (req, res) => {
    const s = req.liteSession!;
    const w = await db.query(
      `SELECT id, name, phone, latitude, longitude, "liteSettings", features FROM connect_workshops WHERE id = $1`,
      [s.workshopId],
    );
    const d = await db.query(
      `SELECT "deviceId", platform, "osVersion", "appVersion", "gpsPermission", "cameraPermission",
              "notifPermission", "fcmToken" IS NOT NULL AS "hasPushToken", "lastSeenAtMs", "createdAtMs"
         FROM connect_lite_devices WHERE id = $1`,
      [s.deviceId],
    );
    res.json({
      user: { id: s.userId, name: s.userName, role: s.role },
      workshop: w.rows[0],
      device: d.rows[0],
      config: buildLiteConfig(w.rows[0]),
    });
  });

  /** Catálogos y reglas que la APK necesita para validar en local. */
  router.get("/config", async (req, res) => {
    const s = req.liteSession!;
    const w = await db.query(`SELECT "liteSettings", features FROM connect_workshops WHERE id = $1`, [s.workshopId]);
    const reasons = await db.query(
      `SELECT code, label FROM connect_rejection_reasons WHERE active ORDER BY id`,
    );
    res.json({
      ...buildLiteConfig(w.rows[0]),
      statusLabels: LITE_STATUS_LABELS,
      evidenceCategories: EVIDENCE_CATEGORIES.map((code) => ({ code, label: EVIDENCE_CATEGORY_LABELS[code] })),
      serviceResults: SERVICE_RESULTS.map((code) => ({ code, label: SERVICE_RESULT_LABELS[code] })),
      rejectionReasons: reasons.rows,
      quickMessages: [
        "Voy en camino", "Tráfico intenso", "No localizo el vehículo", "Necesito más información",
        "Necesito autorización", "Necesito apoyo", "Trabajo finalizado", "Vehículo trasladado al taller",
      ],
    });
  });

  /** Registro/actualización del dispositivo: token push y estado de permisos. */
  router.post("/device", async (req, res) => {
    const s = req.liteSession!;
    const b = req.body ?? {};
    await db.query(
      `UPDATE connect_lite_devices SET
         "fcmToken" = COALESCE($1, "fcmToken"),
         platform = COALESCE($2, platform),
         "osVersion" = COALESCE($3, "osVersion"),
         "appVersion" = COALESCE($4, "appVersion"),
         "gpsPermission" = COALESCE($5, "gpsPermission"),
         "cameraPermission" = COALESCE($6, "cameraPermission"),
         "notifPermission" = COALESCE($7, "notifPermission"),
         "queuePending" = COALESCE($8, "queuePending"),
         "queueFailed" = COALESCE($9, "queueFailed"),
         "queueOldestAtMs" = CASE WHEN $8 IS NULL THEN "queueOldestAtMs" ELSE $10 END,
         "queueReportedAtMs" = CASE WHEN $8 IS NULL THEN "queueReportedAtMs" ELSE $11 END,
         "lastSeenAtMs" = $11
       WHERE id = $12`,
      [
        b.fcmToken ?? null, b.platform ?? null, b.osVersion ?? null, b.appVersion ?? null,
        b.gpsPermission ?? null, b.cameraPermission ?? null, b.notifPermission ?? null,
        // La cola sí se pisa con lo que diga la APK, incluido el cero: si se
        // usara COALESCE con el más antiguo, una cola ya vaciada seguiría
        // apareciendo como atascada para siempre.
        entero(b.queuePending), entero(b.queueFailed), entero(b.queueOldestAtMs),
        Date.now(), s.deviceId,
      ],
    );
    // El mismo token no puede quedar colgado en otros dispositivos
    if (b.fcmToken) {
      await db.query(
        `UPDATE connect_lite_devices SET "fcmToken" = NULL WHERE "fcmToken" = $1 AND id <> $2`,
        [String(b.fcmToken), s.deviceId],
      );
    }
    res.json({ ok: true });
  });

  // ── Bandeja de asistencias ───────────────────────────────────────────────

  router.get("/assistances", async (req, res) => {
    const s = req.liteSession!;
    const scope = String(req.query.scope || "active");
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const statusesByScope: Record<string, string[]> = {
      pending: ["awaiting_acceptance", "assigned"],
      active: ["assigned", "technician_assigned", "en_route", "arrived", "in_progress", "finished", "returning_to_workshop"],
      finished: ["at_workshop", "finished"],
      all: [],
    };
    const statuses = statusesByScope[scope] ?? statusesByScope.active;
    const onlyMine = s.role === "operator";

    const r = await db.query(
      `SELECT ca.*, cl.name AS "clientDisplayName"
         FROM connect_assistances ca
         LEFT JOIN connect_clients cl ON cl.id = ca."clientId"
        WHERE ca."workshopId" = $1
          AND ($2::text[] IS NULL OR ca.status = ANY($2))
          AND (NOT $3::boolean OR ca."liteUserId" IS NULL OR ca."liteUserId" = $4)
          AND ($5::text <> 'finished' OR ca."updatedAtMs" > $6)
        ORDER BY (ca.priority = 'urgente') DESC, ca."updatedAtMs" DESC
        LIMIT $7`,
      [
        s.workshopId, statuses.length ? statuses : null, onlyMine, s.userId,
        scope, Date.now() - 30 * 24 * 3600_000, limit,
      ],
    );
    res.json({ data: r.rows.map((a: any) => publicAssistance(a)) });
  });

  router.get("/assistances/:id", async (req, res) => {
    const s = req.liteSession!;
    const a = await loadAssistance(s, Number(req.params.id));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");

    const timeline = await db.query(
      `SELECT "fromStatus", "toStatus", "actorType", reason, "occurredAtMs"
         FROM connect_status_history WHERE "assistanceId" = $1 ORDER BY id`,
      [a.id],
    );
    const evidence = await assistanceEvidence(a.id);
    const distanceM = a.latitude != null && a.operatorLat != null
      ? Math.round(haversineMeters(a.operatorLat, a.operatorLng, a.latitude, a.longitude))
      : null;

    res.json({
      ...publicAssistance(a, { detail: true }),
      timeline: timeline.rows.map((t: any) => ({
        ...t,
        occurredAtMs: Number(t.occurredAtMs),
        label: (LITE_STATUS_LABELS as Record<string, string>)[t.toStatus] ?? t.toStatus,
      })),
      files: evidence.files,
      signature: evidence.signature,
      distanceM,
      etaMinutes: distanceM != null ? estimateEtaMinutes(distanceM) : null,
      tracking: {
        active: shouldTrack(a.status, buildLiteConfig(a).trackWhileWorking),
        intervalSec: trackingIntervalSec(a.status, a.operatorSpeedKmh),
      },
    });
  });

  // ── Aceptación / rechazo / asignación de operario ────────────────────────

  router.post("/assistances/:id/accept", async (req, res) => {
    const s = req.liteSession!;
    const cached = await findAction(req.body?.clientActionId);
    if (cached) return res.json(cached);

    const a = await loadAssistance(s, Number(req.params.id), { ownOnly: false });
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");

    const asg = await db.query(
      `SELECT id, status FROM connect_assignments
        WHERE "assistanceId" = $1 AND "workshopId" = $2 ORDER BY id DESC LIMIT 1`,
      [a.id, s.workshopId],
    );
    const now = Date.now();

    try {
      if (a.status === "awaiting_acceptance" && asg.rows[0]?.status === "sent") {
        // Oferta pendiente: la aceptación la consolida (misma ruta que el portal)
        await acceptAssignment(asg.rows[0].id, `${s.userName} (Lite)`);
      } else if (!["assigned", "technician_assigned"].includes(a.status)) {
        return err(res, 409, "invalid_state", `No se puede aceptar una asistencia en estado ${a.status}`);
      }
      await db.query(
        `UPDATE connect_assistances SET "acceptedAtMs" = COALESCE("acceptedAtMs", $1), "updatedAtMs" = $1 WHERE id = $2`,
        [now, a.id],
      );
      // El operario que acepta se queda el servicio salvo que sea el admin
      if (s.role === "operator") {
        await db.query(
          `UPDATE connect_assistances
              SET "liteUserId" = $1, "liteUserName" = $2, "assignedTechName" = COALESCE("assignedTechName", $2)
            WHERE id = $3 AND "liteUserId" IS NULL`,
          [s.userId, s.userName, a.id],
        );
        const fresh = await db.query(`SELECT status FROM connect_assistances WHERE id = $1`, [a.id]);
        if (fresh.rows[0]?.status === "assigned") {
          await transition(a.id, "technician_assigned", "user", `Aceptada por ${s.userName} (Lite)`);
        }
      }
    } catch (e: any) {
      if (e instanceof InvalidTransitionError) return err(res, 409, "invalid_state_transition", e.message);
      console.error("[Lite] accept:", e?.message);
      return err(res, 500, "internal_error", "No se pudo aceptar la asistencia");
    }

    await auditLite({ req, action: "lite.assistance_accepted", resourceType: "assistance", resourceId: a.id });
    const out = await loadAssistance(s, a.id, { ownOnly: false });
    const payload = publicAssistance(out, { detail: true });
    await recordAction(req.body?.clientActionId, "accept", s, a.id, payload);
    res.json(payload);
  });

  router.post("/assistances/:id/reject", async (req, res) => {
    const s = req.liteSession!;
    const cached = await findAction(req.body?.clientActionId);
    if (cached) return res.json(cached);

    const reasonCode = String(req.body?.reasonCode || "").trim();
    if (!reasonCode) return err(res, 422, "validation_failed", "Indica el motivo del rechazo");

    const a = await loadAssistance(s, Number(req.params.id), { ownOnly: false });
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");
    if (!["awaiting_acceptance", "assigned"].includes(a.status)) {
      return err(res, 409, "invalid_state", "Ya no se puede rechazar: el servicio está en curso");
    }
    const asg = await db.query(
      `SELECT id FROM connect_assignments
        WHERE "assistanceId" = $1 AND "workshopId" = $2 AND status IN ('sent','accepted')
        ORDER BY id DESC LIMIT 1`,
      [a.id, s.workshopId],
    );
    if (!asg.rows[0]) return err(res, 409, "no_assignment", "No hay una asignación activa que rechazar");

    try {
      await rejectAssignment(asg.rows[0].id, {
        reasonCode,
        comment: req.body?.notes ? String(req.body.notes).slice(0, 500) : undefined,
        actorName: `${s.userName} (Lite)`,
      });
    } catch (e: any) {
      console.error("[Lite] reject:", e?.message);
      return err(res, 409, "reject_failed", e?.message || "No se pudo rechazar");
    }
    await auditLite({ req, action: "lite.assistance_rejected", resourceType: "assistance", resourceId: a.id, detail: { reasonCode } });
    const payload = { ok: true, id: a.id, status: "rejected" };
    await recordAction(req.body?.clientActionId, "reject", s, a.id, payload);
    res.json(payload);
  });

  /** El administrador del taller asigna la asistencia a un operario. */
  router.post("/assistances/:id/assign-operator", async (req, res) => {
    const s = req.liteSession!;
    if (s.role !== "workshop_admin") return err(res, 403, "forbidden", "Solo el administrador del taller puede asignar");

    const a = await loadAssistance(s, Number(req.params.id), { ownOnly: false });
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");

    const targetId = Number(req.body?.liteUserId);
    const u = await db.query(
      `SELECT id, name FROM connect_lite_users WHERE id = $1 AND "workshopId" = $2 AND active`,
      [targetId, s.workshopId],
    );
    if (!u.rows[0]) return err(res, 404, "not_found", "Operario no encontrado en este taller");

    await db.query(
      `UPDATE connect_assistances
          SET "liteUserId" = $1, "liteUserName" = $2, "assignedTechName" = $2, "updatedAtMs" = $3
        WHERE id = $4`,
      [u.rows[0].id, u.rows[0].name, Date.now(), a.id],
    );
    if (a.status === "assigned") {
      await transition(a.id, "technician_assigned", "user", `Operario asignado: ${u.rows[0].name}`);
    }
    await notifyLiteUser(u.rows[0].id, {
      title: "Asistencia asignada",
      body: `${a.expedientNumber ?? `#${a.id}`} · ${a.address || "Abre la app para ver el detalle"}`,
      data: { type: "assistance_assigned", assistanceId: String(a.id) },
    }).catch(() => {});
    await auditLite({ req, action: "lite.operator_assigned", resourceType: "assistance", resourceId: a.id, detail: { liteUserId: targetId } });
    res.json(publicAssistance(await loadAssistance(s, a.id, { ownOnly: false }), { detail: true }));
  });

  /** Operarios del taller (para la pantalla de asignación del administrador). */
  router.get("/operators", async (req, res) => {
    const s = req.liteSession!;
    const r = await db.query(
      `SELECT u.id, u.name, u.role, u."lastLoginAtMs",
              (SELECT COUNT(*) FROM connect_assistances ca
                WHERE ca."liteUserId" = u.id
                  AND ca.status IN ('technician_assigned','en_route','arrived','in_progress','returning_to_workshop')) AS "activeCount"
         FROM connect_lite_users u
        WHERE u."workshopId" = $1 AND u.active ORDER BY u.name`,
      [s.workshopId],
    );
    res.json({ data: r.rows });
  });

  // ── Máquina de estados ───────────────────────────────────────────────────

  router.post("/assistances/:id/status", limitar("status"), async (req, res) => {
    const s = req.liteSession!;
    const cached = await findAction(req.body?.clientActionId);
    if (cached) return res.json(cached);

    const target = String(req.body?.status || "");
    const a = await loadAssistance(s, Number(req.params.id));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada o no asignada a ti");

    if (!canLiteTransition(a.status, target)) {
      return err(res, 409, "invalid_state_transition",
        `No se puede pasar de ${(LITE_STATUS_LABELS as any)[a.status] ?? a.status} a ${(LITE_STATUS_LABELS as any)[target] ?? target}`);
    }
    if (target === "finished") {
      return err(res, 422, "use_finish_endpoint", "Usa /finish para cerrar el servicio con sus requisitos");
    }

    // La posición que acompaña al cambio queda registrada como evidencia
    const point = req.body?.point;
    if (point && isValidPoint({ ...point, ts: Number(point.ts) || Date.now() })) {
      await storePoints(s, a, [{ ...point, ts: Number(point.ts) || Date.now() }]);
    }

    const deviceTs = Number(req.body?.deviceTsMs) || null;
    const note = [
      `${s.userName} (Lite)`,
      req.body?.note ? String(req.body.note).slice(0, 300) : "",
      req.body?.source === "geofence" ? "confirmado desde geovalla" : "",
      deviceTs && Math.abs(deviceTs - Date.now()) > 120_000 ? `desfase de reloj del dispositivo: ${Math.round((deviceTs - Date.now()) / 60000)} min` : "",
    ].filter(Boolean).join(" · ");

    try {
      await transition(a.id, target as any, "user", note);
    } catch (e: any) {
      if (e instanceof InvalidTransitionError) return err(res, 409, "invalid_state_transition", e.message);
      throw e;
    }

    // Al cerrar el ciclo se libera al operario y se detiene el seguimiento
    if (target === "at_workshop") {
      await db.query(`UPDATE connect_assistances SET "updatedAtMs" = $1 WHERE id = $2`, [Date.now(), a.id]);
    }

    await auditLite({
      req, action: "lite.status_changed", resourceType: "assistance", resourceId: a.id,
      detail: { from: a.status, to: target, deviceTsMs: deviceTs, source: req.body?.source ?? "manual" },
    });

    const fresh = await loadAssistance(s, a.id);
    const payload = {
      ...publicAssistance(fresh, { detail: true }),
      tracking: {
        active: shouldTrack(target, buildLiteConfig(a).trackWhileWorking),
        intervalSec: trackingIntervalSec(target, null),
      },
    };
    await recordAction(req.body?.clientActionId, "status", s, a.id, payload);
    res.json(payload);
  });

  // ── Geolocalización ──────────────────────────────────────────────────────

  router.post("/assistances/:id/location", limitar("location"), async (req, res) => {
    const s = req.liteSession!;
    const a = await loadAssistance(s, Number(req.params.id));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");
    if (!shouldTrack(a.status, buildLiteConfig(a).trackWhileWorking)) {
      return res.json({ ok: true, ignored: true, reason: "tracking_off", tracking: { active: false, intervalSec: 0 } });
    }
    const { stored, hint } = await storePoints(s, a, [{ ...req.body, ts: Number(req.body?.ts) || Date.now() }]);
    res.json({
      ok: true, stored, hint,
      tracking: { active: true, intervalSec: trackingIntervalSec(a.status, req.body?.speedKmh) },
    });
  });

  /** Lote de posiciones acumuladas sin cobertura. */
  router.post("/assistances/:id/locations-batch", limitar("locationsBatch"), async (req, res) => {
    const s = req.liteSession!;
    const a = await loadAssistance(s, Number(req.params.id));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");
    const points = Array.isArray(req.body?.points) ? req.body.points.slice(0, 500) : [];
    const { stored, hint } = await storePoints(s, a, points);
    res.json({ ok: true, stored, received: points.length, hint });
  });

  /** Registro de apertura de navegación (auditoría y análisis). */
  router.post("/assistances/:id/navigation", async (req, res) => {
    const s = req.liteSession!;
    const a = await loadAssistance(s, Number(req.params.id));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");
    await auditLite({
      req, action: "lite.navigation_opened", resourceType: "assistance", resourceId: a.id,
      detail: { app: String(req.body?.app || "default").slice(0, 30) },
    });
    res.json({ ok: true });
  });

  // ── Observaciones y mensajes ─────────────────────────────────────────────

  router.post("/assistances/:id/notes", limitar("messages"), async (req, res) => {
    const s = req.liteSession!;
    const cached = await findAction(req.body?.clientActionId);
    if (cached) return res.json(cached);

    const body = String(req.body?.body || "").trim();
    if (!body) return err(res, 422, "validation_failed", "La observación está vacía");
    const a = await loadAssistance(s, Number(req.params.id));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");

    const r = await db.query(
      `INSERT INTO connect_communications ("assistanceId", channel, direction, body, "byName", "createdAtMs")
       VALUES ($1, 'note', 'inbound', $2, $3, $4) RETURNING id, body, "byName", "createdAtMs"`,
      [a.id, body.slice(0, 2000), `${s.userName} (${s.workshopName})`, Date.now()],
    );
    await auditLite({ req, action: "lite.note_added", resourceType: "assistance", resourceId: a.id });
    publish({ kind: "status", assistanceId: a.id, status: a.status });
    const payload = r.rows[0];
    await recordAction(req.body?.clientActionId, "note", s, a.id, payload);
    res.status(201).json(payload);
  });

  router.get("/assistances/:id/messages", async (req, res) => {
    const s = req.liteSession!;
    const a = await loadAssistance(s, Number(req.params.id));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");
    const r = await db.query(
      `SELECT id, channel, direction, body, "byName", "createdAtMs"
         FROM connect_communications WHERE "assistanceId" = $1 ORDER BY id DESC LIMIT 100`,
      [a.id],
    );
    res.json({ data: r.rows });
  });

  router.post("/assistances/:id/messages", limitar("messages"), async (req, res) => {
    const s = req.liteSession!;
    const cached = await findAction(req.body?.clientActionId);
    if (cached) return res.json(cached);

    const body = String(req.body?.body || "").trim();
    if (!body) return err(res, 422, "validation_failed", "El mensaje está vacío");
    const a = await loadAssistance(s, Number(req.params.id));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");

    const r = await db.query(
      `INSERT INTO connect_communications ("assistanceId", channel, direction, body, "byName", "createdAtMs")
       VALUES ($1, 'note', 'inbound', $2, $3, $4) RETURNING id, body, "byName", "createdAtMs"`,
      [a.id, body.slice(0, 2000), `${s.userName} (${s.workshopName})`, Date.now()],
    );
    // Central lo ve en tiempo real; si pide apoyo o autorización, además avisa
    publish({ kind: "status", assistanceId: a.id, status: a.status });
    if (/autorizaci|apoyo|no localizo/i.test(body)) {
      await createAlert({
        type: "lite_message", severity: "warning",
        title: `El taller pide atención en la asistencia #${a.id}`,
        body: `${s.userName} (${s.workshopName}): ${body.slice(0, 160)}`,
        assistanceId: a.id, workshopId: s.workshopId,
      }).catch(() => {});
    }
    await auditLite({ req, action: "lite.message_sent", resourceType: "assistance", resourceId: a.id });
    const payload = r.rows[0];
    await recordAction(req.body?.clientActionId, "message", s, a.id, payload);
    res.status(201).json(payload);
  });

  // ── Evidencias ───────────────────────────────────────────────────────────

  router.post("/assistances/:id/files", limitar("files"), upload.single("file"), async (req, res) => {
    const s = req.liteSession!;
    const cached = await findAction(req.body?.clientActionId);
    if (cached) return res.json(cached);

    const a = await loadAssistance(s, Number(req.params.id));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");
    if (!req.file) return err(res, 400, "no_file", "No se recibió ningún archivo");
    if (!ALLOWED_IMAGE_MIME.has(req.file.mimetype)) {
      return err(res, 415, "unsupported_media", "Formato no admitido (usa JPG, PNG o WEBP)");
    }
    const category = EVIDENCE_CATEGORIES.includes(String(req.body?.category))
      ? String(req.body.category) : "other";

    let buffer: Buffer;
    try {
      // Normaliza, reorienta y comprime: el original del móvil es innecesariamente grande
      buffer = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch {
      return err(res, 422, "invalid_image", "El archivo no es una imagen válida");
    }

    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const storagePath = `connect-lite/${a.id}/${category}_${Date.now()}_${hash.slice(0, 8)}.jpg`;
    const { error: upErr } = await supabase.storage
      .from(SUPABASE_ROADSIDE_BUCKET)
      .upload(storagePath, buffer, { contentType: "image/jpeg", upsert: false });
    if (upErr) {
      console.error("[Lite] subida evidencia:", upErr.message);
      return err(res, 502, "upload_failed", "No se pudo guardar la fotografía; reintenta");
    }
    const { data: pub } = supabase.storage.from(SUPABASE_ROADSIDE_BUCKET).getPublicUrl(storagePath);

    const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
    const r = await db.query(
      `INSERT INTO connect_assistance_files
         ("assistanceId", "workshopId", "liteUserId", category, url, "storagePath", "fileName",
          "mimeType", "sizeBytes", sha256, lat, lng, "deviceTsMs", "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$7,'image/jpeg',$8,$9,$10,$11,$12,$13)
       RETURNING id, category, url, "fileName", "sizeBytes", "createdAtMs"`,
      [
        a.id, s.workshopId, s.userId, category, pub.publicUrl, storagePath,
        String(req.file.originalname || "foto.jpg").slice(0, 120), buffer.length, hash,
        Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null,
        Number(req.body?.deviceTsMs) || null, Date.now(),
      ],
    );
    await auditLite({ req, action: "lite.evidence_added", resourceType: "assistance", resourceId: a.id, detail: { category, sha256: hash } });
    publish({ kind: "status", assistanceId: a.id, status: a.status });
    const payload = r.rows[0];
    await recordAction(req.body?.clientActionId, "file", s, a.id, payload);
    res.status(201).json(payload);
  });

  router.get("/assistances/:id/files", async (req, res) => {
    const s = req.liteSession!;
    const a = await loadAssistance(s, Number(req.params.id));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");
    res.json(await assistanceEvidence(a.id));
  });

  /** Borrado lógico: solo el autor y solo antes de finalizar el servicio. */
  router.delete("/assistances/:id/files/:fileId", async (req, res) => {
    const s = req.liteSession!;
    const a = await loadAssistance(s, Number(req.params.id));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");
    if (["finished", "returning_to_workshop", "at_workshop"].includes(a.status)) {
      return err(res, 409, "closed", "El servicio ya está cerrado: la evidencia no se puede eliminar");
    }
    const r = await db.query(
      `UPDATE connect_assistance_files SET "deletedAtMs" = $1
        WHERE id = $2 AND "assistanceId" = $3 AND "liteUserId" = $4 AND "deletedAtMs" IS NULL
        RETURNING id`,
      [Date.now(), Number(req.params.fileId), a.id, s.userId],
    );
    if (!r.rows[0]) return err(res, 404, "not_found", "Evidencia no encontrada");
    await auditLite({ req, action: "lite.evidence_deleted", resourceType: "assistance", resourceId: a.id, detail: { fileId: Number(req.params.fileId) } });
    res.json({ ok: true });
  });

  // ── Firma ────────────────────────────────────────────────────────────────

  router.post("/assistances/:id/signature", limitar("signature"), async (req, res) => {
    const s = req.liteSession!;
    const cached = await findAction(req.body?.clientActionId);
    if (cached) return res.json(cached);

    const a = await loadAssistance(s, Number(req.params.id));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");

    const signerName = String(req.body?.signerName || "").trim();
    const imageBase64 = String(req.body?.imageBase64 || "").replace(/^data:image\/\w+;base64,/, "");
    if (!signerName) return err(res, 422, "validation_failed", "Indica el nombre del firmante");
    if (!imageBase64) return err(res, 422, "validation_failed", "Falta la imagen de la firma");
    if (req.body?.consentAccepted === false) {
      return err(res, 422, "consent_required", "El firmante debe aceptar el consentimiento");
    }

    let buffer: Buffer;
    try {
      buffer = await sharp(Buffer.from(imageBase64, "base64")).png().toBuffer();
    } catch {
      return err(res, 422, "invalid_image", "La firma no es una imagen válida");
    }
    const storagePath = `connect-lite/${a.id}/firma_${Date.now()}.png`;
    const { error: upErr } = await supabase.storage
      .from(SUPABASE_ROADSIDE_BUCKET)
      .upload(storagePath, buffer, { contentType: "image/png", upsert: false });
    if (upErr) {
      console.error("[Lite] subida firma:", upErr.message);
      return err(res, 502, "upload_failed", "No se pudo guardar la firma; reintenta");
    }
    const { data: pub } = supabase.storage.from(SUPABASE_ROADSIDE_BUCKET).getPublicUrl(storagePath);
    const now = Date.now();
    const lat = Number(req.body?.lat), lng = Number(req.body?.lng);

    const r = await db.query(
      `INSERT INTO connect_assistance_signatures
         ("assistanceId", "workshopId", "liteUserId", "signerName", "signerDocument", "consentText",
          "consentAccepted", url, "storagePath", lat, lng, "signedAtMs", "createdAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$11)
       RETURNING id, "signerName", url, "signedAtMs"`,
      [
        a.id, s.workshopId, s.userId, signerName.slice(0, 120),
        req.body?.signerDocument ? String(req.body.signerDocument).slice(0, 40) : null,
        req.body?.consentText ? String(req.body.consentText).slice(0, 1000) : null,
        pub.publicUrl, storagePath,
        Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null,
        Number(req.body?.signedAtMs) || now,
      ],
    );
    await auditLite({ req, action: "lite.signature_added", resourceType: "assistance", resourceId: a.id, detail: { signerName } });
    const payload = r.rows[0];
    await recordAction(req.body?.clientActionId, "signature", s, a.id, payload);
    res.status(201).json(payload);
  });

  // ── Finalización ─────────────────────────────────────────────────────────

  router.post("/assistances/:id/finish", async (req, res) => {
    const s = req.liteSession!;
    const cached = await findAction(req.body?.clientActionId);
    if (cached) return res.json(cached);

    const a = await loadAssistance(s, Number(req.params.id));
    if (!a) return err(res, 404, "not_found", "Asistencia no encontrada");
    if (!canLiteTransition(a.status, "finished")) {
      return err(res, 409, "invalid_state_transition", `No se puede finalizar desde ${a.status}`);
    }

    const config = buildLiteConfig(a);
    const evidence = await assistanceEvidence(a.id);
    const errors = validateFinish(config.finishRules, {
      result: req.body?.result,
      resolutionNotes: req.body?.resolutionNotes,
      odometerKm: req.body?.odometerKm,
      signature: evidence.signature ? { signerName: evidence.signature.signerName } : null,
      photos: evidence.files.map((f: any) => ({ category: f.category })),
    });
    if (errors.length) {
      return err(res, 422, "finish_requirements", "Faltan requisitos para cerrar el servicio", errors);
    }

    const point = req.body?.point;
    if (point && isValidPoint({ ...point, ts: Number(point.ts) || Date.now() })) {
      await storePoints(s, a, [{ ...point, ts: Number(point.ts) || Date.now() }]);
    }

    const now = Date.now();
    await db.query(
      `UPDATE connect_assistances
          SET "resultCode" = $1, "resolutionNotes" = $2, "odometerKm" = $3, "workedMinutes" = $4, "updatedAtMs" = $5
        WHERE id = $6`,
      [
        String(req.body?.result || "other").slice(0, 40),
        req.body?.resolutionNotes ? String(req.body.resolutionNotes).slice(0, 2000) : null,
        Number.isFinite(Number(req.body?.odometerKm)) ? Math.round(Number(req.body.odometerKm)) : null,
        Number.isFinite(Number(req.body?.workedMinutes)) ? Math.round(Number(req.body.workedMinutes)) : null,
        now, a.id,
      ],
    );
    try {
      await transition(a.id, "finished", "user",
        `Finalizada por ${s.userName} (Lite) · ${SERVICE_RESULT_LABELS[String(req.body?.result)] ?? "resultado no especificado"}`);
    } catch (e: any) {
      if (e instanceof InvalidTransitionError) return err(res, 409, "invalid_state_transition", e.message);
      throw e;
    }
    await auditLite({
      req, action: "lite.assistance_finished", resourceType: "assistance", resourceId: a.id,
      detail: { result: req.body?.result, photos: evidence.files.length, signed: !!evidence.signature },
    });

    const fresh = await loadAssistance(s, a.id);
    const payload = {
      ...publicAssistance(fresh, { detail: true }),
      // El seguimiento se detiene salvo que el operario indique vuelta al taller
      tracking: { active: false, intervalSec: 0 },
      kpis: await assistanceKpis(a.id),
    };
    await recordAction(req.body?.clientActionId, "finish", s, a.id, payload);
    res.json(payload);
  });

  // ── Cola offline ─────────────────────────────────────────────────────────

  /**
   * Sincroniza operaciones acumuladas sin conexión. Cada una lleva su
   * clientActionId, así que reenviar el lote entero es seguro.
   * Las fotos y firmas viajan por sus endpoints (multipart/base64) con el
   * mismo mecanismo de idempotencia.
   */
  router.post("/sync", limitar("sync"), async (req, res) => {
    const s = req.liteSession!;
    const ops = Array.isArray(req.body?.operations) ? req.body.operations.slice(0, 100) : [];
    const results: any[] = [];

    for (const op of ops) {
      const opId = String(op?.clientActionId || "").trim();
      const kind = String(op?.kind || "");
      const assistanceId = Number(op?.assistanceId);
      try {
        const cached = await findAction(opId);
        if (cached) { results.push({ clientActionId: opId, status: "duplicate", result: cached }); continue; }

        const a = await loadAssistance(s, assistanceId);
        if (!a) { results.push({ clientActionId: opId, status: "rejected", error: "not_found" }); continue; }

        if (kind === "status") {
          if (!canLiteTransition(a.status, String(op.status))) {
            // Conflicto real: el estado oficial ya no admite ese cambio
            liteMetrics.recordConflict(s.workshopId);
            results.push({
              clientActionId: opId, status: "conflict",
              officialStatus: a.status, requested: op.status,
            });
            continue;
          }
          await transition(a.id, op.status, "user", `${s.userName} (Lite, offline)`);
          await recordAction(opId, "status", s, a.id, { ok: true, status: op.status });
          results.push({ clientActionId: opId, status: "applied" });
        } else if (kind === "note") {
          const r = await db.query(
            `INSERT INTO connect_communications ("assistanceId", channel, direction, body, "byName", "createdAtMs")
             VALUES ($1,'note','inbound',$2,$3,$4) RETURNING id`,
            [a.id, String(op.body || "").slice(0, 2000), `${s.userName} (${s.workshopName})`, Number(op.tsMs) || Date.now()],
          );
          await recordAction(opId, "note", s, a.id, r.rows[0]);
          results.push({ clientActionId: opId, status: "applied" });
        } else if (kind === "locations") {
          const { stored } = await storePoints(s, a, Array.isArray(op.points) ? op.points.slice(0, 500) : []);
          await recordAction(opId, "locations", s, a.id, { stored });
          results.push({ clientActionId: opId, status: "applied", stored });
        } else {
          results.push({ clientActionId: opId, status: "rejected", error: "unknown_kind" });
        }
      } catch (e: any) {
        console.error("[Lite] sync op:", e?.message);
        results.push({ clientActionId: opId, status: "error", error: e?.message ?? "error" });
      }
    }

    // Estado oficial de las asistencias implicadas para que la APK reconcilie
    const ids = [...new Set(ops.map((o: any) => Number(o?.assistanceId)).filter(Boolean))];
    const official = ids.length
      ? (await db.query(
          `SELECT id, status, "updatedAtMs" FROM connect_assistances WHERE id = ANY($1::int[]) AND "workshopId" = $2`,
          [ids, s.workshopId],
        )).rows
      : [];
    await auditLite({ req, action: "lite.sync", detail: { operations: ops.length, conflicts: results.filter((r) => r.status === "conflict").length } });
    res.json({ results, official });
  });

  // ── Historial y KPIs propios ─────────────────────────────────────────────

  router.get("/history", async (req, res) => {
    const s = req.liteSession!;
    const days = Math.min(Number(req.query.days) || 30, 180);
    const r = await db.query(
      `SELECT ca.id, ca."expedientNumber", ca.status, ca."serviceType", ca.address,
              ca."liteUserName", ca."resultCode", ca."createdAtMs", ca."updatedAtMs"
         FROM connect_assistances ca
        WHERE ca."workshopId" = $1 AND ca."updatedAtMs" > $2
          AND ca.status IN ('finished','at_workshop','cancelled')
          AND (NOT $3::boolean OR ca."liteUserId" = $4)
        ORDER BY ca."updatedAtMs" DESC LIMIT 200`,
      [s.workshopId, Date.now() - days * 24 * 3600_000, s.role === "operator", s.userId],
    );
    res.json({ data: r.rows });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Retención
// ---------------------------------------------------------------------------

/** Días que se guarda el resultado de una operación para poder reenviarla. */
export const LITE_ACTIONS_RETENTION_DAYS = 30;

/**
 * `connect_lite_actions` guarda la respuesta completa de cada operación para
 * que reenviarla sea idempotente, y esa respuesta incluye datos del cliente
 * (nombre y teléfono del solicitante). Su única razón de ser es que una APK sin
 * cobertura pueda reintentar, cosa que ocurre en horas, no en meses: dejarlo
 * crecer para siempre era guardar datos personales sin motivo.
 */
export async function purgeLiteActions(now = Date.now()): Promise<number> {
  const corte = now - LITE_ACTIONS_RETENTION_DAYS * 24 * 3600_000;
  const r = await db.query(
    `DELETE FROM connect_lite_actions WHERE "createdAtMs" < $1`,
    [corte],
  );
  return r.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// KPIs (se usan también desde el backoffice de Central Pro)
// ---------------------------------------------------------------------------

export async function assistanceKpis(assistanceId: number) {
  const h = await db.query(
    `SELECT "toStatus", "occurredAtMs" FROM connect_status_history WHERE "assistanceId" = $1 ORDER BY id`,
    [assistanceId],
  );
  const a = await db.query(
    `SELECT "acceptedAtMs", "slaDeadlineAtMs" FROM connect_assistances WHERE id = $1`,
    [assistanceId],
  );
  return computeLiteKpis(
    h.rows.map((r: any) => ({ toStatus: r.toStatus, occurredAtMs: Number(r.occurredAtMs) })),
    {
      acceptedAtMs: a.rows[0]?.acceptedAtMs ? Number(a.rows[0].acceptedAtMs) : null,
      slaDeadlineAtMs: a.rows[0]?.slaDeadlineAtMs ? Number(a.rows[0].slaDeadlineAtMs) : null,
    },
  );
}
