/**
 * Connect Pro — worker periódico:
 *  1. Sincroniza estados core → Connect (polling ligero sobre asistencias enlazadas).
 *  2. Entrega webhooks pendientes con reintentos.
 *
 * Mismo patrón que startLicenseWorker / IntegrationWorker.
 */

import { syncFromCore, expireOfferedAssignments } from "./service.ts";
import { deliverPendingWebhooks } from "./webhooks.ts";

const TICK_MS = 15_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runConnectChecksOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const changed = await syncFromCore();
    if (changed > 0) console.log(`[Connect] worker: ${changed} asistencia(s) sincronizadas desde el core`);
    const expired = await expireOfferedAssignments();
    if (expired > 0) console.log(`[Connect] worker: ${expired} oferta(s) expiradas → cascada`);
    await deliverPendingWebhooks();
  } catch (err: any) {
    console.error("[Connect] worker error:", err?.message);
  } finally {
    running = false;
  }
}

export function startConnectWorker(): void {
  if (timer) return;
  timer = setInterval(runConnectChecksOnce, TICK_MS);
  console.log(`Connect Pro: worker iniciado (cada ${TICK_MS / 1000} s)`);
}

export function stopConnectWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
