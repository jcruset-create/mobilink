/**
 * API Gateway del Integration Hub (§2.5).
 *
 * Punto único de entrada bajo /api/v1. Expone:
 *  - la primera entrega funcional: POST /erp/sales-quotes
 *  - endpoints de administración para el panel de integraciones (§2.11)
 *
 * Se monta desde server/index.ts con una sola línea, sin tocar el resto del monolito.
 */

import express, { type Request, type Response, type Router } from "express";
import { createQuoteFromWorkOrder } from "../application/services/SalesQuoteService.ts";
import {
  previewQuoteFromWorkOrder,
  createQuoteFromWorkOrderId,
} from "../application/services/WorkOrderQuoteService.ts";
import { identifyVehicle, getCompatibleParts, getOeReferences } from "../application/services/TechnicalService.ts";
import { searchOffers, createPurchaseOrder as createSupplierPurchaseOrder } from "../application/services/SupplierService.ts";
import { processNonConformity } from "../application/services/ChecklistAutomationService.ts";
import { sendCommunication } from "../application/services/CommunicationService.ts";
import { acceptQuote } from "../application/services/QuoteAcceptanceService.ts";
import { runWorkerCycle } from "../workers/IntegrationWorker.ts";
import { runCatalogSync, getCatalogStatus } from "../application/services/CatalogSyncService.ts";
import { runSalesOrderSync } from "../application/services/SalesOrderSyncService.ts";
import { registerExecution, confirmReturn } from "../application/services/ExecutionReturnService.ts";
import {
  resolveErpConnector,
  knownErpConnectorKeys,
  knownTechnicalConnectorKeys,
  knownSupplierConnectorKeys,
  knownCommunicationConnectorKeys,
  buildTechnicalConnector,
  buildSupplierConnector,
  buildCommunicationConnector,
} from "../connectors/ConnectorRegistry.ts";
import { IntegrationError } from "../domain/errors.ts";
import { nextCorrelationId } from "../infrastructure/repositories.ts";
import {
  listOperations,
  getOperation,
  listLogs,
  upsertConnectorConfig,
  listConnectorConfigs,
  updateOperationStatus,
  listMappings,
  upsertMapping,
  deleteMapping,
  listCatalog,
  listWpOrders,
  getWpOrderWithLines,
  updateWpOrderPlanning,
  getSyncState,
} from "../infrastructure/repositories.ts";

function tenantOf(req: Request): string | undefined {
  return (req.header("x-tenant-id") || req.body?.tenantId || req.query?.tenantId) as string | undefined;
}

/**
 * Guard ligero para endpoints de administración (config, reprocesar).
 *
 * La cabecera llega percent-encoded desde el front (`makeAdminHeaders` en
 * src/modules/adminHeaders.ts aplica encodeURIComponent), igual que en el resto
 * del monolito: por eso se decodifica antes de comparar, como hace
 * getRoleFromRequest() en server/index.ts.
 *
 * Se acepta tanto ADMIN_TOKEN como ADMIN_PASSWORD: el login clásico guarda la
 * contraseña de admin en 'sea-admin-token', y el resto de la app ya le concede
 * rol 'admin' con ella. Sin esto, el panel de integraciones daba 401 aunque el
 * usuario estuviese correctamente autenticado como administrador.
 */
