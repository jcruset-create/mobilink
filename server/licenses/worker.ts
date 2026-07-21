/**
 * Mobilink Assist — módulo de licencias: automatismos.
 *
 * Proceso periódico (cada hora) que:
 * - recalcula estados (active → expiring → grace_period → expired) y bloquea
 *   el acceso cuando corresponde (el bloqueo lo aplica /validate al leer el estado);
 * - detecta licencias próximas al vencimiento y registra avisos a 180/90/30/7/0
 *   días en license_notifications (una sola vez por ciclo de caducidad).
 */

import db from "../db.ts";
import { refreshLicenseStatus, NOTICE_DAYS } from "./service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

export async function runLicenseChecksOnce(): Promise<void> {
  const r = await db.query(
    `SELECT * FROM licenses WHERE status NOT IN ('cancelled') AND "expiresAtMs" IS NOT NULL`
  );
  const now = Date.now();

  for (const row of r.rows) {
    // 1) Transiciones de estado automáticas (incluye bloqueo al expirar)
    const lic = await refreshLicenseStatus(row);

    // 2) Avisos de vencimiento
    if (lic.status === "suspended" || lic.expiresAtMs == null) continue;
    const daysLeft = Math.ceil((lic.expiresAtMs - now) / DAY_MS);
    for (const notice of NOTICE_DAYS) {
      // Se avisa cuando quedan <= N días (y aún no se envió el aviso de ese umbral)
      if (daysLeft > notice) continue;
      const inserted = await db.query(
        `INSERT INTO license_notifications ("licenseId", "daysBefore", "expiresAtMs", "sentAtMs", channel)
         VALUES ($1,$2,$3,$4,'log')
         ON CONFLICT ("licenseId", "daysBefore", "expiresAtMs") DO NOTHING
         RETURNING id`,
        [lic.id, notice, lic.expiresAtMs, now]
      );
      if (inserted.rows.length) {
        console.log(
          `Licencia #${lic.id} (${lic.customerName}): aviso de vencimiento a ${notice} días (quedan ${daysLeft})`
        );
      }
    }
  }
}

export function startLicenseWorker(): void {
  if (timer) return;
  void runLicenseChecksOnce().catch((e) => console.error("License worker error:", e));
  timer = setInterval(
    () => void runLicenseChecksOnce().catch((e) => console.error("License worker error:", e)),
    INTERVAL_MS
  );
  console.log("Licencias: worker de vencimientos iniciado (cada 60 min)");
}

export function stopLicenseWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
