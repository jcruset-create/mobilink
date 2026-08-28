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
import { createConnectLiteRouter } from "./lite.ts";
import { createEmpresasRouter } from "./empresasRouter.ts";
import { createIntegracionesRouter } from "./integraciones.ts";
import { startConnectWorker, stopConnectWorker, runConnectChecksOnce } from "./worker.ts";

export { initConnect, startConnectWorker, stopConnectWorker, runConnectChecksOnce };

/** Monta la API de partners bajo /api/connect/v1 y la de administración bajo /api/connect/admin. */
export function mountConnect(app: Express, requireAdmin: RequestHandler): void {
  app.use("/api/connect/v1", createConnectRouter());
  app.use("/api/connect/admin", createConnectAdminRouter(requireAdmin));
  // Antes del backoffice: es una ruta más específica del mismo prefijo y
  // Express resuelve por orden de montaje.
  //
  // La cartera de empresas va aparte a propósito: es el único módulo donde
  // CADA consulta pasa por la relación comercial, y mezclarlo con los 4.700
  // renglones de backoffice.ts haría imposible comprobarlo de un vistazo.
  app.use("/api/connect/bo/empresas", createEmpresasRouter());
  // Partners de integración y sus credenciales. Antes del backoffice por el
  // mismo motivo: es una ruta más específica del mismo prefijo.
  app.use("/api/connect/bo/integraciones", createIntegracionesRouter());
  app.use("/api/connect/bo", createConnectBackofficeRouter());
  app.use("/api/connect/lite", createConnectLiteRouter());
  console.log(
    "Connect Pro: API montada en /api/connect/v1 (partners), /api/connect/admin, " +
    "/api/connect/bo (backoffice) y /api/connect/lite (APK Mobilink Assist Lite)",
  );
}
