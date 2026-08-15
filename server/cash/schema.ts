/**
 * Esquema de Mobilink Cash.
 *
 * Sigue la convención del proyecto: DDL idempotente que se ejecuta al arrancar
 * (como `initDb()` y `initIntegrationHub()`), de modo que una base nueva queda
 * lista sin ejecutar nada a mano. El equivalente para pegar en el SQL Editor de
 * Supabase está en `supabase/migrations/cash_fase1.sql`.
 *
 * Decisiones que conviene no perder de vista:
 *
 * · El dinero se guarda en **céntimos enteros** (BIGINT), nunca NUMERIC ni
 *   DOUBLE. Es la misma representación que usa el motor, así que no hay
 *   conversión posible que introduzca un decimal por el camino.
 *
 * · `cash_denomination_movements` es un **libro mayor inmutable**: se inserta y
 *   no se toca. El stock teórico se reconstruye sumándolo. No hay ninguna
 *   columna de saldo acumulado que pueda quedarse desincronizada, que es la
 *   avería clásica de estos módulos.
 *
 * · Una corrección nunca borra: se anula con un movimiento inverso. Por eso no
 *   hay ON DELETE CASCADE hacia los movimientos desde las operaciones.
 */

import pool from "../db.ts";
import { DENOMINACIONES_SEMILLA } from "./domain/denominations.ts";

