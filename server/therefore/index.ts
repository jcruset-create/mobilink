/**
 * Punto de entrada del módulo Therefore.
 *
 * Misma forma que `server/tacografos/index.ts` y `server/cash/index.ts`: init
 * del esquema y montaje del router, para que `server/index.ts` sólo tenga que
 * llamar a dos funciones y no conozca las interioridades del módulo.
 *
 * ── Qué es este módulo ──────────────────────────────────────────────────────
 *
 * Therefore manda correos automáticos sobre facturas de proveedor: pide grabar
 * albaranes, modificarlos, aprobar facturas, y vuelve a pedir lo mismo durante
 * días. Este módulo los convierte en una cola de trabajo donde la unidad **no
 * es el correo sino el expediente**, y donde un expediente agrupa todas las
 * actuaciones, notificaciones y documentos del mismo problema.
 *
 * De momento (fase 1) están los expedientes y sus actuaciones, que se crean a
 * mano. La ingesta de correo y el análisis del albarán dentro del PDF llegan
 * después, sobre estas mismas tablas.
 */

import type { Express } from "express";
import { initTherefore } from "./schema.ts";
import { createThereforeRouter } from "./router.ts";

export { initTherefore };

export function mountTherefore(app: Express): void {
  app.use("/api/therefore", createThereforeRouter());
  console.log("Módulo Therefore: API montada en /api/therefore");
}
