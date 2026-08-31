/**
 * Connect Pro — webhooks salientes hacia los partners.
 *
 * Entrega at-least-once: los eventos se encolan en connect_webhook_deliveries
 * y el worker los entrega con firma HMAC-SHA256 y backoff exponencial.
 */

import crypto from "node:crypto";
import type { PoolClient } from "pg";
import db from "../db.ts";
import { createAlert } from "./alerts.ts";

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 86_400_000];

/**
 * Encola un evento para los endpoints activos del partner que lo escuchan.
 *
 * `connect_webhook_deliveries` ES el outbox: la fila se escribe aquí y quien
 * entrega es el worker, fuera de la petición y con reintentos. No hace falta
 * otra tabla ni otro servicio.
 *
 * Lo que sí hacía falta es poder escribirla DENTRO de la transacción que
 * provoca el evento (ver `enqueueWebhookEventEnTransaccion`): si el cambio de
 * estado cuaja y el aviso no, el otro sistema se queda esperando algo que ya
 * pasó y nadie lo sabe hasta que llama el cliente.
 */
export async function enqueueWebhookEvent(
  partnerId: number,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  await encolar(db, partnerId, eventType, data);
}

/**
 * La misma cola, dentro de la transacción de quien llama.
 *
 * Es el patrón Transactional Outbox, y aquí lo que garantiza es exactamente
 * esto: **o cambia el estado y sale el aviso, o no cambia nada**. No existe
 * ningún instante en el que Central sepa de un cambio que Assist nunca va a
 * recibir.
 *
 * Puede lanzar, a diferencia de la versión suelta, y así tiene que ser: si el
 * aviso no se puede encolar, el cambio de estado se deshace con él.
 */
export async function enqueueWebhookEventEnTransaccion(
  cliente: PoolClient,
  partnerId: number,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  await encolar(cliente, partnerId, eventType, data);
}

type Ejecutor = { query: (texto: string, params?: unknown[]) => Promise<{ rows: any[] }> };

async function encolar(
  ejecutor: Ejecutor,
  partnerId: number,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  const now = Date.now();
  const endpoints = await ejecutor.query(
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
    await ejecutor.query(
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
    await createAlert({
      type: "webhook_dead", severity: "warning",
      title: `Webhook agotó los reintentos (entrega #${id})`,
      body: error,
    });
  } else {
    await db.query(
      `UPDATE connect_webhook_deliveries
          SET attempt = $1, "lastError" = $2, "responseCode" = $3, "nextRetryAtMs" = $4
        WHERE id = $5`,
      [attempt, error, code, Date.now() + RETRY_DELAYS_MS[attempt], id],
    );
  }
}
