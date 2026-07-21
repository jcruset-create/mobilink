/**
 * Mobilink Assist — módulo de licencias: lógica de negocio.
 *
 * - Claves de activación firmadas con HMAC-SHA256 (LICENSE_SECRET).
 * - Máquina de estados: pending → active → expiring → grace_period → expired,
 *   con suspended y cancelled como estados manuales.
 * - Caducidad automática a los 4 años de la activación.
 * - Todo cambio queda registrado en license_history (auditoría).
 */

import crypto from "crypto";
import db from "../db.ts";

export const LICENSE_YEARS = 4;
export const NOTICE_DAYS = [180, 90, 30, 7, 0];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Estados válidos de una licencia. */
export const LICENSE_STATUSES = [
  "pending",
  "active",
  "expiring",
  "grace_period",
  "expired",
  "suspended",
  "cancelled",
] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

/** Estados en los que el servicio queda bloqueado. */
const BLOCKED_STATUSES = new Set<LicenseStatus>(["expired", "suspended", "cancelled", "pending"]);

function licenseSecret(): string {
  // Derivado de la BD si no hay secreto propio, para no romper en despliegues antiguos
  return process.env.LICENSE_SECRET || crypto
    .createHash("sha256")
    .update(`mobilink-licenses:${process.env.DATABASE_URL ?? "local"}`)
    .digest("hex");
}

/** Firma criptográficamente los datos inmutables de la licencia. */
export function signLicense(uuid: string): string {
  return crypto.createHmac("sha256", licenseSecret()).update(uuid).digest("hex").slice(0, 40);
}

/** Genera la clave de activación (uuid + firma), resistente a manipulación. */
export function buildActivationKey(uuid: string): string {
  const sig = signLicense(uuid);
  return `MBLK-${uuid.replace(/-/g, "").slice(0, 12).toUpperCase()}-${sig.slice(0, 16).toUpperCase()}`;
}

/** Verifica que una clave corresponde al uuid y no ha sido manipulada. */
export function verifyActivationKey(uuid: string, key: string): boolean {
  const expected = buildActivationKey(uuid);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(key || "").padEnd(expected.length).slice(0, expected.length)));
}

/** Registra una operación en el historial de auditoría. */
export async function logLicenseAction(
  licenseId: number,
  action: string,
  detail: string | null,
  performedBy: string | null
): Promise<void> {
  await db.query(
    `INSERT INTO license_history ("licenseId", action, detail, "performedBy", "createdAtMs")
     VALUES ($1, $2, $3, $4, $5)`,
    [licenseId, action, detail, performedBy, Date.now()]
  );
  console.log(`Licencia #${licenseId}: ${action}${detail ? ` (${detail})` : ""}${performedBy ? ` por ${performedBy}` : ""}`);
}

export function normalizeLicenseRow(row: any) {
  let modules: string[] = [];
  try { modules = JSON.parse(row.modules || "[]"); } catch { /* modules corruptos */ }
  const expiresAtMs = row.expiresAtMs != null ? Number(row.expiresAtMs) : null;
  const daysLeft = expiresAtMs != null ? Math.ceil((expiresAtMs - Date.now()) / DAY_MS) : null;
  return {
    id: row.id,
    uuid: row.uuid,
    customerName: row.customerName,
    companyName: row.companyName,
    plan: row.plan,
    status: row.status as LicenseStatus,
    activatedAtMs: row.activatedAtMs != null ? Number(row.activatedAtMs) : null,
    expiresAtMs,
    daysLeft,
    graceDays: Number(row.graceDays),
    maxUsers: Number(row.maxUsers),
    maxDevices: Number(row.maxDevices),
    aiMonthlyLimit: Number(row.aiMonthlyLimit),
    modules,
    activationKey: row.activationKey,
    notes: row.notes ?? null,
    blocked: BLOCKED_STATUSES.has(row.status),
    createdAtMs: Number(row.createdAtMs),
    updatedAtMs: Number(row.updatedAtMs),
  };
}

/** Calcula el estado que corresponde a una licencia según sus fechas. */
export function computeStatus(license: {
  status: LicenseStatus;
  expiresAtMs: number | null;
  graceDays: number;
}): LicenseStatus {
  // Estados manuales o sin fechas: no se tocan
  if (["pending", "suspended", "cancelled"].includes(license.status)) return license.status;
  if (license.expiresAtMs == null) return license.status;

  const now = Date.now();
  const graceEnd = license.expiresAtMs + license.graceDays * DAY_MS;
  if (now >= graceEnd) return "expired";
  if (now >= license.expiresAtMs) return license.graceDays > 0 ? "grace_period" : "expired";
  if (now >= license.expiresAtMs - 30 * DAY_MS) return "expiring";
  return "active";
}

/** Aplica el estado calculado si difiere del guardado; devuelve el estado final. */
export async function refreshLicenseStatus(row: any): Promise<any> {
  const lic = normalizeLicenseRow(row);
  const next = computeStatus(lic);
  if (next !== lic.status) {
    await db.query(`UPDATE licenses SET status = $2, "updatedAtMs" = $3 WHERE id = $1`, [lic.id, next, Date.now()]);
    await logLicenseAction(lic.id, "status_auto", `${lic.status} -> ${next}`, "sistema");
    lic.status = next;
    lic.blocked = BLOCKED_STATUSES.has(next);
  }
  return lic;
}

/** Fecha de caducidad estándar: activación + 4 años. */
export function expiryFromActivation(activatedAtMs: number): number {
  const d = new Date(activatedAtMs);
  d.setFullYear(d.getFullYear() + LICENSE_YEARS);
  return d.getTime();
}
