/**
 * Repositorios del Integration Hub. Acceso a BD mediante el pool `pg` del proyecto.
 * Sin ORM, siguiendo el estilo de server/index.ts (SQL parametrizado).
 */

import pool from "../../db.ts";
import { formatCorrelationId } from "../domain/identifiers.ts";
import type { CorrelationId, TenantId } from "../domain/identifiers.ts";
import type { OperationStatus, OperationType } from "../domain/operation.ts";

function now(): number {
  return Date.now();
}

// ── CorrelationId: contador atómico por día ─────────────────────────────────
export async function nextCorrelationId(date = new Date()): Promise<CorrelationId> {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const day = `${y}${m}${d}`;
  const { rows } = await pool.query(
    `INSERT INTO integration_correlation_counters (day, last_seq)
     VALUES ($1, 1)
     ON CONFLICT (day) DO UPDATE SET last_seq = integration_correlation_counters.last_seq + 1
     RETURNING last_seq`,
    [day]
  );
  return formatCorrelationId(date, rows[0].last_seq);
}

// ── Numeración de documentos internos de Mobilink (p. ej. MQ-000258) ────────
export async function nextDocumentNumber(key: string, prefix: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO integration_document_counters (key, last_seq)
     VALUES ($1, 1)
     ON CONFLICT (key) DO UPDATE SET last_seq = integration_document_counters.last_seq + 1
     RETURNING last_seq`,
    [key]
  );
  return `${prefix}-${String(rows[0].last_seq).padStart(6, "0")}`;
}

// ── Operaciones ─────────────────────────────────────────────────────────────
export interface OperationRow {
  id: number;
  tenant_id: string;
  connector_key: string | null;
  operation_type: string;
  source_system: string;
  target_system: string;
  correlation_id: string;
  work_order_id: string | null;
  request_payload: unknown;
  response_payload: unknown;
  status: OperationStatus;
  retry_count: number;
  error_code: string | null;
  error_message: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  completed_at_ms: number | null;
}

export async function createOperation(params: {
  tenantId: TenantId;
  connectorKey?: string;
  operationType: OperationType;
  sourceSystem: string;
  targetSystem: string;
  correlationId: CorrelationId;
  workOrderId?: string;
  requestPayload?: unknown;
}): Promise<OperationRow> {
  const ts = now();
  const { rows } = await pool.query(
    `INSERT INTO integration_operations
       (tenant_id, connector_key, operation_type, source_system, target_system,
        correlation_id, work_order_id, request_payload, status, retry_count,
        created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'RECEIVED',0,$9,$9)
     RETURNING *`,
    [
      params.tenantId,
      params.connectorKey ?? null,
      params.operationType,
      params.sourceSystem,
      params.targetSystem,
      params.correlationId,
      params.workOrderId ?? null,
      params.requestPayload ? JSON.stringify(params.requestPayload) : null,
      ts,
    ]
  );
  return rows[0];
}

export async function updateOperationStatus(
  operationId: number,
  status: OperationStatus,
  extra: {
    responsePayload?: unknown;
    errorCode?: string | null;
    errorMessage?: string | null;
    completed?: boolean;
    incrementRetry?: boolean;
  } = {}
): Promise<OperationRow> {
  const ts = now();
  const { rows } = await pool.query(
    `UPDATE integration_operations SET
       status = $2,
       response_payload = COALESCE($3, response_payload),
       error_code = $4,
       error_message = $5,
       retry_count = retry_count + $6,
       completed_at_ms = CASE WHEN $7 THEN $8 ELSE completed_at_ms END,
       updated_at_ms = $8
     WHERE id = $1
     RETURNING *`,
    [
      operationId,
      status,
      extra.responsePayload !== undefined ? JSON.stringify(extra.responsePayload) : null,
      extra.errorCode ?? null,
      extra.errorMessage ?? null,
      extra.incrementRetry ? 1 : 0,
      extra.completed ?? false,
      ts,
    ]
  );
  return rows[0];
}

export async function getOperation(operationId: number): Promise<OperationRow | null> {
  const { rows } = await pool.query(`SELECT * FROM integration_operations WHERE id = $1`, [operationId]);
  return rows[0] ?? null;
}

export async function listOperations(filters: {
  tenantId?: string;
  status?: OperationStatus;
  limit?: number;
}): Promise<OperationRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filters.tenantId) {
    args.push(filters.tenantId);
    where.push(`tenant_id = $${args.length}`);
  }
  if (filters.status) {
    args.push(filters.status);
    where.push(`status = $${args.length}`);
  }
  args.push(Math.min(filters.limit ?? 100, 500));
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT * FROM integration_operations ${whereSql}
     ORDER BY created_at_ms DESC LIMIT $${args.length}`,
    args
  );
  return rows;
}

