/**
 * Connect Pro — worker periódico:
 *  1. Sincroniza estados core → Connect (polling ligero sobre asistencias enlazadas).
 *  2. Entrega webhooks pendientes con reintentos.
 *
 * Mismo patrón que startLicenseWorker / IntegrationWorker.
 */

import { syncFromCore, expireOfferedAssignments } from "./service.ts";
import { deliverPendingWebhooks, enqueueWebhookEvent } from "./webhooks.ts";
import { computeWorkshopScores, notifySlaEvents, detectAnomalies } from "./score.ts";
import { syncMobileUnits } from "./mobileunits.ts";
import { storeDailyKpiSnapshot, predictDemand, backfillDemandActuals, generateRecommendations } from "./intelligence.ts";
import { purgeLiteActions } from "./lite.ts";
import { pasadaDeCierreAutomatico } from "./pricing/cierreAutomatico.ts";

const TICK_MS = 15_000;
const SCORE_EVERY_TICKS = 20; // recalcular el score cada ~5 min
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let tick = 0;

export async function runConnectChecksOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const changed = await syncFromCore();
    if (changed > 0) console.log(`[Connect] worker: ${changed} asistencia(s) sincronizadas desde el core`);
    const expired = await expireOfferedAssignments();
    if (expired > 0) console.log(`[Connect] worker: ${expired} oferta(s) expiradas → cascada`);
    await notifySlaEvents(enqueueWebhookEvent);
    if (tick % 2 === 0) await syncMobileUnits(); // cada ~30 s
    if (tick++ % SCORE_EVERY_TICKS === 0) {
      const scored = await computeWorkshopScores();
      if (scored > 0) console.log(`[Connect] worker: score recalculado para ${scored} taller(es)`);
      const anomalies = await detectAnomalies();
      if (anomalies > 0) console.log(`[Connect] worker: ${anomalies} anomalía(s) de red detectadas`);
      // Inteligencia operacional: snapshot diario, precisión de demanda y recomendaciones
      await storeDailyKpiSnapshot();
      await backfillDemandActuals();
      const recs = await generateRecommendations();
      if (recs > 0) console.log(`[Connect] worker: ${recs} recomendación(es) de IA generadas`);
    }
    if (tick % 240 === 3) await predictDemand(); // predicción de demanda cada hora
    if (tick % 240 === 7) {
      // Caducidad de las operaciones idempotentes de Lite, una vez por hora
      const purgadas = await purgeLiteActions();
      if (purgadas > 0) console.log(`[Connect] worker: ${purgadas} operación(es) de Lite caducadas`);
    }
    if (tick % 40 === 11) {
      /*
       * Cierre automático de tarifas, cada ~10 min. No hace nada salvo que
       * alguna central lo haya encendido en Configuración: de fábrica está
       * apagado y el cierre lo dispara una persona.
       */
      const cierre = await pasadaDeCierreAutomatico();
      if (cierre.cerradas > 0 || cierre.fallidas > 0) {
        console.log(`[Pricing] cierre automático: ${cierre.cerradas} cerrada(s), ` +
          `${cierre.fallidas} con error, en ${cierre.centros} central(es)`);
      }
    }
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
