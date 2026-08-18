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
import { startCashErpWorker, stopCashErpWorker } from "./erp/worker.ts";

export { initCash, startCashErpWorker, stopCashErpWorker };

export function mountCash(app: Express): void {
  app.use("/api/cash", createCashRouter());
  console.log("Mobilink Cash: API montada en /api/cash");
}
