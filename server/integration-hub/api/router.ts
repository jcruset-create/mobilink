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
import { identifyVehicle, getCompatibleParts, getOeReferences } from "../application/services/TechnicalService.ts";
import { searchOffers, createPurchaseOrder as createSupplierPurchaseOrder } from "../application/services/SupplierService.ts";
import { processNonConformity } from "../application/services/ChecklistAutomationService.ts";
import { sendCommunication } from "../application/services/CommunicationService.ts";
import { runWorkerCycle } from "../workers/IntegrationWorker.ts";
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
} from "../infrastructure/repositories.ts";

function tenantOf(req: Request): string | undefined {
  return (req.header("x-tenant-id") || req.body?.tenantId || req.query?.tenantId) as string | undefined;
}

/** Guard ligero para endpoints de administración (config, reprocesar). */
function requireAdmin(req: Request, res: Response): boolean {
  const expected = process.env.ADMIN_TOKEN;
  // Si no hay ADMIN_TOKEN configurado, no bloqueamos (entorno de desarrollo).
  if (!expected) return true;
  const got = req.header("x-admin-token");
  if (got !== expected) {
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
