/**
 * Connect Pro — webhooks salientes hacia los partners.
 *
 * Entrega at-least-once: los eventos se encolan en connect_webhook_deliveries
 * y el worker los entrega con firma HMAC-SHA256 y backoff exponencial.
 */

import crypto from "node:crypto";
import db from "../db.ts";

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 86_400_000];

/** Encola un evento para todos los endpoints activos del partner que lo escuchan. */
export async function enqueueWebhookEvent(
  partnerId: number,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  const now = Date.now();
  const endpoints = await db.query(
    `SELECT id, "eventTypes" FROM connect_webhook_endpoints WHERE "partnerId" = $1 AND status = 'active'`,
    [partnerId],
  );
  const payload = JSON.stringify({
    id: `evt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
    type: eventType,
    occurred_at: new Date(now).toISOString(),
    data,
  });
  for (const ep of endpoints.rows) {
    const types: string[] = JSON.parse(ep.eventTypes || '["*"]');
    if (!types.includes("*") && !types.includes(eventType)) continue;
    await db.query(
      `INSERT INTO connect_webhook_deliveries ("endpointId", "eventType", payload, "nextRetryAtMs", "createdAtMs")
       VALUES ($1, $2, $3, $4, $4)`,
      [ep.id, eventType, payload, now],
    );
  }
}

/** Entrega las entregas pendientes vencidas. Devuelve cuántas procesó. */
export async function deliverPendingWebhooks(): Promise<number> {
  const now = Date.now();
  const pending = await db.query(
    `SELECT d.*, e.url, e.secret
       FROM connect_webhook_deliveries d
       JOIN connect_webhook_endpoints e ON e.id = d."endpointId"
      WHERE d.status = 'pending' AND d."nextRetryAtMs" <= $1 AND e.status = 'active'
      ORDER BY d.id
      LIMIT 25`,
    [now],
  );
  for (const d of pending.rows) {
    const attempt = d.attempt + 1;
    try {
      const ts = Math.floor(Date.now() / 1000);
      const signature = crypto.createHmac("sha256", d.secret).update(`${ts}.${d.payload}`).digest("hex");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const resp = await fetch(d.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Mobilink-Event": d.eventType,
          "X-Mobilink-Delivery": String(d.id),
          "X-Mobilink-Signature": `t=${ts},v1=${signature}`,
        },
        body: d.payload,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (resp.ok) {
        await db.query(
          `UPDATE connect_webhook_deliveries
              SET status = 'delivered', attempt = $1, "responseCode" = $2, "deliveredAtMs" = $3
            WHERE id = $4`,
          [attempt, resp.status, Date.now(), d.id],
        );
      } else {
        await scheduleRetry(d.id, attempt, `HTTP ${resp.status}`, resp.status);
      }
    } catch (err: any) {
      await scheduleRetry(d.id, attempt, err?.message || "network error", null);
    }
  }
  return pending.rows.length;
}

async function scheduleRetry(id: number, attempt: number, error: string, code: number | null) {
  if (attempt >= RETRY_DELAYS_MS.length) {
    await db.query(
      `UPDATE connect_webhook_deliveries SET status = 'dead', attempt = $1, "lastError" = $2, "responseCode" = $3 WHERE id = $4`,
      [attempt, error, code, id],
    );
  } else {
    await db.query(
      `UPDATE connect_webhook_deliveries
          SET attempt = $1, "lastError" = $2, "responseCode" = $3, "nextRetryAtMs" = $4
        WHERE id = $5`,
      [attempt, error, code, Date.now() + RETRY_DELAYS_MS[attempt], id],
    );
  }
}
