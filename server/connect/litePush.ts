/**
 * Mobilink Assist Lite — avisos push a los dispositivos del taller.
 *
 * Regla de privacidad: la notificación solo lleva identificadores y datos no
 * sensibles (expediente, localidad). El detalle completo se descarga cuando el
 * usuario abre la app ya autenticado.
 */

import db from "../db.ts";
import { sendPushToTokens, type PushMessage } from "../core/push.ts";

async function dropInvalidTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db.query(
    `UPDATE connect_lite_devices SET "fcmToken" = NULL WHERE "fcmToken" = ANY($1::text[])`,
    [tokens],
  ).catch(() => {});
}

/** Envía a todos los dispositivos activos de un taller Lite. */
export async function notifyLiteWorkshop(workshopId: number, msg: PushMessage): Promise<void> {
  const r = await db.query(
    `SELECT d."fcmToken" FROM connect_lite_devices d
       JOIN connect_lite_users u ON u.id = d."userId"
      WHERE d."workshopId" = $1 AND d."revokedAtMs" IS NULL
        AND d."fcmToken" IS NOT NULL AND u.active`,
    [workshopId],
  );
  const res = await sendPushToTokens(r.rows.map((x: any) => x.fcmToken), msg);
  await dropInvalidTokens(res.invalidTokens);
}

/** Envía a los dispositivos de un operario concreto. */
export async function notifyLiteUser(userId: number, msg: PushMessage): Promise<void> {
  const r = await db.query(
    `SELECT "fcmToken" FROM connect_lite_devices
      WHERE "userId" = $1 AND "revokedAtMs" IS NULL AND "fcmToken" IS NOT NULL`,
    [userId],
  );
  const res = await sendPushToTokens(r.rows.map((x: any) => x.fcmToken), msg);
  await dropInvalidTokens(res.invalidTokens);
}