// ── Audit log ───────────────────────────────────────────────────────────────
export async function appendLog(params: {
  operationId: number;
  tenantId: string;
  correlationId: string;
  level?: "info" | "warn" | "error";
  status?: OperationStatus;
  message: string;
  data?: unknown;
}): Promise<void> {
  await pool.query(
    `INSERT INTO integration_operation_logs
       (operation_id, tenant_id, correlation_id, level, status, message, data, created_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      params.operationId,
      params.tenantId,
      params.correlationId,
      params.level ?? "info",
      params.status ?? null,
      params.message,
      params.data !== undefined ? JSON.stringify(params.data) : null,
      now(),
    ]
  );
}

export async function listLogs(operationId: number) {
  const { rows } = await pool.query(
    `SELECT * FROM integration_operation_logs WHERE operation_id = $1 ORDER BY created_at_ms ASC`,
    [operationId]
  );
  return rows;
}

// ── Enlace de documentos Mobilink ⇄ sistema externo ─────────────────────────
export async function linkDocument(params: {
  tenantId: string;
  correlationId: string;
  workOrderId?: string;
  mobilinkDocType: string;
  mobilinkDocId: string;
  targetSystem: string;
  externalDocType: string;
  externalDocNumber: string;
  externalDocId?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO integration_document_links
       (tenant_id, correlation_id, work_order_id, mobilink_doc_type, mobilink_doc_id,
        target_system, external_doc_type, external_doc_number, external_doc_id, created_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (tenant_id, mobilink_doc_type, mobilink_doc_id) DO NOTHING`,
    [
      params.tenantId,
      params.correlationId,
      params.workOrderId ?? null,
      params.mobilinkDocType,
      params.mobilinkDocId,
      params.targetSystem,
      params.externalDocType,
      params.externalDocNumber,
      params.externalDocId ?? null,
      now(),
    ]
  );
}

// ── Ofertas de proveedor (supplier_offers) ──────────────────────────────────
export interface SupplierOfferInput {
  supplierId: string;
  supplierPartNumber: string;
  manufacturerReference?: string;
  oeReferences?: string[];
  unitCost: number;
  currency: string;
  availableQuantity: number;
  estimatedDelivery?: string;
  validUntil?: string;
}

