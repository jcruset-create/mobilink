/**
 * Mobilink Integration Hub — punto de entrada del módulo.
 *
 * Se integra en el servidor monolítico con dos líneas en server/index.ts:
 *   import { initIntegrationHub, mountIntegrationHub } from "./integration-hub/index.ts";
 *   mountIntegrationHub(app);                 // antes del catch-all SPA
 *   await initIntegrationHub();               // tras initDb()
 */

import type { Express } from "express";
import { initIntegrationHub } from "./infrastructure/schema.ts";
import { createIntegrationHubRouter } from "./api/router.ts";

export { initIntegrationHub };

/** Monta el API Gateway del Hub bajo /api/v1. */
export function mountIntegrationHub(app: Express): void {
  app.use("/api/v1", createIntegrationHubRouter());
  console.log("Mobilink Integration Hub: API montada en /api/v1");
}
