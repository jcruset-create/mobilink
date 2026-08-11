/**
 * Mobilink Assist Lite — avisos push a los dispositivos del taller.
 *
 * Regla de privacidad: la notificación solo lleva identificadores y datos no
 * sensibles (expediente, localidad). El detalle completo se descarga cuando el
 * usuario abre la app ya autenticado.
 */

import db from "../db.ts";
import { sendPushToTokens, type PushMessage } from "../core/push.ts";
import { liteMetrics } from "./liteMetrics.ts";

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
  await enviar(r.rows.map((x: any) => x.fcmToken), msg);
}

/** Envía a los dispositivos de un operario concreto. */
export async function notifyLiteUser(userId: number, msg: PushMessage): Promise<void> {
  const r = await db.query(
    `SELECT "fcmToken" FROM connect_lite_devices
      WHERE "userId" = $1 AND "revokedAtMs" IS NULL AND "fcmToken" IS NOT NULL`,
    [userId],
  );
  await enviar(r.rows.map((x: any) => x.fcmToken), msg);
}

/**
 * Envío común: manda, limpia los tokens que FCM ya no reconoce y deja la cuenta
 * en las métricas. Un aviso que no llega a ningún dispositivo es un fallo
 * operativo real —el operario no se entera del servicio— y hasta ahora no se
 * veía en ninguna parte.
 */
async function enviar(tokens: string[], msg: PushMessage): Promise<void> {
  const destinos = tokens.filter((t) => typeof t === "string" && t.trim().length > 0);
  const res = await sendPushToTokens(destinos, msg);
  liteMetrics.recordPush(destinos.length, res.sent, res.invalidTokens.length);
  await dropInvalidTokens(res.invalidTokens);
}