function requireAdmin(req: Request, res: Response): boolean {
  const accepted = [process.env.ADMIN_TOKEN, process.env.ADMIN_PASSWORD].filter(Boolean) as string[];
  // Si no hay ninguna credencial configurada, no bloqueamos (entorno de desarrollo).
  if (accepted.length === 0) return true;

  const raw = req.header("x-admin-token") ?? String(req.query?.token ?? "");
  let got = raw;
  try {
    got = decodeURIComponent(raw);
  } catch {
    got = raw;
  }

  if (!accepted.includes(got) && !accepted.includes(raw)) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

function sendError(res: Response, err: unknown) {
  if (err instanceof IntegrationError) {
    const httpStatus =
      err.kind === "VALIDATION" ? 400 : err.kind === "AUTH" ? 401 : err.kind === "NOT_FOUND" ? 404 : 502;
    return res.status(httpStatus).json({
      error: err.code,
      message: err.message,
      kind: err.kind,
      details: err.details,
    });
  }
  console.error("[integration-hub] error inesperado:", err);
  return res.status(500).json({ error: "internal_error", message: (err as Error)?.message });
}

export function createIntegrationHubRouter(): Router {
  const router = express.Router();

  // ── Health ──────────────────────────────────────────────────────────────
  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "mobilink-integration-hub",
      erpConnectors: knownErpConnectorKeys(),
      technicalConnectors: knownTechnicalConnectorKeys(),
      supplierConnectors: knownSupplierConnectorKeys(),
      communicationConnectors: knownCommunicationConnectorKeys(),
    });
  });

  // ── ERP: primera entrega funcional (OT → presupuesto de venta) ────────────
  router.post("/erp/sales-quotes", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const { workOrderId, customerId, vehicleId, reference, currency, lines } = req.body ?? {};
      const result = await createQuoteFromWorkOrder({
        tenantId: tenantId ?? "",
        workOrderId,
        customerId,
        vehicleId,
        reference,
        currency,
        lines,
      });
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Presupuesto a partir de una OT real de Mobilink (tabla otf).
  // El preview no toca el ERP: dice qué se enviaría y qué falta por mapear.
  router.get("/erp/work-orders/:otfId/quote-preview", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const preview = await previewQuoteFromWorkOrder({
        tenantId: tenantId ?? "",
        otfId: Number(req.params.otfId),
      });
      res.json(preview);
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/erp/work-orders/:otfId/sales-quote", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const result = await createQuoteFromWorkOrderId({
        tenantId: tenantId ?? "",
        otfId: Number(req.params.otfId),
        permitirSinMapear: Boolean(req.body?.permitirSinMapear),
        currency: req.body?.currency,
      });
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Aceptación del presupuesto (§7 pasos 11-14): pedido de venta en el ERP +
  // pedido de compra al recambista de la mejor oferta + run actualizado.
  router.post("/erp/sales-quotes/:mobilinkQuoteId/accept", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const result = await acceptQuote({
        tenantId: tenantId ?? "",
        mobilinkQuoteId: String(req.params.mobilinkQuoteId),
      });
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Technical Data Hub (Fase 2) ───────────────────────────────────────────
  // Identificar vehículo por matrícula o VIN.
  router.post("/technical/vehicles/identify", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const { plate, vin, country } = req.body ?? {};
      const result = await identifyVehicle(tenantId ?? "", { plate, vin, country });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Recambios compatibles con un vehículo (opcional ?category=).
  router.get("/technical/parts/search", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const vehicleRef = req.query.vehicleRef as string;
      const category = req.query.category as string | undefined;
      const result = await getCompatibleParts(tenantId ?? "", vehicleRef, category);
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Referencias OE de una pieza.
  router.get("/technical/parts/:partRef/oe-references", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const result = await getOeReferences(tenantId ?? "", String(req.params.partRef));
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Supplier Hub (Fase 3) ─────────────────────────────────────────────────
  // Buscar ofertas de recambista(s) por OE / referencia / texto. Devuelve ranking + mejor oferta.
  router.post("/suppliers/offers", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const { oeReference, manufacturerReference, text, quantity } = req.body ?? {};
      const result = await searchOffers(tenantId ?? "", { oeReference, manufacturerReference, text, quantity });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Crear pedido de compra en un recambista concreto.
  router.post("/suppliers/:key/purchase-orders", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const { lines, reference } = req.body ?? {};
      const result = await createSupplierPurchaseOrder(tenantId ?? "", String(req.params.key), lines, reference);
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Communication Hub ─────────────────────────────────────────────────────
  // Envío de comunicaciones al cliente (presupuesto, cita, estado de OT, aprobación,
  // firma, factura). El canal se decide por `channel` o por los datos del destinatario.
  router.post("/communications/messages", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const { kind, channel, recipient, data, workOrderId } = req.body ?? {};
      const result = await sendCommunication({
        tenantId: tenantId ?? "",
        kind,
        channel,
        recipient,
        data,
        workOrderId,
      });
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Automatización del checklist (Fase 4) ─────────────────────────────────
  // Un ítem "No conforme" dispara todo el flujo: incidencia → vehículo → OE →
  // oferta → presupuesto BC, con un único correlationId y aplicando el Rules Engine.
  router.post("/checklist/non-conformity", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      const b = req.body ?? {};
      const result = await processNonConformity({
        tenantId: tenantId ?? "",
        workOrderId: b.workOrderId,
        checklistId: b.checklistId,
        category: b.category,
        customerId: b.customerId,
        customerTier: b.customerTier,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        customerEmail: b.customerEmail,
        plate: b.plate,
        vin: b.vin,
        vehicleRef: b.vehicleRef,
        quantity: b.quantity,
        localStock: b.localStock,
      });
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Administración: conectores ────────────────────────────────────────────
  router.get("/admin/connectors", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const tenantId = tenantOf(req);
    if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
    const configs = await listConnectorConfigs(tenantId);
    res.json({ tenantId, erpConnectors: knownErpConnectorKeys(), configs });
  });

  router.put("/admin/connectors/:key", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const tenantId = tenantOf(req);
    if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
    const { enabled, config } = req.body ?? {};
    const saved = await upsertConnectorConfig({
      tenantId,
      connectorKey: req.params.key,
      enabled: Boolean(enabled),
      config: config ?? {},
    });
    res.json(saved);
  });

  // Probar conexión de un conector (botón "Probar conexión" del panel).
  router.post("/admin/connectors/:key/test", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tenantId = tenantOf(req);
      if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
      const key = req.params.key;
      const correlationId = await nextCorrelationId();
      const ctx = { tenantId, correlationId };

      if (key === "business-central") {
        const resolved = await resolveErpConnector(tenantId);
        const result = await resolved.connector.testConnection(ctx);
        return res.json({ key: resolved.key, usingDefault: resolved.usingDefault, ...result });
      }
      if (knownTechnicalConnectorKeys().includes(key)) {
        const connector = await buildTechnicalConnector(tenantId, key);
        const result = await connector.testConnection(ctx);
        return res.json({ key, ...result });
      }
      if (knownSupplierConnectorKeys().includes(key)) {
        const connector = await buildSupplierConnector(tenantId, key);
        const result = await connector.testConnection(ctx);
        return res.json({ key, ...result });
      }
      if (knownCommunicationConnectorKeys().includes(key)) {
        const connector = await buildCommunicationConnector(tenantId, key);
        const result = await connector.testConnection(ctx);
        return res.json({ key, ...result });
      }
      return res.status(400).json({ error: "unsupported_connector", key });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Catálogo controlado de WorkPlanner (SPEC §4) ───────────────────────────
  // Lectura de negocio: lo consume la UI de WorkPlanner (artículos usables en campo).
  router.get("/catalog", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
      const items = await listCatalog({
        tenantId,
        soloActivos: req.query.todos !== "1",
        categoria: req.query.categoria as string | undefined,
        search: req.query.search as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ tenantId, items });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/admin/catalog/status", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tenantId = tenantOf(req);
      if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
      res.json(await getCatalogStatus(tenantId));
    } catch (err) {
      sendError(res, err);
    }
  });

  // Sincronización bajo demanda. body: { full?: boolean }
  router.post("/admin/catalog/sync", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tenantId = tenantOf(req);
      if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
      const result = await runCatalogSync({ tenantId, full: Boolean(req.body?.full) });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Pedidos BC → WorkPlanner (SPEC §2) ─────────────────────────────────────
  // Bandeja local de pedidos sincronizados. Lo consume la UI de WorkPlanner.
  router.get("/erp/sales-orders", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
      const [orders, state] = await Promise.all([
        listWpOrders({
          tenantId,
          wpStatus: req.query.estado as string | undefined,
          search: req.query.search as string | undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        }),
        getSyncState(tenantId, "sales_orders"),
      ]);
      res.json({
        tenantId,
        lastSyncMs: state?.last_sync_ms ? Number(state.last_sync_ms) : null,
        syncStatus: state?.status ?? null,
        orders,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/erp/sales-orders/:id", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
      const data = await getWpOrderWithLines(tenantId, Number(req.params.id));
      if (!data) return res.status(404).json({ error: "not_found" });
      res.json(data);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Planificación local (estado WP, técnicos, fechas). Nunca viaja a BC.
  router.patch("/erp/sales-orders/:id/planning", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
      const updated = await updateWpOrderPlanning({
        tenantId,
        id: Number(req.params.id),
        wpStatus: req.body?.wpStatus,
        planning: req.body?.planning,
      });
      if (!updated) return res.status(404).json({ error: "not_found_or_cancelled" });
      res.json(updated);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Ejecución del parte: consumos y líneas añadidas en campo. Local, no toca BC.
  router.post("/erp/sales-orders/:id/execution", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
      const result = await registerExecution({
        tenantId,
        wpOrderId: Number(req.params.id),
        lines: req.body?.lines,
        extraLines: req.body?.extraLines,
        usuario: req.body?.usuario,
      });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Confirmar el parte: empuja a BC lo pendiente (operación auditada y reintentable).
  router.post("/erp/sales-orders/:id/confirm-return", async (req: Request, res: Response) => {
    try {
      const tenantId = tenantOf(req);
      if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
      const result = await confirmReturn({ tenantId, wpOrderId: Number(req.params.id) });
      res.status(201).json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Sincronización bajo demanda. body: { full?: boolean }
  router.post("/admin/sales-orders/sync", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tenantId = tenantOf(req);
      if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
      res.json(await runSalesOrderSync({ tenantId, full: Boolean(req.body?.full) }));
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Administración: mapeos Mobilink ↔ sistema externo (§4.3) ──────────────
  router.get("/admin/mappings", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tenantId = tenantOf(req);
      if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
      const mappings = await listMappings({
        tenantId,
        entityType: req.query.entityType as string | undefined,
        system: req.query.system as string | undefined,
        search: req.query.search as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ tenantId, mappings });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Alta/actualización. Acepta uno o varios de golpe, para poder cargar el maestro
  // completo de clientes o artículos sin una llamada por fila.
  router.post("/admin/mappings", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tenantId = tenantOf(req);
      if (!tenantId) return res.status(400).json({ error: "missing_tenant" });

      const body = req.body ?? {};
      const entradas = Array.isArray(body.mappings) ? body.mappings : [body];
      const guardados = [];
      for (const [i, m] of entradas.entries()) {
        if (!m?.entityType || !m?.system || !m?.externalCode || !m?.mobilinkId) {
          throw IntegrationError.validation(
            "MAPPING_INCOMPLETE",
            `Mapeo ${i}: se requieren entityType, system, externalCode y mobilinkId`
          );
        }
        guardados.push(
          await upsertMapping({
            tenantId,
            entityType: m.entityType,
            system: m.system,
            externalCode: String(m.externalCode),
            mobilinkId: String(m.mobilinkId),
            metadata: m.metadata,
          })
        );
      }
      res.status(201).json({ guardados: guardados.length, mappings: guardados });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.delete("/admin/mappings/:id", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const tenantId = tenantOf(req);
      if (!tenantId) return res.status(400).json({ error: "missing_tenant" });
      const borrado = await deleteMapping(tenantId, Number(req.params.id));
      if (!borrado) return res.status(404).json({ error: "not_found" });
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  // ── Administración: operaciones (panel de integraciones) ──────────────────
  router.get("/admin/operations", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const tenantId = tenantOf(req);
    const status = req.query.status as any;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const ops = await listOperations({ tenantId, status, limit });
    res.json({ operations: ops });
  });

  router.get("/admin/operations/:id", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const op = await getOperation(Number(req.params.id));
    if (!op) return res.status(404).json({ error: "not_found" });
    const logs = await listLogs(op.id);
    res.json({ operation: op, logs });
  });

  // Reprocesar una operación en MANUAL_REVIEW/FAILED: la deja lista para relanzar.
  router.post("/admin/operations/:id/reprocess", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const op = await getOperation(Number(req.params.id));
    if (!op) return res.status(404).json({ error: "not_found" });
    if (!["FAILED", "MANUAL_REVIEW", "RETRY_PENDING"].includes(op.status)) {
      return res.status(409).json({ error: "not_reprocessable", status: op.status });
    }
    const updated = await updateOperationStatus(op.id, "RETRY_PENDING", {
      errorCode: null,
      errorMessage: null,
    });
    res.json({
      operation: updated,
      note: "Marcada para reproceso; el worker la reejecutará en el próximo ciclo (o lanza /admin/worker/run)",
    });
  });

  // Ejecutar un ciclo del worker bajo demanda (botón del panel / diagnóstico).
  router.post("/admin/worker/run", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const result = await runWorkerCycle();
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}
