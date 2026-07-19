/**
 * Esquema de BD del Mobilink Integration Hub (§2.10).
 *
 * Sigue la convención del proyecto: creación idempotente con CREATE TABLE IF NOT EXISTS,
 * invocada al arrancar el servidor (igual que initDb() en server/db.ts). No hay que
 * ejecutar SQL a mano para estas tablas.
 */

import pool from "../../db.ts";

export async function initIntegrationHub(): Promise<void> {
  // ── Conectores registrados y su configuración por tenant ──────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_connectors (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL,
      kind TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at_ms BIGINT NOT NULL,
      UNIQUE (key)
    );

    CREATE TABLE IF NOT EXISTS integration_connector_configs (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      connector_key TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT false,
      -- Config NO sensible (endpoints, company id, almacén por defecto...).
      -- Los SECRETOS (tokens, client_secret) NO van aquí: van en el gestor de secretos.
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (tenant_id, connector_key)
    );
    CREATE INDEX IF NOT EXISTS ihcc_tenant_idx ON integration_connector_configs(tenant_id);
  `);

  // ── Operaciones de integración: el corazón de la trazabilidad (§2.9) ──────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_operations (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      connector_key TEXT,
      operation_type TEXT NOT NULL,
      source_system TEXT NOT NULL,
      target_system TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      work_order_id TEXT,
      request_payload JSONB,
      response_payload JSONB,
      status TEXT NOT NULL DEFAULT 'RECEIVED',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      completed_at_ms BIGINT
    );
    CREATE INDEX IF NOT EXISTS ihop_tenant_idx ON integration_operations(tenant_id);
    CREATE INDEX IF NOT EXISTS ihop_status_idx ON integration_operations(status);
    CREATE INDEX IF NOT EXISTS ihop_correlation_idx ON integration_operations(correlation_id);
    CREATE INDEX IF NOT EXISTS ihop_created_idx ON integration_operations(created_at_ms DESC);
  `);

  // ── Audit log: cada transición/paso de una operación ──────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_operation_logs (
      id SERIAL PRIMARY KEY,
      operation_id INTEGER NOT NULL REFERENCES integration_operations(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      status TEXT,
      message TEXT NOT NULL,
      data JSONB,
      created_at_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ihol_operation_idx ON integration_operation_logs(operation_id);
    CREATE INDEX IF NOT EXISTS ihol_correlation_idx ON integration_operation_logs(correlation_id);
  `);

  // ── Mapping Engine: códigos externos → registro único de Mobilink (§2.5) ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_mappings (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,          -- 'product' | 'customer' | 'vehicle' ...
      system TEXT NOT NULL,               -- 'business-central' | 'tecdoc' | 'oe' | 'supplier:SUP-001'
      external_code TEXT NOT NULL,
      mobilink_id TEXT NOT NULL,          -- id interno único de Mobilink
      metadata JSONB,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (tenant_id, entity_type, system, external_code)
    );
    CREATE INDEX IF NOT EXISTS ihmap_lookup_idx
      ON integration_mappings(tenant_id, entity_type, system, external_code);
    CREATE INDEX IF NOT EXISTS ihmap_mobilink_idx
      ON integration_mappings(tenant_id, entity_type, mobilink_id);
  `);

  // ── Referencias de producto externas normalizadas + ofertas de proveedor ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS external_product_references (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      mobilink_product_id TEXT,
      oe_reference TEXT,
      tecdoc_code TEXT,
      supplier_part_number TEXT,
      erp_code TEXT,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ihepr_tenant_idx ON external_product_references(tenant_id);
    CREATE INDEX IF NOT EXISTS ihepr_oe_idx ON external_product_references(oe_reference);

    CREATE TABLE IF NOT EXISTS supplier_offers (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      correlation_id TEXT,
      supplier_id TEXT NOT NULL,
      supplier_part_number TEXT NOT NULL,
      manufacturer_reference TEXT,
      oe_references JSONB,
      unit_cost NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      available_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
      estimated_delivery TEXT,
      valid_until TEXT,
      created_at_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ihso_tenant_idx ON supplier_offers(tenant_id);
    CREATE INDEX IF NOT EXISTS ihso_correlation_idx ON supplier_offers(correlation_id);
  `);

  // ── Relación entre documentos de Mobilink y del sistema externo ───────────
  // Guarda "OT de Mobilink ⇄ presupuesto de Business Central" (primera entrega §4).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_document_links (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      work_order_id TEXT,
      mobilink_doc_type TEXT NOT NULL,    -- 'sales_quote' ...
      mobilink_doc_id TEXT NOT NULL,      -- 'MQ-000258'
      target_system TEXT NOT NULL,        -- 'business-central'
      external_doc_type TEXT NOT NULL,    -- 'sales_quote'
      external_doc_number TEXT NOT NULL,  -- 'PRES-001258'
      external_doc_id TEXT,
      created_at_ms BIGINT NOT NULL,
      UNIQUE (tenant_id, mobilink_doc_type, mobilink_doc_id)
    );
    CREATE INDEX IF NOT EXISTS ihdl_wo_idx ON integration_document_links(work_order_id);
    CREATE INDEX IF NOT EXISTS ihdl_correlation_idx ON integration_document_links(correlation_id);
  `);

  // ── Automatización del checklist (Fase 4): traza del flujo completo ───────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_checklist_runs (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      work_order_id TEXT,
      checklist_id TEXT,
      incident_id TEXT NOT NULL,
      category TEXT,
      status TEXT NOT NULL,              -- COMPLETED | PARTIAL | FAILED
      vehicle_ref TEXT,
      selected_part_ref TEXT,
      oe_references JSONB,
      best_offer JSONB,
      mobilink_quote_id TEXT,
      external_quote_number TEXT,
      quote_amount NUMERIC(12,2),
      decision JSONB,                    -- resultado del Rules Engine
      steps JSONB,                       -- traza paso a paso
      created_at_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ihcr_tenant_idx ON integration_checklist_runs(tenant_id);
    CREATE INDEX IF NOT EXISTS ihcr_correlation_idx ON integration_checklist_runs(correlation_id);
    CREATE INDEX IF NOT EXISTS ihcr_wo_idx ON integration_checklist_runs(work_order_id);
  `);

  // ── Contador diario para CorrelationId (COR-YYYYMMDD-NNNNNN) ───────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_correlation_counters (
      day TEXT PRIMARY KEY,               -- 'YYYYMMDD'
      last_seq INTEGER NOT NULL DEFAULT 0
    );
  `);

  // ── Contador para numeración de documentos internos de Mobilink (MQ-######) ─
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_document_counters (
      key TEXT PRIMARY KEY,               -- 'sales_quote'
      last_seq INTEGER NOT NULL DEFAULT 0
    );
  `);

  console.log("Mobilink Integration Hub: esquema inicializado correctamente");
}
