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
import {
  startIntegrationWorker as startRetryWorker,
  stopIntegrationWorker,
} from "./workers/IntegrationWorker.ts";
import { runCatalogSync } from "./application/services/CatalogSyncService.ts";
import { tenantsWithEnabledConnector } from "./infrastructure/repositories.ts";

export { initIntegrationHub, stopIntegrationWorker };

/** Horas entre sincronizaciones automáticas de catálogo. 0 desactiva la programación. */
const CATALOG_SYNC_HOURS = Number(process.env.IH_CATALOG_SYNC_HOURS ?? 24);

let catalogTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Sincronización de catálogo para todos los tenants con BC habilitado.
 * Cada tenant es independiente: el fallo de uno no detiene a los demás
 * (queda registrado en integration_sync_state y en el panel de operaciones).
 */
async function runCatalogSyncForAllTenants(): Promise<void> {
  let tenants: string[] = [];
  try {
    tenants = await tenantsWithEnabledConnector("business-central");
  } catch (e) {
    console.error("[integration-hub] no se pudieron listar tenants para la sync de catálogo:", e);
    return;
  }
  for (const tenantId of tenants) {
    try {
      const r = await runCatalogSync({ tenantId });
      console.log(
        `[integration-hub] catálogo ${tenantId}: ${r.mode}, ${r.recibidos} recibidos, ${r.activos} activos`
      );
    } catch (e: any) {
      console.error(`[integration-hub] sync de catálogo fallida para ${tenantId}:`, e?.message ?? e);
    }
  }
}

/** Arranca el worker de reprocesos y, si procede, la sync programada de catálogo. */
export function startIntegrationWorker(): void {
  startRetryWorker();
  if (CATALOG_SYNC_HOURS > 0 && !catalogTimer) {
    catalogTimer = setInterval(() => void runCatalogSyncForAllTenants(), CATALOG_SYNC_HOURS * 3600_000);
    // Primera pasada al arrancar, con retardo corto para no competir con el boot.
    setTimeout(() => void runCatalogSyncForAllTenants(), 60_000);
    console.log(`Mobilink Integration Hub: sync de catálogo cada ${CATALOG_SYNC_HOURS} h`);
  }
}

/** Monta el API Gateway del Hub bajo /api/v1. */
export function mountIntegrationHub(app: Express): void {
  app.use("/api/v1", createIntegrationHubRouter());
  console.log("Mobilink Integration Hub: API montada en /api/v1");
}
