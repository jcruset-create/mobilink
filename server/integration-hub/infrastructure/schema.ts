/**
 * Esquema de BD del Mobilink Integration Hub (§2.10).
 *
 * Sigue la convención del proyecto: creación idempotente con CREATE TABLE IF NOT EXISTS,
 * invocada al arrancar el servidor (igual que initDb() en server/db.ts). No hay que
 * ejecutar SQL a mano para estas tablas.
 */

import pool from "../../db.ts";

/**
 * Cambia una restricción UNIQUE por otra con más columnas, sin sobresaltos.
 *
 * Ampliar una UNIQUE no se puede hacer con `IF NOT EXISTS`: hay que quitar la
 * vieja y poner la nueva, y esto se ejecuta en cada arranque del servidor. Así
 * que tiene que ser idempotente de verdad y no fallar cuando ya está hecho.
 *
 * La vieja se localiza por SUS COLUMNAS, no por su nombre: la declararon en
 * línea dentro del CREATE TABLE, así que se llama como PostgreSQL decidiera
 * (`integration_mappings_tenant_id_entity_type_..._key`) y ese nombre puede no
 * ser el mismo en todos los entornos. Se compara el conjunto de columnas
 * ordenado, de modo que solo cae la restricción que es exactamente esa.
 *
 * @param columnasViejas nombres ORDENADOS ALFABÉTICAMENTE de la UNIQUE a quitar
 */
