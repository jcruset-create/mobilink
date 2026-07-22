/**
 * Mobilink Assist Connect Pro — punto de entrada del módulo.
 *
 * Plataforma de integración B2B: partners externos (aseguradoras, renting,
 * grúas...) crean asistencias por API; Connect elige el taller de la red,
 * inyecta la asistencia nativa en el core y notifica el progreso por webhooks.
 * Diseño completo en Mobilink_Connect_Pro_Docs.
 *
 * Se integra en el servidor monolítico con tres líneas en server/index.ts
 * (mismo patrón que Integration Hub y Licencias):
 *   import { initConnect, mountConnect, startConnectWorker } from "./connect/index.ts";
 *   mountConnect(app, requireAdminRole);   // antes del catch-all SPA
 *   await initConnect();                   // tras initDb(); luego startConnectWorker()
 */

import type { Express, RequestHandler } from "express";
import { initConnect } from "./schema.ts";
import { createConnectRouter, createConnectAdminRouter } from "./router.ts";
import { createConnectBackofficeRouter } from "./backoffice.ts";
import { startConnectWorker, stopConnectWorker, runConnectChecksOnce } from "./worker.ts";

export { initConnect, startConnectWorker, stopConnectWorker, runConnectChecksOnce };

/** Monta la API de partners bajo /api/connect/v1 y la de administración bajo /api/connect/admin. */
export function mountConnect(app: Express, requireAdmin: RequestHandler): void {
  app.use("/api/connect/v1", createConnectRouter());
  app.use("/api/connect/admin", createConnectAdminRouter(requireAdmin));
  app.use("/api/connect/bo", createConnectBackofficeRouter());
  console.log("Connect Pro: API montada en /api/connect/v1 (partners), /api/connect/admin y /api/connect/bo (backoffice)");
}
