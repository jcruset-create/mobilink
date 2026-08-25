/**
 * Punto de entrada del módulo Tacógrafos.
 *
 * Misma forma que `server/cash/index.ts`: init del esquema y montaje del
 * router, para que `server/index.ts` sólo tenga que llamar a dos funciones y no
 * conozca las interioridades del módulo.
 */

import type { Express } from "express";
import { initTacografos } from "./schema.ts";
import { createTacografosRouter } from "./router.ts";

export { initTacografos };

export function mountTacografos(app: Express): void {
  app.use("/api/tacografos", createTacografosRouter());
  console.log("Módulo Tacógrafos: API montada en /api/tacografos");
}