export async function initCash(): Promise<void> {
  // ── Catálogo de denominaciones y cartuchos ────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_denominations (
      id SERIAL PRIMARY KEY,
      valor_centimos INTEGER NOT NULL UNIQUE,
      tipo TEXT NOT NULL CHECK (tipo IN ('BILLETE','MONEDA')),
      etiqueta TEXT NOT NULL,
      piezas_por_cartucho INTEGER,
      activa BOOLEAN NOT NULL DEFAULT true,
      orden INTEGER NOT NULL DEFAULT 0,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cash_den_activa_idx ON cash_denominations(activa, orden);
  `);

  // ── Cajas físicas ─────────────────────────────────────────────────────────
  // `centro` es texto libre y no un enum: Administración ya usa
  // 'tarragona'/'reus' pero la jerarquía de empresas/talleres del SaaS crece, y
  // un CHECK aquí obligaría a una migración cada vez que se abre un taller.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_registers (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      centro TEXT NOT NULL DEFAULT '',
      nombre TEXT NOT NULL,
      activa BOOLEAN NOT NULL DEFAULT true,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (empresa_id, centro, nombre)
    );
    CREATE INDEX IF NOT EXISTS cash_registers_empresa_idx ON cash_registers(empresa_id, activa);
  `);

  // ── Jornadas de caja ──────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_sessions (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      register_id INTEGER NOT NULL REFERENCES cash_registers(id) ON DELETE RESTRICT,
      fecha DATE NOT NULL,
      estado TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (estado IN ('DRAFT','OPEN','PENDING_CLOSE','CLOSED','REOPENED','CANCELLED')),

      abierta_por UUID,
      abierta_at_ms BIGINT,
      cerrada_por UUID,
      cerrada_at_ms BIGINT,

      -- Fondo inicial: importe y de dónde salió. La composición exacta vive en
      -- los movimientos con motivo OPENING_FLOAT, como todo lo demás.
      fondo_inicial_centimos BIGINT NOT NULL DEFAULT 0,
      fondo_inicial_heredado BOOLEAN NOT NULL DEFAULT false,
      sesion_anterior_id INTEGER REFERENCES cash_sessions(id) ON DELETE SET NULL,

      -- Resultado del cierre. Se rellena al cerrar y queda congelado.
      contado_centimos BIGINT,
      diferencia_centimos BIGINT,
      denominaciones_cuadran BOOLEAN,
      cambio_final_centimos BIGINT,
      ingreso_bancario_centimos BIGINT,

      notas TEXT,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cash_sessions_register_idx ON cash_sessions(register_id, fecha DESC);
    CREATE INDEX IF NOT EXISTS cash_sessions_empresa_idx ON cash_sessions(empresa_id, fecha DESC);
  `);

  /*
   * Una caja no puede tener dos jornadas abiertas a la vez. Se hace con un
   * índice único parcial y no con una comprobación en el código: es la base de
   * datos la que tiene que impedirlo, porque dos peticiones simultáneas pasan
   * las dos por el `if` antes de que ninguna haya insertado.
   */
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_una_abierta_idx
      ON cash_sessions(register_id)
      WHERE estado IN ('OPEN','PENDING_CLOSE','REOPENED');
  `);

  // ── Documentos externos (caché local de la ERP) ───────────────────────────
  // La ERP sigue siendo la fuente autoritativa; esto es la copia con la que se
  // opera para no depender de que la ERP conteste en cada pantalla.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_external_documents (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      external_system TEXT NOT NULL,
      external_id TEXT NOT NULL,
      external_reference TEXT,
      tipo TEXT NOT NULL
        CHECK (tipo IN ('CUSTOMER_INVOICE','SUPPLIER_INVOICE','RECEIPT','CREDIT_NOTE','PAYMENT_ORDER','OTHER')),
      party_tipo TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (party_tipo IN ('CUSTOMER','SUPPLIER','OTHER')),
      party_external_id TEXT,
      party_nombre TEXT NOT NULL DEFAULT '',
      numero TEXT NOT NULL DEFAULT '',
      fecha DATE,
      vencimiento DATE,
      total_centimos BIGINT NOT NULL DEFAULT 0,
      pendiente_centimos BIGINT NOT NULL DEFAULT 0,
      moneda TEXT NOT NULL DEFAULT 'EUR',
      estado TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (estado IN ('OPEN','PARTIALLY_PAID','PAID','CANCELLED')),
      -- Estado tal y como lo reporta la ERP, sin traducir: los dos modelos de
      -- estados no tienen por qué coincidir y perder el original impide
      -- diagnosticar una discrepancia.
      estado_erp TEXT,
      metadata JSONB,
      last_sync_at_ms BIGINT,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      -- La pareja (sistema, id) es lo que evita duplicados: un número de
      -- factura NO es único entre ERPs distintas.
      UNIQUE (empresa_id, external_system, external_id)
    );
    CREATE INDEX IF NOT EXISTS cash_extdoc_busqueda_idx
      ON cash_external_documents(empresa_id, tipo, estado);
    CREATE INDEX IF NOT EXISTS cash_extdoc_numero_idx
      ON cash_external_documents(empresa_id, numero);
    CREATE INDEX IF NOT EXISTS cash_extdoc_party_idx
      ON cash_external_documents(empresa_id, party_nombre);
  `);

  // ── Operaciones de caja ───────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_operations (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      session_id INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
      numero TEXT NOT NULL UNIQUE,

      tipo TEXT NOT NULL CHECK (tipo IN (
        'COLLECTION','PAYMENT','MANUAL_IN','MANUAL_OUT','CASH_DELIVERY',
        'BANK_DEPOSIT','ADJUSTMENT','OPENING_FLOAT','CLOSING_FLOAT')),
      origen TEXT NOT NULL DEFAULT 'MANUAL'
        CHECK (origen IN ('MANUAL','ERP','API','IMPORT','POS','OTHER')),

      -- Identificación del documento externo cuando lo hay. En una operación
      -- manual son NULL y no pasa nada: el motor se comporta igual.
      external_system TEXT,
      external_document_id TEXT,
      external_document_reference TEXT,
      documento_id INTEGER REFERENCES cash_external_documents(id) ON DELETE SET NULL,

      party_nombre TEXT NOT NULL DEFAULT '',
      concepto TEXT NOT NULL DEFAULT '',
      referencia TEXT,

      importe_centimos BIGINT NOT NULL,
      -- Efectivo neto que mueve la operación: en un cobro de 187 EUR pagado con
      -- 205 EUR y 18 EUR de cambio, es 18700. En una tarjeta, 0.
      efectivo_neto_centimos BIGINT NOT NULL DEFAULT 0,

      estado TEXT NOT NULL DEFAULT 'CONFIRMED'
        CHECK (estado IN ('DRAFT','CONFIRMED','REVERSED','CANCELLED')),
      -- Anulación por reversión: la operación original no se borra nunca.
      reversa_de_id INTEGER REFERENCES cash_operations(id) ON DELETE RESTRICT,
      motivo_reversa TEXT,

      erp_sync_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE'
        CHECK (erp_sync_status IN ('NOT_APPLICABLE','PENDING','SYNCING','SYNCED','ERROR','RETRY_PENDING','CANCELLED')),
      erp_sync_at_ms BIGINT,
      erp_error TEXT,

      created_by UUID,
      created_at_ms BIGINT NOT NULL,
      confirmed_at_ms BIGINT,
      updated_at_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cash_ops_session_idx ON cash_operations(session_id, created_at_ms DESC);
    CREATE INDEX IF NOT EXISTS cash_ops_tipo_idx ON cash_operations(empresa_id, tipo, created_at_ms DESC);
    CREATE INDEX IF NOT EXISTS cash_ops_origen_idx ON cash_operations(empresa_id, origen);
    CREATE INDEX IF NOT EXISTS cash_ops_sync_idx ON cash_operations(erp_sync_status)
      WHERE erp_sync_status IN ('PENDING','ERROR','RETRY_PENDING');
  `);

  /*
   * Un mismo documento de la ERP no se puede cobrar dos veces con la misma
   * operación. No se impide cobrar parcialmente varias veces (eso es legítimo),
   * solo que un reintento duplicado cree dos cobros: la clave es el número de
   * operación, que ya es único, más este índice sobre el documento externo para
   * poder localizar rápido lo cobrado de cada factura.
   */
  await pool.query(`
    CREATE INDEX IF NOT EXISTS cash_ops_extdoc_idx
      ON cash_operations(empresa_id, external_system, external_document_id)
      WHERE external_document_id IS NOT NULL;
  `);

  // ── Formas de pago de cada operación (soporta mixtos) ─────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_operation_payments (
      id SERIAL PRIMARY KEY,
      operation_id INTEGER NOT NULL REFERENCES cash_operations(id) ON DELETE RESTRICT,
      forma_pago TEXT NOT NULL,
      importe_centimos BIGINT NOT NULL,
      referencia TEXT,
      created_at_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cash_oppay_op_idx ON cash_operation_payments(operation_id);
  `);

  // ── Libro mayor de piezas ─────────────────────────────────────────────────
  // Inmutable: solo INSERT. El stock teórico es la suma de esto.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_denomination_movements (
      id BIGSERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
      operation_id INTEGER REFERENCES cash_operations(id) ON DELETE RESTRICT,
      denomination_id INTEGER NOT NULL REFERENCES cash_denominations(id) ON DELETE RESTRICT,
      direccion TEXT NOT NULL CHECK (direccion IN ('IN','OUT')),
      cantidad INTEGER NOT NULL CHECK (cantidad > 0),
      -- Se guarda el valor unitario además del id: si mañana alguien corrige la
      -- etiqueta o desactiva una denominación, un movimiento de hace un año
      -- tiene que seguir valiendo lo que valía.
      valor_unitario_centimos INTEGER NOT NULL,
      importe_centimos BIGINT NOT NULL,
      motivo TEXT NOT NULL CHECK (motivo IN (
        'OPENING_FLOAT','CUSTOMER_PAYMENT','CHANGE_GIVEN','SUPPLIER_PAYMENT',
        'MANUAL_IN','MANUAL_OUT','CASH_DELIVERY','BANK_DEPOSIT','ADJUSTMENT','CLOSING_FLOAT')),
      created_by UUID,
      created_at_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cash_denmov_session_idx ON cash_denomination_movements(session_id);
    CREATE INDEX IF NOT EXISTS cash_denmov_op_idx ON cash_denomination_movements(operation_id);
    CREATE INDEX IF NOT EXISTS cash_denmov_stock_idx
      ON cash_denomination_movements(session_id, denomination_id, direccion);
  `);

  // ── Arqueos ───────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_counts (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
      tipo TEXT NOT NULL DEFAULT 'CLOSING' CHECK (tipo IN ('INTERMEDIATE','CLOSING')),
      teorico_centimos BIGINT NOT NULL,
      contado_centimos BIGINT NOT NULL,
      diferencia_centimos BIGINT NOT NULL,
      denominaciones_cuadran BOOLEAN NOT NULL,
      piezas_teoricas INTEGER NOT NULL DEFAULT 0,
      piezas_contadas INTEGER NOT NULL DEFAULT 0,
      notas TEXT,
      created_by UUID,
      created_at_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cash_counts_session_idx ON cash_counts(session_id, created_at_ms DESC);

    CREATE TABLE IF NOT EXISTS cash_count_lines (
      id BIGSERIAL PRIMARY KEY,
      count_id INTEGER NOT NULL REFERENCES cash_counts(id) ON DELETE CASCADE,
      denomination_id INTEGER NOT NULL REFERENCES cash_denominations(id) ON DELETE RESTRICT,
      valor_unitario_centimos INTEGER NOT NULL,
      cantidad_teorica INTEGER NOT NULL DEFAULT 0,
      cantidad_contada INTEGER NOT NULL DEFAULT 0,
      -- Cartuchos contados aparte de las piezas sueltas, porque en el mostrador
      -- se cuentan aparte: 3 cartuchos de 2 EUR son 75 monedas.
      cartuchos_contados INTEGER NOT NULL DEFAULT 0,
      diferencia INTEGER NOT NULL DEFAULT 0,
      UNIQUE (count_id, denomination_id)
    );
    CREATE INDEX IF NOT EXISTS cash_countlines_count_idx ON cash_count_lines(count_id);
  `);

  // ── Integración ERP: configuración y outbox ───────────────────────────────
  // Sin fila = ERP NO CONFIGURADA, y el módulo funciona igual. La configuración
  // se asocia a empresa y opcionalmente a centro, para que en el futuro un
  // centro pueda tener ERP y otro trabajar a mano.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_erp_configs (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      -- '' = configuración para toda la empresa. NO se usa NULL: en Postgres
      -- dos NULL son distintos para un UNIQUE, así que (empresa, NULL) no
      -- deduplica y cada guardado insertaría una fila nueva en vez de
      -- actualizar la existente. Mismo criterio que cash_registers.centro.
      centro TEXT NOT NULL DEFAULT '',
      connector_key TEXT NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT false,
      -- Ajustes NO secretos (URL base, id de almacén, banderas). Las
      -- credenciales van por variables de entorno dentro del conector y no
      -- entran en esta tabla ni salen jamás hacia el navegador.
      ajustes JSONB NOT NULL DEFAULT '{}'::jsonb,
      permite_cobro_parcial BOOLEAN NOT NULL DEFAULT true,
      last_sync_at_ms BIGINT,
      last_status TEXT,
      last_error TEXT,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (empresa_id, centro)
    );
  `);

  /*
   * Outbox transaccional. El evento se escribe en la MISMA transacción que la
   * operación y sus movimientos; el worker lo envía después.
   *
   * Es lo que impide el fallo grave de este tipo de integraciones: el operador
   * cobra, el dinero entra físicamente en el cajón, la ERP contesta 503 y el
   * cobro se pierde. Aquí el cobro está guardado pase lo que pase, y lo único
   * que queda pendiente es avisar a la ERP.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_erp_outbox (
      id BIGSERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      operation_id INTEGER REFERENCES cash_operations(id) ON DELETE RESTRICT,
      connector_key TEXT,
      evento TEXT NOT NULL,
      -- Clave de idempotencia: el número de operación de Mobilink Cash. Un
      -- reintento con la misma clave no puede contabilizar el cobro dos veces.
      idempotency_key TEXT NOT NULL UNIQUE,
      payload JSONB NOT NULL,
      estado TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (estado IN ('PENDING','SYNCING','SYNCED','ERROR','RETRY_PENDING','CANCELLED')),
      intentos INTEGER NOT NULL DEFAULT 0,
      proximo_intento_ms BIGINT,
      last_error TEXT,
      response_payload JSONB,
      created_at_ms BIGINT NOT NULL,
      processed_at_ms BIGINT
    );
    CREATE INDEX IF NOT EXISTS cash_outbox_pendientes_idx
      ON cash_erp_outbox(estado, proximo_intento_ms)
      WHERE estado IN ('PENDING','RETRY_PENDING');
    CREATE INDEX IF NOT EXISTS cash_outbox_op_idx ON cash_erp_outbox(operation_id);
  `);

  // ── Log técnico de integración ────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_erp_logs (
      id BIGSERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      direccion TEXT NOT NULL CHECK (direccion IN ('IN','OUT')),
      evento TEXT NOT NULL,
      external_system TEXT,
      external_id TEXT,
      mobilink_id TEXT,
      estado TEXT NOT NULL,
      intentos INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at_ms BIGINT NOT NULL,
      processed_at_ms BIGINT
    );
    CREATE INDEX IF NOT EXISTS cash_erplogs_empresa_idx
      ON cash_erp_logs(empresa_id, created_at_ms DESC);
  `);

  // ── Contador de numeración propia (MC-C-2026-000001) ──────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_document_counters (
      clave TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0
    );
  `);

  await sembrarDenominaciones();

  console.log("Mobilink Cash: esquema inicializado correctamente");
}

/**
 * Semilla del catálogo de denominaciones.
 *
 * `ON CONFLICT DO NOTHING` a propósito: si alguien ha cambiado las piezas por
 * cartucho o ha desactivado la moneda de un céntimo, arrancar el servidor no
 * puede deshacer esa decisión. La semilla solo rellena lo que falta.
 */
async function sembrarDenominaciones(): Promise<void> {
  const ahora = Date.now();
  for (const d of DENOMINACIONES_SEMILLA) {
    await pool.query(
      `INSERT INTO cash_denominations
         (valor_centimos, tipo, etiqueta, piezas_por_cartucho, activa, orden, created_at_ms, updated_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (valor_centimos) DO NOTHING`,
      [d.valor, d.tipo, d.etiqueta, d.piezasPorCartucho, d.activa, d.orden, ahora]
    );
  }
}
