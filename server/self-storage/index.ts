/**
 * Punto de entrada de Mobilink Self Storage (alquiler de trasteros).
 *
 * Misma forma que Recepciones y Therefore: `initSelfStorage` prepara el
 * esquema al arrancar y `mountSelfStorage` monta la API, para que
 * `server/index.ts` sólo tenga que llamar a dos funciones.
 *
 * ── Aislamiento ─────────────────────────────────────────────────────────────
 *
 * Es un dominio aparte. Sus clientes son SUYOS (`self_storage_customers`) y no
 * se mezclan con los de ningún otro módulo; de la plataforma sólo usa lo
 * transversal: la empresa (tenant), la sesión de los empleados y sus permisos
 * (`app_usuario_modulos`). Una prueba recorre este directorio y falla si
 * aparece cualquier otra tabla.
 *
 * Fase 1: centros, zonas, tipos, trasteros, plano, clientes, importación,
 * dashboard. Contratos/facturación/Stripe (2), accesos/RUT241/bloqueos (3) y
 * portal/contratación online (4) llegan después: ver docs/self-storage/.
 */

import express, { type Express } from "express";
import { initSelfStorage } from "./schema.ts";
import { createSelfStorageAdminRouter } from "./router.ts";
import { createPortalRouter } from "./modules/portal/router.ts";
import { procesarWebhook } from "./integrations/stripe/webhook.ts";
import { ErrorSelfStorage } from "./errors.ts";
import { startSelfStorageJobs, stopSelfStorageJobs } from "./jobs/scheduler.ts";

export { initSelfStorage, startSelfStorageJobs, stopSelfStorageJobs };

/**
 * El webhook de Stripe necesita el cuerpo TAL CUAL llega para verificar la
 * firma: se monta ANTES de `express.json()` (como /api/stripe/webhook).
 */
export function mountSelfStorageWebhooks(app: Express): void {
  app.post("/api/self-storage/webhooks/stripe", express.raw({ type: "application/json", limit: "2mb" }), async (req, res) => {
    try {
      const r = await procesarWebhook(req.body as Buffer, req.get("stripe-signature") ?? undefined);
      res.status(r.status).json(r.body);
    } catch (e) {
      if (e instanceof ErrorSelfStorage) return res.status(e.estado).json({ error: e.message, code: e.codigo });
      console.error("[Self Storage] webhook:", e);
      res.status(500).json({ error: "webhook_error" });
    }
  });
}

export function mountSelfStorage(app: Express): void {
  app.use("/api/self-storage/admin", createSelfStorageAdminRouter());
  app.use("/api/self-storage/portal", createPortalRouter());
  console.log("Módulo Self Storage: API montada en /api/self-storage/{admin,portal,webhooks}");
}
