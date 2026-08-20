/**
 * Punto de entrada de MC Central.
 *
 * Misma forma que `server/cash/index.ts`: init del esquema, montaje del router
 * y registro del transporte, para que `server/index.ts` solo llame a tres
 * funciones.
 *
 * Central va en el MISMO proceso que la caja, y por eso el transporte es una
 * llamada directa. El día que se separe, lo único que cambia es qué transporte
 * se registra aquí: ni el emisor ni el worker de la caja se enteran.
 */

import type { Express } from "express";
import { initCentral } from "./schema.ts";
import { createCentralRouter } from "./router.ts";
import { TransporteLocal } from "./transport.ts";
import { registrarTransporte } from "../cash/events/transport.ts";
import { startCentralRulesWorker } from "./rules/service.ts";
import { startCentralNotificationWorker } from "./notifications/service.ts";

export { initCentral };

export function mountCentral(app: Express): void {
  app.use("/api/central", createCentralRouter());
  registrarTransporte(new TransporteLocal());
  startCentralRulesWorker();
  startCentralNotificationWorker();
  console.log("MC Central: API montada en /api/central y transporte local registrado");
}
