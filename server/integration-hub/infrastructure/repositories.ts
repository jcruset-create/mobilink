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

// ── Mapeos entre identificadores de Mobilink y de sistemas externos (§4.3) ──

export type MappingEntityType = "customer" | "product" | "vehicle" | "warehouse";

export interface MappingRow {
  id: number;
  tenant_id: string;
  entity_type: string;
  system: string;
  external_code: string;
  mobilink_id: string;
  metadata: Record<string, unknown> | null;
}

/** Mobilink → sistema externo. Es la dirección que usa la creación de documentos. */
export async function findExternalCode(params: {
  tenantId: string;
  entityType: MappingEntityType;
  system: string;
  mobilinkId: string;
}): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT external_code FROM integration_mappings
      WHERE tenant_id = $1 AND entity_type = $2 AND system = $3 AND mobilink_id = $4
      LIMIT 1`,
    [params.tenantId, params.entityType, params.system, params.mobilinkId]
  );
  return rows[0]?.external_code ?? null;
}

/** Sistema externo → Mobilink. Para importaciones y webhooks entrantes. */
export async function findMobilinkId(params: {
  tenantId: string;
  entityType: MappingEntityType;
  system: string;
  externalCode: string;
}): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT mobilink_id FROM integration_mappings
      WHERE tenant_id = $1 AND entity_type = $2 AND system = $3 AND external_code = $4
      LIMIT 1`,
    [params.tenantId, params.entityType, params.system, params.externalCode]
  );
  return rows[0]?.mobilink_id ?? null;
}

export async function upsertMapping(params: {
  tenantId: string;
  entityType: MappingEntityType;
  system: string;
  externalCode: string;
  mobilinkId: string;
  metadata?: Record<string, unknown>;
}): Promise<MappingRow> {
  const ts = now();
  const { rows } = await pool.query(
    `INSERT INTO integration_mappings
       (tenant_id, entity_type, system, external_code, mobilink_id, metadata, created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT (tenant_id, entity_type, system, external_code)
     DO UPDATE SET mobilink_id = EXCLUDED.mobilink_id,
                   metadata = EXCLUDED.metadata,
                   updated_at_ms = $7
     RETURNING *`,
    [
      params.tenantId,
      params.entityType,
      params.system,
      params.externalCode,
      params.mobilinkId,
      params.metadata ? JSON.stringify(params.metadata) : null,
      ts,
    ]
  );
  return rows[0];
}

