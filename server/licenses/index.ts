/**
 * Mobilink Assist — módulo de licencias: punto de entrada.
 *
 * Se integra en el servidor monolítico con tres líneas en server/index.ts
 * (mismo patrón que el Integration Hub):
 *   import { initLicenses, mountLicenses, startLicenseWorker } from "./licenses/index.ts";
 *   mountLicenses(app, requireAdminRole);   // antes del catch-all SPA
 *   await initLicenses();                   // tras initDb(); luego startLicenseWorker()
 */

import type { Express, RequestHandler } from "express";
import { initLicenses } from "./schema.ts";
import { createLicensesRouter } from "./router.ts";
import { startLicenseWorker, stopLicenseWorker, runLicenseChecksOnce } from "./worker.ts";

export { initLicenses, startLicenseWorker, stopLicenseWorker, runLicenseChecksOnce };

/** Monta la API de licencias bajo /api/licenses. */
export function mountLicenses(app: Express, requireAdmin: RequestHandler): void {
  app.use("/api/licenses", createLicensesRouter(requireAdmin));
  console.log("Licencias: API montada en /api/licenses");
}
