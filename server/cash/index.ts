/**
 * Punto de entrada de Mobilink Cash.
 *
 * Misma forma que `server/integration-hub/index.ts`: init del esquema, montaje
 * del router y arranque del worker, para que `server/index.ts` solo tenga que
 * llamar a tres funciones y no conozca las interioridades del módulo.
 */

import type { Express } from "express";
import { initCash } from "./schema.ts";
import { createCashRouter } from "./router.ts";
import { registrarVerificador, verificadorSupabase } from "./reauth.ts";
import { startCashErpWorker, stopCashErpWorker } from "./erp/worker.ts";
import { startCashEventWorker } from "./events/worker.ts";
import { arrancarWorkerAutoScan, pararWorkerAutoScan } from "./autoscan/worker.ts";

export {
  initCash,
  startCashErpWorker,
  stopCashErpWorker,
  startCashEventWorker,
  arrancarWorkerAutoScan,
  pararWorkerAutoScan,
};

export function mountCash(app: Express): void {
  // El verificador real solo se registra al montar de verdad: las pruebas
  // enchufan el suyo y no necesitan Supabase.
  registrarVerificador(verificadorSupabase());
  app.use("/api/cash", createCashRouter());
  /*
   * El que analiza lo que va dejando AutoScan. Se arranca al montar y no en el
   * arranque del servidor porque sin la API montada no hay quien deje nada.
   */
  arrancarWorkerAutoScan();
  console.log("Mobilink Cash: API montada en /api/cash");
}