export async function listMappings(filters: {
  tenantId: string;
  entityType?: string;
  system?: string;
  search?: string;
  limit?: number;
}): Promise<MappingRow[]> {
  const where: string[] = ["tenant_id = $1"];
  const values: unknown[] = [filters.tenantId];

  if (filters.entityType) {
    values.push(filters.entityType);
    where.push(`entity_type = $${values.length}`);
  }
  if (filters.system) {
    values.push(filters.system);
    where.push(`system = $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    where.push(`(external_code ILIKE $${values.length} OR mobilink_id ILIKE $${values.length})`);
  }
  values.push(Math.min(filters.limit ?? 200, 1000));

  const { rows } = await pool.query(
    `SELECT * FROM integration_mappings
      WHERE ${where.join(" AND ")}
      ORDER BY entity_type, mobilink_id
      LIMIT $${values.length}`,
    values
  );
  return rows;
}

export async function deleteMapping(tenantId: string, id: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM integration_mappings WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return (rowCount ?? 0) > 0;
}

// ── Catálogo controlado de WorkPlanner (SPEC §4) ────────────────────────────

export interface CatalogItemUpsert {
  tenantId: string;
  bcItemId: string;
  bcNumber: string;
  tipo?: string;
  descripcion: string;
  umBase?: string;
  categoria?: string;
  precioOrientativo?: number;
  activo: boolean;
  motivoInactivo?: string;
  bcLastModifiedMs?: number;
  syncRunId: string;
}

export async function upsertCatalogItem(item: CatalogItemUpsert) {
  const ts = now();
  const { rows } = await pool.query(
    `INSERT INTO wp_catalog
       (tenant_id, bc_item_id, bc_number, tipo, descripcion, um_base, categoria,
        precio_orientativo, precio_orientativo_ms, activo, motivo_inactivo,
        bc_last_modified_ms, sync_run_id, created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
     ON CONFLICT (tenant_id, bc_number)
     DO UPDATE SET bc_item_id = EXCLUDED.bc_item_id,
                   tipo = EXCLUDED.tipo,
                   descripcion = EXCLUDED.descripcion,
                   um_base = EXCLUDED.um_base,
                   categoria = EXCLUDED.categoria,
                   precio_orientativo = EXCLUDED.precio_orientativo,
                   precio_orientativo_ms = EXCLUDED.precio_orientativo_ms,
                   activo = EXCLUDED.activo,
                   motivo_inactivo = EXCLUDED.motivo_inactivo,
                   bc_last_modified_ms = EXCLUDED.bc_last_modified_ms,
                   sync_run_id = EXCLUDED.sync_run_id,
                   updated_at_ms = $14
     RETURNING *`,
    [
      item.tenantId,
      item.bcItemId,
      item.bcNumber,
      item.tipo ?? null,
      item.descripcion,
      item.umBase ?? null,
      item.categoria ?? null,
      item.precioOrientativo ?? null,
      item.precioOrientativo != null ? ts : null,
      item.activo,
      item.motivoInactivo ?? null,
      item.bcLastModifiedMs ?? null,
      item.syncRunId,
      ts,
    ]
  );
  return rows[0];
}

export async function listCatalog(filters: {
  tenantId: string;
  soloActivos?: boolean;
  categoria?: string;
  search?: string;
  limit?: number;
}) {
  const where: string[] = ["tenant_id = $1"];
  const values: unknown[] = [filters.tenantId];
  if (filters.soloActivos) where.push("activo = true");
  if (filters.categoria) {
    values.push(filters.categoria);
    where.push(`categoria = $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    where.push(`(bc_number ILIKE $${values.length} OR descripcion ILIKE $${values.length})`);
  }
  values.push(Math.min(filters.limit ?? 200, 1000));
  const { rows } = await pool.query(
    `SELECT * FROM wp_catalog WHERE ${where.join(" AND ")} ORDER BY bc_number LIMIT $${values.length}`,
    values
  );
  return rows;
}

/**
 * Desactiva los artículos que NO aparecen en la pasada full indicada.
 * Es la conciliación de huérfanos (§4.3): un artículo borrado en BC no llega
 * nunca por el incremental, así que sólo una pasada completa lo detecta.
 */
export async function deactivateCatalogOrphans(tenantId: string, fullSyncRunId: string): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE wp_catalog
        SET activo = false, motivo_inactivo = 'huerfano', updated_at_ms = $3
      WHERE tenant_id = $1 AND activo = true AND sync_run_id <> $2`,
    [tenantId, fullSyncRunId, now()]
  );
  return rowCount ?? 0;
}

export async function getSyncState(tenantId: string, entity: string) {
  const { rows } = await pool.query(
    `SELECT * FROM integration_sync_state WHERE tenant_id = $1 AND entity = $2`,
    [tenantId, entity]
  );
  return rows[0] ?? null;
}

export async function upsertSyncState(params: {
  tenantId: string;
  entity: string;
  lastSyncMs?: number;
  lastFullSyncMs?: number;
  status: string;
  detail?: string;
}) {
  const ts = now();
  await pool.query(
    `INSERT INTO integration_sync_state (tenant_id, entity, last_sync_ms, last_full_sync_ms, status, detail, updated_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, entity)
     DO UPDATE SET last_sync_ms = COALESCE(EXCLUDED.last_sync_ms, integration_sync_state.last_sync_ms),
                   last_full_sync_ms = COALESCE(EXCLUDED.last_full_sync_ms, integration_sync_state.last_full_sync_ms),
                   status = EXCLUDED.status,
                   detail = EXCLUDED.detail,
                   updated_at_ms = $7`,
    [params.tenantId, params.entity, params.lastSyncMs ?? null, params.lastFullSyncMs ?? null, params.status, params.detail ?? null, ts]
  );
}

// ── Pedidos BC → órdenes de trabajo WorkPlanner (SPEC §2) ───────────────────

export interface WpOrderUpsert {
  tenantId: string;
  bcOrderId: string;
  bcNumber: string;
  customerNumber?: string;
  customerName?: string;
  shipToAddress?: string;
  requestedDate?: string;
  bcStatus?: string;
  bcLastModifiedMs?: number;
  externalDocumentNumber?: string;
  syncRunId: string;
}

/**
 * Inserta o actualiza la cabecera. La planificación local (wp_status, planning)
 * NUNCA se toca desde la sincronización: pertenece a WorkPlanner.
 */
export async function upsertWpOrder(order: WpOrderUpsert) {
  const ts = now();
  const { rows } = await pool.query(
    `INSERT INTO wp_orders
       (tenant_id, bc_order_id, bc_number, customer_number, customer_name, ship_to_address,
        requested_date, bc_status, bc_last_modified_ms, external_document_number,
        sync_run_id, created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
     ON CONFLICT (tenant_id, bc_order_id)
     DO UPDATE SET bc_number = EXCLUDED.bc_number,
                   customer_number = EXCLUDED.customer_number,
                   customer_name = EXCLUDED.customer_name,
                   ship_to_address = EXCLUDED.ship_to_address,
                   requested_date = EXCLUDED.requested_date,
                   bc_status = EXCLUDED.bc_status,
                   bc_last_modified_ms = EXCLUDED.bc_last_modified_ms,
                   external_document_number = EXCLUDED.external_document_number,
                   sync_run_id = EXCLUDED.sync_run_id,
                   updated_at_ms = $12
     RETURNING *`,
    [
      order.tenantId,
      order.bcOrderId,
      order.bcNumber,
      order.customerNumber ?? null,
      order.customerName ?? "",
      order.shipToAddress ?? null,
      order.requestedDate ?? null,
      order.bcStatus ?? null,
      order.bcLastModifiedMs ?? null,
      order.externalDocumentNumber ?? null,
      order.syncRunId,
      ts,
    ]
  );
  return rows[0];
}

export interface WpOrderLineUpsert {
  wpOrderId: number;
  tenantId: string;
  bcLineId: string;
  bcLineNo?: number;
  tipo?: string;
  bcItemNumber?: string;
  descripcion?: string;
  qtyPrevista?: number;
  um?: string;
  precioBc?: number;
  descuentoBc?: number;
  importeBc?: number;
}

/**
 * Inserta o actualiza una línea venida de BC.
 *
 * Regla §2.2: una línea EN EJECUCIÓN no se pisa — se anota la divergencia y la
 * resuelve una persona. Devuelve si hubo divergencia para que el servicio la loguee.
 */
export async function upsertWpOrderLine(line: WpOrderLineUpsert): Promise<{ row: any; divergencia: boolean }> {
  const ts = now();
  const { rows: existing } = await pool.query(
    `SELECT * FROM wp_order_lines WHERE tenant_id = $1 AND bc_line_id = $2`,
    [line.tenantId, line.bcLineId]
  );
  const previa = existing[0];

  if (previa?.en_ejecucion) {
    const cambio =
      Number(previa.qty_prevista) !== Number(line.qtyPrevista ?? 0) ||
      previa.bc_item_number !== (line.bcItemNumber ?? null);
    if (cambio) {
      const { rows } = await pool.query(
        `UPDATE wp_order_lines
            SET aviso_divergencia = $3, updated_at_ms = $4
          WHERE tenant_id = $1 AND bc_line_id = $2
          RETURNING *`,
        [
          line.tenantId,
          line.bcLineId,
          `La línea cambió en BC durante la ejecución (cantidad/artículo). Revisar antes de devolver.`,
          ts,
        ]
      );
      return { row: rows[0], divergencia: true };
    }
    return { row: previa, divergencia: false };
  }

  const { rows } = await pool.query(
    `INSERT INTO wp_order_lines
       (wp_order_id, tenant_id, bc_line_id, bc_line_no, origen, estado_sync, tipo,
        bc_item_number, descripcion, qty_prevista, um, precio_bc, descuento_bc,
        importe_bc, created_at_ms, updated_at_ms)
     VALUES ($1,$2,$3,$4,'bc','synced',$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
     ON CONFLICT (tenant_id, bc_line_id)
     DO UPDATE SET bc_line_no = EXCLUDED.bc_line_no,
                   tipo = EXCLUDED.tipo,
                   bc_item_number = EXCLUDED.bc_item_number,
                   descripcion = EXCLUDED.descripcion,
                   qty_prevista = EXCLUDED.qty_prevista,
                   um = EXCLUDED.um,
                   precio_bc = EXCLUDED.precio_bc,
                   descuento_bc = EXCLUDED.descuento_bc,
                   importe_bc = EXCLUDED.importe_bc,
                   updated_at_ms = $13
     RETURNING *`,
    [
      line.wpOrderId,
      line.tenantId,
      line.bcLineId,
      line.bcLineNo ?? null,
      line.tipo ?? null,
      line.bcItemNumber ?? null,
      line.descripcion ?? "",
      line.qtyPrevista ?? null,
      line.um ?? null,
      line.precioBc ?? null,
      line.descuentoBc ?? null,
      line.importeBc ?? null,
      ts,
    ]
  );
  return { row: rows[0], divergencia: false };
}

export async function markWpOrderCancelledByErp(tenantId: string, bcOrderId: string) {
  await pool.query(
    `UPDATE wp_orders
        SET wp_status = 'cancelada_por_erp', updated_at_ms = $3
      WHERE tenant_id = $1 AND bc_order_id = $2 AND wp_status <> 'cancelada_por_erp'`,
    [tenantId, bcOrderId, now()]
  );
}

export async function listWpOrders(filters: {
  tenantId: string;
  wpStatus?: string;
  search?: string;
  limit?: number;
}) {
  const where: string[] = ["o.tenant_id = $1"];
  const values: unknown[] = [filters.tenantId];
  if (filters.wpStatus) {
    values.push(filters.wpStatus);
    where.push(`o.wp_status = $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    where.push(`(o.bc_number ILIKE $${values.length} OR o.customer_name ILIKE $${values.length})`);
  }
  values.push(Math.min(filters.limit ?? 100, 500));
  const { rows } = await pool.query(
    `SELECT o.*,
            (SELECT COUNT(*)::int FROM wp_order_lines l WHERE l.wp_order_id = o.id) AS num_lineas
       FROM wp_orders o
      WHERE ${where.join(" AND ")}
      ORDER BY o.updated_at_ms DESC
      LIMIT $${values.length}`,
    values
  );
  return rows;
}

export async function getWpOrderWithLines(tenantId: string, id: number) {
  const { rows } = await pool.query(`SELECT * FROM wp_orders WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  const order = rows[0];
  if (!order) return null;
  const { rows: lines } = await pool.query(
    `SELECT * FROM wp_order_lines WHERE wp_order_id = $1 ORDER BY bc_line_no ASC NULLS LAST, id ASC`,
    [order.id]
  );
  return { order, lines };
}

const WP_STATUSES = ["nueva", "planificada", "en_curso", "finalizada"] as const;

/** Actualiza estado y/o planificación local. La sync jamás pasa por aquí. */
export async function updateWpOrderPlanning(params: {
  tenantId: string;
  id: number;
  wpStatus?: string;
  planning?: Record<string, unknown>;
}) {
  if (params.wpStatus && !WP_STATUSES.includes(params.wpStatus as any)) {
    throw new Error(`Estado de WorkPlanner no válido: ${params.wpStatus}`);
  }
  const { rows } = await pool.query(
    `UPDATE wp_orders
        SET wp_status = COALESCE($3, wp_status),
            planning = COALESCE($4, planning),
            updated_at_ms = $5
      WHERE tenant_id = $1 AND id = $2 AND wp_status <> 'cancelada_por_erp'
      RETURNING *`,
    [params.tenantId, params.id, params.wpStatus ?? null, params.planning ? JSON.stringify(params.planning) : null, now()]
  );
  return rows[0] ?? null;
}

/** Tenants con el conector BC habilitado — los que entran en la sync programada. */
export async function tenantsWithEnabledConnector(connectorKey: string): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT tenant_id FROM integration_connector_configs
      WHERE connector_key = $1 AND enabled = true`,
    [connectorKey]
  );
  return rows.map((r) => r.tenant_id);
}
