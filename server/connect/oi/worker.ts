/**
 * Centro de Inteligencia Operacional — procesamiento programado.
 *
 * Frecuencias del diseño (cap. 13), implementadas como contadores de tick sobre
 * el worker de Connect (que late cada 15 s), de modo que no hace falta un
 * planificador adicional:
 *
 *   riesgo de retraso + alertas ............ cada minuto
 *   foto de KPIs en vivo ................... cada 5 minutos
 *   recomendaciones ........................ cada 10 minutos
 *   evaluación de predicciones ............. cada 15 minutos
 *   cierre diario de KPIs, previsión de
 *   demanda, precisión de modelos e
 *   informes programados ................... cada hora
 */

import { computeDelayRisks, evaluateDelayRiskPredictions, evaluateEtaPredictions,
  evaluateDemandPredictions, forecastDemand, persistDemandForecast, refreshModelAccuracy } from "./predictions.ts";
import { snapshotKpis } from "./kpi.ts";
import { generateRecommendations } from "./recommendations.ts";
import { runAlertRules } from "./alerts.ts";
import { runDueSchedules } from "./reports.ts";

const TICK_SECONDS = 15;
const every = (minutes: number, tick: number) => tick % Math.round((minutes * 60) / TICK_SECONDS) === 0;

let tick = 0;
let running = false;

/** Un ciclo del centro de inteligencia. Nunca lanza: solo registra el error. */
export async function runIntelligenceCycle(): Promise<void> {
  if (running) return;
  running = true;
  const t = tick++;
  try {
    if (every(1, t)) {
      await computeDelayRisks({ persist: true });
      const alerts = await runAlertRules();
      if (alerts > 0) console.log(`[OI] ${alerts} alerta(s) nuevas`);
    }

    if (every(5, t)) {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      await snapshotKpis("live", { from: dayStart.getTime(), to: Date.now() });
    }

    if (every(10, t)) {
      const created = await generateRecommendations();
      if (created > 0) console.log(`[OI] ${created} recomendación(es) nuevas`);
    }

    if (every(15, t)) {
      await evaluateEtaPredictions();
      await evaluateDelayRiskPredictions();
      await evaluateDemandPredictions();
    }

    if (every(60, t)) {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      await snapshotKpis("day", { from: dayStart.getTime(), to: Date.now() });
      await persistDemandForecast(await forecastDemand({ hours: 24 }));
      await refreshModelAccuracy();
      const sent = await runDueSchedules();
      if (sent > 0) console.log(`[OI] ${sent} informe(s) programados enviados`);
    }
  } catch (err: any) {
    console.error("[OI] error en el ciclo de inteligencia:", err?.message);
  } finally {
    running = false;
  }
}