async function reemplazarUnique(
  tabla: string,
  columnasViejas: string[],
  nombreNuevo: string,
  columnasNuevas: string[],
): Promise<void> {
  // ¿Ya está la nueva? Entonces no hay nada que hacer: arranque normal.
  const yaEsta = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`,
    [nombreNuevo, tabla]
  );
  if ((yaEsta.rowCount ?? 0) > 0) return;

  const vieja = await pool.query(
    `SELECT con.conname
       FROM pg_constraint con
      WHERE con.conrelid = $1::regclass
        AND con.contype = 'u'
        AND (
          -- attname es de tipo "name", no "text": sin el cast la comparación
          -- no compila («operator does not exist: name[] = text[]») y, como
          -- esto corre en el arranque, el servidor no llega a levantar.
          SELECT array_agg(att.attname::text ORDER BY att.attname::text)
            FROM unnest(con.conkey) AS k
            JOIN pg_attribute att
              ON att.attrelid = con.conrelid AND att.attnum = k
        ) = $2::text[]`,
    [tabla, columnasViejas]
  );

  const nombreViejo = vieja.rows[0]?.conname as string | undefined;
  if (nombreViejo) {
    await pool.query(`ALTER TABLE ${tabla} DROP CONSTRAINT "${nombreViejo}"`);
  }

  await pool.query(
    `ALTER TABLE ${tabla} ADD CONSTRAINT "${nombreNuevo}" UNIQUE (${columnasNuevas.join(", ")})`
  );
}

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

  // ── Varias cuentas del MISMO proveedor para el mismo cliente ──────────────
  //
  // La UNIQUE original, (tenant_id, connector_key), permite exactamente una
  // cuenta por cliente y conector. Con un ERP eso basta. Con telemática no:
  // un cliente puede tener dos cuentas del mismo proveedor —la flota de
  // autobuses y la auxiliar, cada una con su propio token— y el modelo tiene
  // que poder distinguirlas.
  //
  // `account_key` es el discriminador, y `name` es cómo se llama esa cuenta
  // para una persona («Plana autobuses»). Las filas que ya existen toman
  // 'default' y no se enteran: para quien solo tiene una cuenta, nada cambia.
  await pool.query(`
    ALTER TABLE integration_connector_configs
      ADD COLUMN IF NOT EXISTS account_key TEXT NOT NULL DEFAULT 'default';
    ALTER TABLE integration_connector_configs
      ADD COLUMN IF NOT EXISTS name TEXT;
  `);
  await reemplazarUnique(
    "integration_connector_configs",
    ["connector_key", "tenant_id"],
    "ihcc_tenant_connector_account_uniq",
    ["tenant_id", "connector_key", "account_key"],
  );

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

  // La misma entidad de Mobilink puede vivir en varias EMPRESAS del mismo ERP
  // (SAP sociedad A y sociedad B), y cada mapeo lleva su propio estado de
  // sincronización: integration_sync_state cuenta el estado por tipo de
  // entidad, no por ficha, y aquí hace falta saber que ESTE proveedor falló.
  await pool.query(`
    ALTER TABLE integration_mappings ADD COLUMN IF NOT EXISTS external_company TEXT;
    -- El mismo ERP sirve a varios entornos: el código 889 de Business Central
    -- no significa lo mismo en el tenant de producción que en el de pruebas.
    ALTER TABLE integration_mappings ADD COLUMN IF NOT EXISTS external_tenant TEXT;
    ALTER TABLE integration_mappings ADD COLUMN IF NOT EXISTS external_id TEXT;
    ALTER TABLE integration_mappings
      ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'not_synced';
      -- not_synced | pending | syncing | synced | error
    ALTER TABLE integration_mappings ADD COLUMN IF NOT EXISTS last_sync_at_ms BIGINT;
    ALTER TABLE integration_mappings ADD COLUMN IF NOT EXISTS last_sync_error TEXT;
  `);

  // ── El mapeo tiene que decir a QUÉ CUENTA pertenece ───────────────────────
  //
  // Con dos cuentas del mismo proveedor, `system` ya no identifica con cuál se
  // consulta un vehículo: hace falta la cuenta. Y `active` permite conservar el
  // enlace viejo cuando a un vehículo le cambian el equipo, en vez de borrarlo
  // y perder de dónde venían los kilómetros de antes.
  //
  // La UNIQUE crece con `account_key`, lo que la hace MENOS restrictiva a
  // propósito: el mismo identificador externo puede existir en cuentas
  // distintas —son plataformas distintas—, pero sigue siendo único dentro de
  // una. Las filas existentes llevan 'default', así que ninguna la viola.
  //
  // NO se añade una unique por el otro lado (una entidad de Mobilink → un solo
  // mapeo activo). Sería lo natural para un vehículo, pero rompería un caso que
  // el comentario de arriba declara explícitamente: la misma entidad puede
  // vivir en varias empresas del mismo ERP. Esa regla es específica de la
  // telemática y su sitio es la fase que cree los enlaces de vehículo, no aquí.
  await pool.query(`
    ALTER TABLE integration_mappings
      ADD COLUMN IF NOT EXISTS account_key TEXT NOT NULL DEFAULT 'default';
    ALTER TABLE integration_mappings
      ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
  `);
  await reemplazarUnique(
    "integration_mappings",
    ["entity_type", "external_code", "system", "tenant_id"],
    "ihmap_tenant_entity_system_account_code_uniq",
    ["tenant_id", "entity_type", "system", "account_key", "external_code"],
  );

  // ── Cuándo se vio por última vez ESTE vehículo en el proveedor ────────────
  //
  // No vale `last_sync_at_ms`, que ya existe y significa otra cosa: «cuándo se
  // sincronizó este mapeo». La conciliación necesita responder «¿cuándo apareció
  // por última vez este vehículo en la cuenta?», y la diferencia entre las dos
  // preguntas es justo lo que separa un vehículo retirado de una API caída.
  //
  // Solo se toca cuando se cumplen las tres condiciones a la vez: la cuenta
  // respondió, el listado se obtuvo entero, y el vehículo venía en él. Una
  // sincronización fallida no lo mueve, así que un fallo del proveedor no
  // envejece la flota entera de golpe.
  await pool.query(`
    ALTER TABLE integration_mappings ADD COLUMN IF NOT EXISTS last_seen_at_ms BIGINT;
  `);

  // ── Un vehículo, un enlace activo por cuenta ──────────────────────────────
  //
  // El comentario de la UNIQUE de arriba dejó esta regla pendiente para la fase
  // que creara los enlaces de vehículo, y es esta. Se implementa con dos índices
  // ÚNICOS PARCIALES en vez de constraints por dos motivos:
  //
  //  1. Solo deben aplicar a `entity_type = 'vehicle'`. Un producto o un cliente
  //     sí pueden vivir en varias empresas del mismo ERP, que es el caso que la
  //     UNIQUE general protege a propósito. Una constraint no admite WHERE.
  //  2. Solo cuentan los enlaces ACTIVOS. Desvincular deja la fila con
  //     `active = false` para conservar el histórico, y esas filas no deben
  //     estorbar a un vínculo nuevo.
  //
  // Van los dos sentidos: ni un vehículo de TyreControl con dos equipos activos
  // en la misma cuenta, ni un equipo del proveedor repartido entre dos vehículos.
  // La base es la última línea de defensa; el servicio valida antes y da un
  // mensaje entendible, pero una carrera entre dos pestañas la para esto.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ihmap_vehiculo_un_enlace_activo
      ON integration_mappings (tenant_id, system, account_key, mobilink_id)
      WHERE entity_type = 'vehicle' AND active;
    CREATE UNIQUE INDEX IF NOT EXISTS ihmap_vehiculo_externo_unico
      ON integration_mappings (tenant_id, system, account_key, external_code)
      WHERE entity_type = 'vehicle' AND active;
  `);

  // ── Vehículos del proveedor que no queremos gestionar ─────────────────────
  //
  // Una cuenta telemática trae remolques auxiliares, vehículos de empresa y
  // cosas que en TyreControl no pintan nada. Sin una forma de apartarlos, cada
  // conciliación los volvería a listar como pendientes para siempre, y una
  // lista que siempre tiene ruido deja de leerse.
  //
  // NO se resuelve con un mapeo falso apuntando a un `mobilink_id` inventado:
  // eso metería vehículos fantasma en la misma tabla que usa el odómetro para
  // decidir a quién preguntar. Tabla aparte, pequeña y reversible.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_ignored_externals (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      system TEXT NOT NULL,
      account_key TEXT NOT NULL DEFAULT 'default',
      external_code TEXT NOT NULL,
      reason TEXT,
      created_at_ms BIGINT NOT NULL,
      UNIQUE (tenant_id, entity_type, system, account_key, external_code)
    );
    CREATE INDEX IF NOT EXISTS ihign_lookup_idx
      ON integration_ignored_externals(tenant_id, entity_type, system, account_key);
  `);

  // ── Kilómetros mensuales por vehículo, desde la telemática ───────────────
  //
  // Una fila por vehículo de TyreControl y mes, con lo que el proveedor resumió
  // para ese mes. Vive aquí y no en `tc_*` por lo mismo que `integration_mappings`:
  // es dato DEL PROVEEDOR, atado a una cuenta y a un identificador externo, y
  // la ficha del vehículo lo lee de aquí sin volver a preguntar a nadie.
  //
  // La UNIQUE va por `mobilink_id`, no por `external_code`: lo que se enseña en
  // la ficha son los kilómetros DEL VEHÍCULO, y si algún día se reenlaza a otra
  // unidad del proveedor, el mes sigue siendo el mismo mes de ese vehículo.
  // `external_code` se guarda para saber de qué unidad salió cada fila.
  //
  // `closed`: el mes ya se resumió DESPUÉS de terminar, así que no hace falta
  // volver a pedirlo. Un mes en curso se refresca cada día; uno cerrado, no.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_vehicle_monthly_mileage (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      system TEXT NOT NULL,
      account_key TEXT NOT NULL DEFAULT 'default',
      mobilink_id TEXT NOT NULL,
      external_code TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      period_start_ms BIGINT NOT NULL,
      period_end_ms BIGINT NOT NULL,
      timezone TEXT NOT NULL,
      distance_km NUMERIC(12,3),
      initial_odometer_km NUMERIC(12,3),
      final_odometer_km NUMERIC(12,3),
      trips INTEGER,
      source TEXT NOT NULL,               -- 'summarytrips'
      sync_status TEXT NOT NULL,          -- 'ok' | 'empty' | 'error'
      closed BOOLEAN NOT NULL DEFAULT false,
      synced_at_ms BIGINT NOT NULL,
      last_error TEXT,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (tenant_id, system, account_key, mobilink_id, year, month)
    );
    CREATE INDEX IF NOT EXISTS ihvmm_vehiculo_idx
      ON integration_vehicle_monthly_mileage(tenant_id, mobilink_id, year, month);
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

    -- Aceptación del presupuesto (§7 pasos 11-14)
    ALTER TABLE integration_checklist_runs ADD COLUMN IF NOT EXISTS accepted_at_ms BIGINT;
    ALTER TABLE integration_checklist_runs ADD COLUMN IF NOT EXISTS sales_order_number TEXT;
    ALTER TABLE integration_checklist_runs ADD COLUMN IF NOT EXISTS purchase_order_number TEXT;
  `);

  // ── Catálogo controlado de WorkPlanner (SPEC_WORKPLANNER_BC §4) ────────────
  // Copia local de los artículos/servicios de BC aptos para trabajos de campo.
  // BC es el maestro: aquí nunca se crea un producto, sólo se refleja.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wp_catalog (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bc_item_id TEXT,                    -- GUID del item en BC (para PATCH)
      bc_number TEXT NOT NULL,            -- nº de artículo (clave de negocio)
      tipo TEXT,                          -- Inventory | Service | ...
      descripcion TEXT NOT NULL DEFAULT '',
      um_base TEXT,
      categoria TEXT,
      precio_orientativo NUMERIC(12,2),
      precio_orientativo_ms BIGINT,
      activo BOOLEAN NOT NULL DEFAULT true,
      motivo_inactivo TEXT,               -- 'bloqueado' | 'fuera_de_filtro' | 'huerfano'
      bc_last_modified_ms BIGINT,
      sync_run_id TEXT,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (tenant_id, bc_number)
    );
    CREATE INDEX IF NOT EXISTS wp_catalog_lookup_idx
      ON wp_catalog(tenant_id, activo, categoria);
  `);

  // ── Pedidos de venta de BC → órdenes de trabajo de WorkPlanner (SPEC §2) ───
  // El pedido nace en BC (maestro). Aquí se refleja para planificar y ejecutar;
  // la planificación (técnicos, fechas, vehículos) es local y NUNCA viaja a BC.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wp_orders (
      id SERIAL PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bc_order_id TEXT NOT NULL,          -- GUID del pedido en BC
      bc_number TEXT NOT NULL,            -- nº de documento (PV-...)
      customer_number TEXT,
      customer_name TEXT NOT NULL DEFAULT '',
      ship_to_address TEXT,
      requested_date TEXT,                -- fecha solicitada (ISO date de BC)
      bc_status TEXT,                     -- Draft | Open | Released ...
      bc_last_modified_ms BIGINT,
      wp_status TEXT NOT NULL DEFAULT 'nueva',
        -- 'nueva' | 'planificada' | 'en_curso' | 'finalizada' | 'cancelada_por_erp'
      planning JSONB,                     -- técnicos, fechas, vehículos (local)
      external_document_number TEXT,
      sync_run_id TEXT,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (tenant_id, bc_order_id)
    );
    CREATE INDEX IF NOT EXISTS wp_orders_status_idx ON wp_orders(tenant_id, wp_status);

    CREATE TABLE IF NOT EXISTS wp_order_lines (
      id SERIAL PRIMARY KEY,
      wp_order_id INTEGER NOT NULL REFERENCES wp_orders(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL,
      bc_line_id TEXT,                    -- GUID de la línea en BC
      bc_line_no INTEGER,                 -- sequence de BC
      origen TEXT NOT NULL DEFAULT 'bc',  -- 'bc' | 'wp' (añadida en campo, It.3)
      estado_sync TEXT NOT NULL DEFAULT 'synced',
        -- 'synced' | 'pending_return' | 'returned' | 'rejected' | 'conflict'
      tipo TEXT,                          -- Item | Resource | Comment...
      bc_item_number TEXT,
      descripcion TEXT NOT NULL DEFAULT '',
      qty_prevista NUMERIC(12,4),
      qty_consumida NUMERIC(12,4),
      um TEXT,
      precio_bc NUMERIC(12,4),
      descuento_bc NUMERIC(7,4),
      importe_bc NUMERIC(14,4),
      en_ejecucion BOOLEAN NOT NULL DEFAULT false,  -- protege la línea de re-sync (§2.2)
      aviso_divergencia TEXT,             -- 'la línea cambió en BC durante la ejecución'
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (tenant_id, bc_line_id)
    );
    CREATE INDEX IF NOT EXISTS wp_order_lines_order_idx ON wp_order_lines(wp_order_id);
  `);

  // ── Marcas de agua de sincronización incremental ───────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS integration_sync_state (
      tenant_id TEXT NOT NULL,
      entity TEXT NOT NULL,               -- 'catalog' | 'sales_orders' ...
      last_sync_ms BIGINT,
      last_full_sync_ms BIGINT,
      status TEXT,                        -- 'ok' | 'error'
      detail TEXT,
      updated_at_ms BIGINT NOT NULL,
      PRIMARY KEY (tenant_id, entity)
    );
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
