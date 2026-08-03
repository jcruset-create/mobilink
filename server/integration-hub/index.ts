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
import { runSalesOrderSync } from "./application/services/SalesOrderSyncService.ts";
import { tenantsWithEnabledConnector } from "./infrastructure/repositories.ts";

export { initIntegrationHub, stopIntegrationWorker };

/** Horas entre sincronizaciones automáticas de catálogo. 0 desactiva la programación. */
const CATALOG_SYNC_HOURS = Number(process.env.IH_CATALOG_SYNC_HOURS ?? 24);

/** Minutos entre sincronizaciones de pedidos BC → WorkPlanner. 0 desactiva. */
const ORDERS_SYNC_MINUTES = Number(process.env.IH_ORDERS_SYNC_MINUTES ?? 5);

let catalogTimer: ReturnType<typeof setInterval> | null = null;
let ordersTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Sincronización de catálogo para todos los tenants con BC habilitado.
 * Cada tenant es independiente: el fallo de uno no detiene a los demás
 * (queda registrado en integration_sync_state y en el panel de operaciones).
 */
async function forEachBcTenant(label: string, fn: (tenantId: string) => Promise<string>): Promise<void> {
  let tenants: string[] = [];
  try {
    tenants = await tenantsWithEnabledConnector("business-central");
  } catch (e) {
    console.error(`[integration-hub] no se pudieron listar tenants para ${label}:`, e);
    return;
  }
  for (const tenantId of tenants) {
    try {
      console.log(`[integration-hub] ${label} ${tenantId}: ${await fn(tenantId)}`);
    } catch (e: any) {
      console.error(`[integration-hub] ${label} fallida para ${tenantId}:`, e?.message ?? e);
    }
  }
}

function runCatalogSyncForAllTenants(): Promise<void> {
  return forEachBcTenant("catálogo", async (tenantId) => {
    const r = await runCatalogSync({ tenantId });
    return `${r.mode}, ${r.recibidos} recibidos, ${r.activos} activos`;
  });
}

function runOrdersSyncForAllTenants(): Promise<void> {
  return forEachBcTenant("pedidos", async (tenantId) => {
    const r = await runSalesOrderSync({ tenantId });
    return `${r.mode}, ${r.pedidos} pedidos, ${r.lineas} líneas`;
  });
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
  if (ORDERS_SYNC_MINUTES > 0 && !ordersTimer) {
    ordersTimer = setInterval(() => void runOrdersSyncForAllTenants(), ORDERS_SYNC_MINUTES * 60_000);
    setTimeout(() => void runOrdersSyncForAllTenants(), 90_000);
    console.log(`Mobilink Integration Hub: sync de pedidos cada ${ORDERS_SYNC_MINUTES} min`);
  }
}

/** Monta el API Gateway del Hub bajo /api/v1. */
export function mountIntegrationHub(app: Express): void {
  app.use("/api/v1", createIntegrationHubRouter());
  console.log("Mobilink Integration Hub: API montada en /api/v1");
}