export async function saveSupplierOffers(
  tenantId: string,
  correlationId: string,
  offers: SupplierOfferInput[]
): Promise<void> {
  if (!offers.length) return;
  const ts = now();
  for (const o of offers) {
    await pool.query(
      `INSERT INTO supplier_offers
         (tenant_id, correlation_id, supplier_id, supplier_part_number, manufacturer_reference,
          oe_references, unit_cost, currency, available_quantity, estimated_delivery, valid_until, created_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        tenantId,
        correlationId,
        o.supplierId,
        o.supplierPartNumber,
        o.manufacturerReference ?? null,
        o.oeReferences ? JSON.stringify(o.oeReferences) : null,
        o.unitCost,
        o.currency,
        o.availableQuantity,
        o.estimatedDelivery ?? null,
        o.validUntil ?? null,
        ts,
      ]
    );
  }
}

export async function listSupplierOffers(tenantId: string, correlationId?: string) {
  const args: unknown[] = [tenantId];
  let sql = `SELECT * FROM supplier_offers WHERE tenant_id = $1`;
  if (correlationId) {
    args.push(correlationId);
    sql += ` AND correlation_id = $2`;
  }
  sql += ` ORDER BY created_at_ms DESC LIMIT 200`;
  const { rows } = await pool.query(sql, args);
  return rows;
}

// ── Automatización del checklist (Fase 4) ───────────────────────────────────
export interface ChecklistRunInput {
  tenantId: string;
  correlationId: string;
  workOrderId?: string;
  checklistId?: string;
  incidentId: string;
  category?: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  vehicleRef?: string;
  selectedPartRef?: string;
  oeReferences?: string[];
  bestOffer?: unknown;
  mobilinkQuoteId?: string;
  externalQuoteNumber?: string;
  quoteAmount?: number;
  decision?: unknown;
  steps?: unknown;
}

export async function saveChecklistRun(run: ChecklistRunInput): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO integration_checklist_runs
       (tenant_id, correlation_id, work_order_id, checklist_id, incident_id, category, status,
        vehicle_ref, selected_part_ref, oe_references, best_offer, mobilink_quote_id,
        external_quote_number, quote_amount, decision, steps, created_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING id`,
    [
      run.tenantId,
      run.correlationId,
      run.workOrderId ?? null,
      run.checklistId ?? null,
      run.incidentId,
      run.category ?? null,
      run.status,
      run.vehicleRef ?? null,
      run.selectedPartRef ?? null,
      run.oeReferences ? JSON.stringify(run.oeReferences) : null,
      run.bestOffer !== undefined ? JSON.stringify(run.bestOffer) : null,
      run.mobilinkQuoteId ?? null,
      run.externalQuoteNumber ?? null,
      run.quoteAmount ?? null,
      run.decision !== undefined ? JSON.stringify(run.decision) : null,
      run.steps !== undefined ? JSON.stringify(run.steps) : null,
      now(),
    ]
  );
  return rows[0].id;
}

// ── Aceptación de presupuestos (§7 pasos 11-14) ─────────────────────────────

/** Busca un enlace de documento por tipo+id de Mobilink (p. ej. sales_quote MQ-000258). */
export async function findDocumentLink(tenantId: string, mobilinkDocType: string, mobilinkDocId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM integration_document_links
      WHERE tenant_id = $1 AND mobilink_doc_type = $2 AND mobilink_doc_id = $3`,
    [tenantId, mobilinkDocType, mobilinkDocId]
  );
  return rows[0] ?? null;
}

/** Busca un enlace de documento por correlationId y tipo (para idempotencia). */
export async function findDocumentLinkByCorrelation(tenantId: string, correlationId: string, mobilinkDocType: string) {
  const { rows } = await pool.query(
    `SELECT * FROM integration_document_links
      WHERE tenant_id = $1 AND correlation_id = $2 AND mobilink_doc_type = $3`,
    [tenantId, correlationId, mobilinkDocType]
  );
  return rows[0] ?? null;
}

/** Última operación COMPLETED de un tipo dentro de un correlationId. */
export async function findCompletedOperation(tenantId: string, correlationId: string, operationType: string) {
  const { rows } = await pool.query(
    `SELECT * FROM integration_operations
      WHERE tenant_id = $1 AND correlation_id = $2 AND operation_type = $3 AND status = 'COMPLETED'
      ORDER BY id DESC LIMIT 1`,
    [tenantId, correlationId, operationType]
  );
  return rows[0] ?? null;
}

/** Run del checklist por correlationId. */
export async function findChecklistRun(tenantId: string, correlationId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM integration_checklist_runs WHERE tenant_id = $1 AND correlation_id = $2`,
    [tenantId, correlationId]
  );
  return rows[0] ?? null;
}

/** Marca el run como aceptado con los números de pedido resultantes. */
export async function markChecklistRunAccepted(params: {
  tenantId: string;
  correlationId: string;
  salesOrderNumber?: string;
  purchaseOrderNumber?: string;
}): Promise<void> {
  await pool.query(
    `UPDATE integration_checklist_runs SET
       accepted_at_ms = COALESCE(accepted_at_ms, $3),
       sales_order_number = COALESCE($4, sales_order_number),
       purchase_order_number = COALESCE($5, purchase_order_number)
     WHERE tenant_id = $1 AND correlation_id = $2`,
    [params.tenantId, params.correlationId, now(), params.salesOrderNumber ?? null, params.purchaseOrderNumber ?? null]
  );
}

// ── Configuración de conectores por tenant ──────────────────────────────────
export async function getConnectorConfig(tenantId: string, connectorKey: string) {
  const { rows } = await pool.query(
    `SELECT * FROM integration_connector_configs WHERE tenant_id = $1 AND connector_key = $2`,
    [tenantId, connectorKey]
  );
  return rows[0] ?? null;
}

export async function upsertConnectorConfig(params: {
  tenantId: string;
  connectorKey: string;
  enabled: boolean;
  config: Record<string, unknown>;
}) {
  const ts = now();
  const { rows } = await pool.query(
    `INSERT INTO integration_connector_configs
       (tenant_id, connector_key, enabled, config, created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT (tenant_id, connector_key)
     DO UPDATE SET enabled = EXCLUDED.enabled, config = EXCLUDED.config, updated_at_ms = $5
     RETURNING *`,
    [params.tenantId, params.connectorKey, params.enabled, JSON.stringify(params.config), ts]
  );
  return rows[0];
}

export async function listConnectorConfigs(tenantId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM integration_connector_configs WHERE tenant_id = $1 ORDER BY connector_key`,
    [tenantId]
  );
  return rows;
}
