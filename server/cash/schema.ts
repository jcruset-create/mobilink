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
import { proponerCodigo } from "./domain/registercode.ts";
import { initAuditoria } from "../core/auditoriaSchema.ts";

export async function initCash(): Promise<void> {
  /*
   * La auditoría, lo primero.
   *
   * La crea la migración de la fundación SaaS, que se aplica a mano, así que en
   * una base sin ella las llamadas del módulo fallaban en silencio. Ahora se
   * asegura aquí: el módulo que audita es el que se ocupa de que haya dónde.
   */
  await initAuditoria();

  // ── Catálogo de denominaciones y cartuchos ────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_denominations (
      id SERIAL PRIMARY KEY,
      valor_centimos INTEGER NOT NULL UNIQUE,
      tipo TEXT NOT NULL CHECK (tipo IN ('BILLETE','MONEDA')),
      etiqueta TEXT NOT NULL,
      piezas_por_cartucho INTEGER,
      -- Monedas a granel que trae una bolsa del banco. NULL = esa denominación
      -- no viene en bolsa (los billetes, por ejemplo).
      piezas_por_bolsa INTEGER,
      -- Foto del billete o de la moneda, para las pantallas que quieran
      -- enseñarla. Es del catálogo, o sea de toda la instalación: un billete de
      -- 20 € es el mismo en todas las empresas.
      imagen_url TEXT,
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
      -- Fondo fijo del cajón: lo que esta caja tiene que tener SIEMPRE al
      -- empezar el día. Es una decisión de la caja, no del cierre de hoy, así
      -- que vive aquí y no se teclea cada tarde. 0 = sin fondo fijo, y
      -- entonces el cierre lo pregunta como antes.
      fondo_objetivo_centimos INTEGER NOT NULL DEFAULT 0,
      activa BOOLEAN NOT NULL DEFAULT true,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (empresa_id, centro, nombre)
    );
    CREATE INDEX IF NOT EXISTS cash_registers_empresa_idx ON cash_registers(empresa_id, activa);
  `);

  // ── Catálogo de formas de pago ────────────────────────────────────────────
  // Por empresa: cada una cobra por donde cobra. `codigo` es lo que se guarda
  // en cash_operation_payments, así que una forma dada de baja no cambia la
  // etiqueta de un cobro de hace un año — de ahí que la baja sea lógica.
  //
  // `afecta_efectivo` distingue la única forma que mueve el cajón físico. No es
  // un CHECK sobre el código porque el nombre lo cambia quien quiera, pero sí
  // hay un índice que impide que haya dos formas de efectivo en una empresa:
  // con dos, el desglose por denominación dejaría de ser interpretable.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_payment_methods (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      imagen_url TEXT,
      afecta_efectivo BOOLEAN NOT NULL DEFAULT false,
      pide_referencia BOOLEAN NOT NULL DEFAULT false,
      -- Dónde sale el botón. Se cobra por muchas vías y se paga casi siempre en
      -- efectivo, así que no es la misma lista: llenar la pantalla de pagos de
      -- botones que nadie pulsa solo estorba al que tiene prisa.
      en_cobros BOOLEAN NOT NULL DEFAULT true,
      en_pagos BOOLEAN NOT NULL DEFAULT false,
      activa BOOLEAN NOT NULL DEFAULT true,
      orden INTEGER NOT NULL DEFAULT 0,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (empresa_id, codigo)
    );
    CREATE INDEX IF NOT EXISTS cash_pay_methods_empresa_idx
      ON cash_payment_methods(empresa_id, activa, orden);
    CREATE UNIQUE INDEX IF NOT EXISTS cash_pay_methods_un_efectivo_idx
      ON cash_payment_methods(empresa_id) WHERE afecta_efectivo;

    ALTER TABLE cash_payment_methods
      ADD COLUMN IF NOT EXISTS en_cobros BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE cash_payment_methods
      ADD COLUMN IF NOT EXISTS en_pagos BOOLEAN NOT NULL DEFAULT false;

    -- El efectivo sale en las dos pantallas siempre: es el único que mueve el
    -- cajón, y una caja en la que no se pueda pagar en efectivo no es una caja.
    UPDATE cash_payment_methods SET en_pagos = true WHERE afecta_efectivo AND NOT en_pagos;
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
        'BANK_DEPOSIT','ADJUSTMENT','OPENING_FLOAT','CLOSING_FLOAT','EXCHANGE')),
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
        'MANUAL_IN','MANUAL_OUT','CASH_DELIVERY','BANK_DEPOSIT','ADJUSTMENT',
        'CLOSING_FLOAT','CARTRIDGE_OPENED','BAG_OPENED',
        'CARTRIDGE_FORMED','BAG_FORMED')),
      -- Tubos precintados que representa este asiento. 0 = monedas sueltas.
      -- La columna cantidad son SIEMPRE piezas: en una fila de cartuchos vale
      -- tubos x piezas_por_cartucho. Asi el total de piezas sigue siendo la
      -- suma de cantidad sin ningun caso especial, y las sueltas salen de
      -- filtrar por cartuchos = 0.
      cartuchos INTEGER NOT NULL DEFAULT 0,
      -- Bolsas precintadas que representa este asiento, con la misma regla que
      -- los cartuchos: la columna cantidad sigue siendo SIEMPRE piezas.
      bolsas INTEGER NOT NULL DEFAULT 0,
      created_by UUID,
      created_at_ms BIGINT NOT NULL,
      -- Un asiento es de un solo formato. Mezclar tubos y bolsas en la misma
      -- fila haría imposible saber qué precinto se rompió al abrirlo.
      CONSTRAINT cash_mov_un_formato CHECK (NOT (cartuchos > 0 AND bolsas > 0))
    );
    CREATE INDEX IF NOT EXISTS cash_denmov_session_idx ON cash_denomination_movements(session_id);
    CREATE INDEX IF NOT EXISTS cash_denmov_op_idx ON cash_denomination_movements(operation_id);
    CREATE INDEX IF NOT EXISTS cash_denmov_stock_idx
      ON cash_denomination_movements(session_id, denomination_id, direccion);
  `);

  /*
   * Cartuchos: se añade después del CREATE para las bases que ya existían.
   * Abrir un tubo es irreversible y deja su propio par de asientos
   * (CARTRIDGE_OPENED), así que el rastro del efectivo sigue cuadrando.
   *
   * La lista de motivos NO se toca aquí. La tiene un único bloque, más abajo,
   * con la lista completa: cuando dos sitios recreaban el mismo CHECK, el de
   * arriba —con la lista vieja— se lo cargaba al arrancar sobre una base que
   * ya tenía asientos del motivo nuevo, y el servidor no levantaba.
   */
  await pool.query(`
    ALTER TABLE cash_denomination_movements
      ADD COLUMN IF NOT EXISTS cartuchos INTEGER NOT NULL DEFAULT 0;
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
      -- Bolsas contadas aparte, como los cartuchos: en el mostrador se cuentan
      -- sin abrirlas.
      bolsas_contadas INTEGER NOT NULL DEFAULT 0,
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

  // ── Documentos escaneados de una operación ────────────────────────────────
  // La factura o el ticket que respalda un cobro o un pago. El fichero vive en
  // el almacenamiento (bucket privado); aquí solo la referencia y sus datos.
  //
  // Se anula, no se borra, como todo en este módulo: un justificante retirado
  // deja de salir en el informe pero se sabe que existió y quién lo quitó.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_operation_documents (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      -- NULL = documento de la jornada entera, no de una operación suelta: el
      -- taco de facturas escaneado de una vez, el resguardo del banco. Cuelga
      -- de la jornada y no de un cobro concreto porque no es de ninguno.
      operation_id INTEGER REFERENCES cash_operations(id) ON DELETE RESTRICT,
      -- Repetido a propósito: el informe de cierre pide todos los documentos de
      -- una jornada, y sin esto habría que pasar por las operaciones cada vez.
      session_id INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,

      nombre TEXT NOT NULL,
      mime TEXT NOT NULL,
      tamano_bytes INTEGER NOT NULL,
      /* Ruta dentro del bucket. La URL no se guarda: se firma al pedirla, para
         que un enlace copiado hace un mes ya no abra la factura de un cliente. */
      ruta TEXT NOT NULL,

      anulado BOOLEAN NOT NULL DEFAULT false,
      anulado_por UUID,
      anulado_at_ms BIGINT,
      anulado_motivo TEXT,

      subido_por UUID,
      subido_at_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cash_op_docs_operacion_idx
      ON cash_operation_documents(operation_id) WHERE NOT anulado;
    CREATE INDEX IF NOT EXISTS cash_op_docs_sesion_idx
      ON cash_operation_documents(session_id) WHERE NOT anulado;
  `);

  // ── Pedidos de cambio al banco ────────────────────────────────────────────
  // Se acumulan billetes y se va al banco a por calderilla. Entre que el dinero
  // sale y vuelve pasan horas o días, y ese hueco TIENE que verse: si no, el
  // arqueo de la tarde descuadra 200 € sin explicación.
  //
  // Cruza jornadas a propósito (`session_id_salida` ≠ `session_id_entrada`): el
  // banco no siempre contesta el mismo día. Cada asiento pertenece a la jornada
  // en la que ocurrió, así que los dos arqueos cuadran por separado.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_change_orders (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      register_id INTEGER NOT NULL REFERENCES cash_registers(id) ON DELETE RESTRICT,
      numero TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE','RECIBIDO','CANCELADO')),

      importe_centimos BIGINT NOT NULL,
      /* Lo que el banco ha dado de verdad. Puede no coincidir con lo pedido. */
      importe_recibido_centimos BIGINT,
      diferencia_motivo TEXT,

      session_id_salida INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
      session_id_entrada INTEGER REFERENCES cash_sessions(id) ON DELETE RESTRICT,
      operation_salida_id INTEGER REFERENCES cash_operations(id) ON DELETE RESTRICT,
      operation_entrada_id INTEGER REFERENCES cash_operations(id) ON DELETE RESTRICT,

      notas TEXT,
      creado_por UUID,
      creado_at_ms BIGINT NOT NULL,
      cerrado_por UUID,
      cerrado_at_ms BIGINT,
      UNIQUE (empresa_id, numero)
    );
    CREATE INDEX IF NOT EXISTS cash_change_orders_abiertos_idx
      ON cash_change_orders(register_id, estado);

    CREATE TABLE IF NOT EXISTS cash_change_order_lines (
      id SERIAL PRIMARY KEY,
      change_order_id INTEGER NOT NULL REFERENCES cash_change_orders(id) ON DELETE CASCADE,
      /* SOLICITADO: lo que se le pide al banco. ENVIADO: los billetes que salen
         de la caja. RECIBIDO: lo que el banco acaba dando. */
      rol TEXT NOT NULL CHECK (rol IN ('SOLICITADO','ENVIADO','RECIBIDO')),
      valor_centimos INTEGER NOT NULL,
      cantidad INTEGER NOT NULL CHECK (cantidad > 0),
      cartuchos INTEGER NOT NULL DEFAULT 0,
      bolsas INTEGER NOT NULL DEFAULT 0,
      motivo TEXT
    );
    CREATE INDEX IF NOT EXISTS cash_change_order_lines_idx
      ON cash_change_order_lines(change_order_id, rol);
  `);

  // ── Entregas de dinero a personas ─────────────────────────────────────────
  // Se le dan 50 € a un empleado para que compre algo. Ese billete ya no está
  // en el cajón, y sin registrarlo el descuadre aparece en el arqueo del turno
  // siguiente sin que nadie recuerde a quién se le dio.
  //
  // Al liquidar, el pago que se registra es el REAL (la factura), y no vuelve a
  // mover piezas: salieron al entregar. Solo entra la vuelta.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_advances (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      register_id INTEGER NOT NULL REFERENCES cash_registers(id) ON DELETE RESTRICT,
      numero TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'ABIERTA'
        CHECK (estado IN ('ABIERTA','LIQUIDADA','DEVUELTA','CANCELADA')),

      persona TEXT NOT NULL,
      motivo TEXT NOT NULL,
      importe_centimos BIGINT NOT NULL,

      /* Al liquidar: lo que dice la factura y lo que ha vuelto en piezas. */
      gasto_centimos BIGINT,
      devuelto_centimos BIGINT,
      /* Entregado − devuelto − gastado. Distinto de cero = falta dinero. */
      diferencia_centimos BIGINT,
      diferencia_motivo TEXT,
      factura_referencia TEXT,
      proveedor TEXT,

      session_id_entrega INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
      session_id_liquidacion INTEGER REFERENCES cash_sessions(id) ON DELETE RESTRICT,
      operation_entrega_id INTEGER REFERENCES cash_operations(id) ON DELETE RESTRICT,
      operation_devolucion_id INTEGER REFERENCES cash_operations(id) ON DELETE RESTRICT,
      operation_pago_id INTEGER REFERENCES cash_operations(id) ON DELETE RESTRICT,

      notas TEXT,
      creado_por UUID,
      creado_at_ms BIGINT NOT NULL,
      cerrado_por UUID,
      cerrado_at_ms BIGINT,
      UNIQUE (empresa_id, numero)
    );
    CREATE INDEX IF NOT EXISTS cash_advances_abiertas_idx
      ON cash_advances(register_id, estado);
  `);

  // ── Ingresos bancarios ────────────────────────────────────────────────────
  // El cierre de cada jornada aparta un importe "para el banco", pero al banco
  // no se va cada día: se acumulan varios cierres y se hace un ingreso que los
  // agrupa. Y el banco solo admite billetes, así que las monedas que no se
  // consiguen convertir se quedan en tienda como remanente, que arrastra al
  // ingreso siguiente.
  //
  // La ecuación que lo gobierna todo va como CHECK, no como validación de
  // código: remanente anterior + cierres − ingresado = remanente nuevo. Ningún
  // error de programa puede escribir una fila que descuadre.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_bank_deposits (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      register_id INTEGER NOT NULL REFERENCES cash_registers(id) ON DELETE RESTRICT,
      numero TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'CONFIRMADO' CHECK (estado IN ('CONFIRMADO','ANULADO')),

      fecha_ingreso DATE,
      referencia TEXT,
      observaciones TEXT,

      remanente_anterior_centimos BIGINT NOT NULL CHECK (remanente_anterior_centimos >= 0),
      total_cierres_centimos BIGINT NOT NULL CHECK (total_cierres_centimos >= 0),
      importe_centimos BIGINT NOT NULL CHECK (importe_centimos > 0),
      remanente_nuevo_centimos BIGINT NOT NULL CHECK (remanente_nuevo_centimos >= 0),
      CONSTRAINT cash_bank_deposits_ecuacion CHECK (
        remanente_anterior_centimos + total_cierres_centimos - importe_centimos
          = remanente_nuevo_centimos
      ),

      creado_por UUID,
      creado_at_ms BIGINT NOT NULL,
      anulado_por UUID,
      anulado_at_ms BIGINT,
      anulado_motivo TEXT,
      UNIQUE (empresa_id, numero)
    );
    CREATE INDEX IF NOT EXISTS cash_bank_deposits_caja_idx
      ON cash_bank_deposits(register_id, estado, id DESC);

    -- Qué cierres componen cada ingreso. \`vigente\` baja a false al anular el
    -- ingreso, y el índice único parcial es lo que impide A NIVEL DE BASE DE
    -- DATOS que el mismo cierre entre en dos ingresos a la vez: dos usuarios
    -- simultáneos no pueden colarse ni queriendo.
    CREATE TABLE IF NOT EXISTS cash_bank_deposit_sessions (
      id SERIAL PRIMARY KEY,
      deposit_id INTEGER NOT NULL REFERENCES cash_bank_deposits(id) ON DELETE RESTRICT,
      session_id INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
      importe_centimos BIGINT NOT NULL CHECK (importe_centimos >= 0),
      vigente BOOLEAN NOT NULL DEFAULT true
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cash_bank_dep_ses_unico_idx
      ON cash_bank_deposit_sessions(session_id) WHERE vigente;
    CREATE INDEX IF NOT EXISTS cash_bank_dep_ses_deposito_idx
      ON cash_bank_deposit_sessions(deposit_id);
  `);

  // ── Contador de numeración propia (MC-C-2026-000001) ──────────────────────
  await pool.query(`
  CREATE TABLE IF NOT EXISTS cash_document_counters (
      clave TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0
    );
  `);

  /*
   * Bolsas de monedas: migración para bases que ya existen.
   *
   * El DDL de arriba es `CREATE TABLE IF NOT EXISTS`, así que en una base que
   * ya está creada no añade nada. Estas columnas son las que hacen que la
   * bolsa exista en una instalación en marcha.
   *
   * La bolsa es el precinto grande del banco: monedas a granel, cientos de
   * ellas. Misma mecánica que el cartucho —`cantidad` sigue siendo SIEMPRE
   * piezas y `bolsas` dice cuántos precintos representan— y por eso el CHECK:
   * un asiento es de un solo formato, porque si mezclara tubos y bolsas no se
   * sabría qué precinto se rompió al abrirlo.
   */
  await pool.query(`
    ALTER TABLE cash_denominations
      ADD COLUMN IF NOT EXISTS piezas_por_bolsa INTEGER;

    ALTER TABLE cash_denomination_movements
      ADD COLUMN IF NOT EXISTS bolsas INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE cash_denomination_movements
      DROP CONSTRAINT IF EXISTS cash_mov_un_formato;
    ALTER TABLE cash_denomination_movements
      ADD CONSTRAINT cash_mov_un_formato CHECK (NOT (cartuchos > 0 AND bolsas > 0));

    ALTER TABLE cash_count_lines
      ADD COLUMN IF NOT EXISTS bolsas_contadas INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE cash_change_order_lines
      ADD COLUMN IF NOT EXISTS bolsas INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE cash_denominations
      ADD COLUMN IF NOT EXISTS imagen_url TEXT;

    ALTER TABLE cash_registers
      ADD COLUMN IF NOT EXISTS fondo_objetivo_centimos INTEGER NOT NULL DEFAULT 0;

    /* Un documento puede colgar de la jornada entera y no de una operación:
       el taco de facturas escaneado de una vez o el resguardo del banco. */
    ALTER TABLE cash_operation_documents
      ALTER COLUMN operation_id DROP NOT NULL;
  `);

  /*
   * Canjes de monedas por billetes para poder ingresar en el banco.
   *
   * El banco solo admite billetes, así que la parte del montón pendiente que
   * está en monedas se cambia por billetes del cajón. El canje en sí es una
   * operación normal (`EXCHANGE`) de la jornada abierta —mueve el cajón y por
   * eso tiene que estar en su libro mayor—; lo que hace falta anotar aparte es
   * que ese canje era CONTRA EL MONTÓN, para poder recomponerlo:
   *
   *     montón = Σ BANK_DEPOSIT − Σ entradas del canje + Σ salidas del canje
   *
   * `bank_deposit_id` a NULL significa «todavía cuenta»; al registrar el
   * ingreso se rellena y el canje deja de afectar al montón siguiente. Sin eso,
   * el ajuste se arrastraría para siempre y el montón de la semana que viene
   * saldría mal.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_deposit_swaps (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      register_id INTEGER NOT NULL REFERENCES cash_registers(id) ON DELETE RESTRICT,
      operation_id INTEGER NOT NULL REFERENCES cash_operations(id) ON DELETE RESTRICT,
      bank_deposit_id INTEGER REFERENCES cash_bank_deposits(id) ON DELETE RESTRICT,
      created_at_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cash_deposit_swaps_pendientes_idx
      ON cash_deposit_swaps(register_id) WHERE bank_deposit_id IS NULL;
  `);

  /*
   * Los motivos y tipos nuevos en los CHECK. Se recrean enteros porque un
   * CHECK no se amplía: se tira y se vuelve a poner. El nombre es el que
   * genera Postgres para un CHECK de columna, el DROP va con IF EXISTS para
   * que en una base nueva —donde ya viene bien de fábrica— no falle, y cada
   * CHECK se recrea en UN único sitio: cuando hubo dos, el segundo aplicaba la
   * lista vieja sobre filas que ya usaban el valor nuevo y el arranque moría.
   */
  await pool.query(`
    ALTER TABLE cash_denomination_movements
      DROP CONSTRAINT IF EXISTS cash_denomination_movements_motivo_check;
    ALTER TABLE cash_denomination_movements
      ADD CONSTRAINT cash_denomination_movements_motivo_check CHECK (motivo IN (
        'OPENING_FLOAT','CUSTOMER_PAYMENT','CHANGE_GIVEN','SUPPLIER_PAYMENT',
        'MANUAL_IN','MANUAL_OUT','CASH_DELIVERY','BANK_DEPOSIT','ADJUSTMENT',
        'CLOSING_FLOAT','CARTRIDGE_OPENED','BAG_OPENED','EXCHANGE',
        'CARTRIDGE_FORMED','BAG_FORMED'));

    ALTER TABLE cash_operations
      DROP CONSTRAINT IF EXISTS cash_operations_tipo_check;
    ALTER TABLE cash_operations
      ADD CONSTRAINT cash_operations_tipo_check CHECK (tipo IN (
        'COLLECTION','PAYMENT','MANUAL_IN','MANUAL_OUT','CASH_DELIVERY',
        'BANK_DEPOSIT','ADJUSTMENT','OPENING_FLOAT','CLOSING_FLOAT','EXCHANGE'));
  `);

  /*
   * Secciones de negocio dentro de una misma caja.
   *
   * El modelo estándar del módulo es «una caja = un cajón = una liquidación».
   * Este taller tiene DOS negocios —taller y gasolinera— que liquidan por
   * separado pero comparten un único cajón. Partirlo en dos cajas rompería el
   * arqueo, porque no se puede contar dos veces el mismo billete; dejarlo en
   * una sola perdería la liquidación separada, que es justo lo que hace falta.
   *
   * La salida es esta: **el cajón y su arqueo siguen siendo uno solo** —el
   * dinero real se cuenta una vez— y lo que se parte es la liquidación,
   * etiquetando cada operación con su sección.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_sections (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      activa BOOLEAN NOT NULL DEFAULT true,
      -- La que se propone sola al cobrar y con la que se rellenan los pagos.
      por_defecto BOOLEAN NOT NULL DEFAULT false,
      orden INTEGER NOT NULL DEFAULT 0,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (empresa_id, codigo)
    );
    CREATE INDEX IF NOT EXISTS cash_sections_empresa_idx
      ON cash_sections(empresa_id, activa, orden);
  `);

  /*
   * Una sola sección por defecto por empresa. Índice único parcial y no una
   * comprobación en el código: con dos marcadas, «la de por defecto» dejaría
   * de significar nada y la elegida dependería del orden de la consulta.
   */
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS cash_sections_una_por_defecto_idx
      ON cash_sections(empresa_id) WHERE por_defecto;
  `);

  /*
   * La sección de cada operación.
   *
   * NULL a propósito y sin valor por defecto: las operaciones registradas
   * antes de que existieran las secciones no pertenecen a ninguna, y
   * inventarles una sería peor que dejarlo en blanco. Se reasignan a mano
   * desde el histórico si hace falta.
   *
   * Los pagos y salidas llevan el campo aunque la pantalla no lo pregunte y lo
   * rellene siempre con la sección por defecto: tenerlo desde el primer día
   * ahorra una migración con datos reales dentro el día que se quiera imputar
   * el gasto a cada negocio.
   */
  await pool.query(`
    ALTER TABLE cash_operations
      ADD COLUMN IF NOT EXISTS section_id INTEGER REFERENCES cash_sections(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS cash_operations_section_idx
      ON cash_operations(session_id, section_id);
  `);

  /*
   * Ajustes sueltos del módulo, por empresa.
   *
   * El primero es la imagen del botón «Mixto». Mixto NO es una forma de pago
   * —es un reparto entre varias— y por eso no puede tener una fila en
   * `cash_payment_methods`: si la tuviera, alguien podría registrar un cobro
   * «en Mixto», que no significa nada, y el importe entraría en caja sin decir
   * por qué vía llegó. Una tabla de clave/valor lo deja donde toca.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_settings (
      empresa_id UUID NOT NULL,
      clave TEXT NOT NULL,
      valor TEXT,
      updated_at_ms BIGINT NOT NULL,
      PRIMARY KEY (empresa_id, clave)
    );
  `);

  /*
   * Código de la caja: las iniciales que identifican de dónde sale cada
   * documento.
   *
   * Con central y varios talleres, el número tiene que decir de qué caja vino
   * el dinero: es lo que permite conciliar los ingresos contra el extracto del
   * banco. Antes el contador era único para toda la instalación, así que dos
   * cajas del mismo taller compartían serie y el número no distinguía nada.
   *
   * Va en la caja y no en el centro porque un taller puede tener mostrador y
   * taller ingresando por separado el mismo día.
   */
  await pool.query(`
    ALTER TABLE cash_registers
      ADD COLUMN IF NOT EXISTS codigo TEXT NOT NULL DEFAULT '';

    -- Único mientras exista, pero se admite el vacío: una caja recién creada
    -- todavía no tiene código y no puede chocar con otra igual de vacía.
    CREATE UNIQUE INDEX IF NOT EXISTS cash_registers_codigo_idx
      ON cash_registers(empresa_id, codigo) WHERE codigo <> '';
  `);

  /*
   * Secciones que se arquean aparte en la ERP.
   *
   * Taller y gasolinera comparten CAJÓN pero son dos cajas distintas en Genes,
   * y cada una se cierra por su lado. El arqueo del cajón entero no cuadra
   * contra ninguna de las dos: hay que repartirlo.
   *
   * La marca va por sección y no se deduce de «por defecto» porque mañana
   * puede haber una sección más que SÍ cierre en la misma caja de Genes;
   * deducirlo la separaría sin que nadie lo pidiera.
   */
  await pool.query(`
    ALTER TABLE cash_sections
      ADD COLUMN IF NOT EXISTS arquea_aparte BOOLEAN NOT NULL DEFAULT false;
  `);

  /*
   * Jerarquía: ZONA → TALLER → CAJA (MC Central, fase 1).
   *
   * Hasta aquí `cash_registers.centro` era texto libre, así que agrupar cajas
   * por taller era agrupar cadenas. Se añade el vínculo real, y la columna de
   * texto SE QUEDA: la usan los informes y el `ON CONFLICT (empresa_id, centro,
   * nombre)` del alta de cajas. Se retirará cuando el backfill esté verificado
   * contra datos reales, no antes.
   *
   * Todo NULLABLE, y no por descuido: esto se ejecuta en CADA arranque, así que
   * un NOT NULL prematuro no rompe una migración —impide arrancar el proceso—.
   * Es el mismo fallo que ya costó un incidente con el CHECK de motivos.
   *
   * Las claves ajenas hacia `app_*` viven en la migración de Supabase
   * (`supabase/migrations/central_fase1_jerarquia.sql`) y aquí se ponen solo si
   * esas tablas existen. Motivo: las pruebas de integración levantan una base
   * desechable donde solo corre `initCash()`, sin la fundación SaaS; con la
   * clave ajena incondicional, arrancar contra esa base fallaría. Es la misma
   * razón por la que `empresa_id` nunca ha tenido FK en este esquema.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_zonas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      nombre TEXT NOT NULL,
      activa BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_app_zonas_empresa ON app_zonas(empresa_id, activa);
    -- El nombre es único dentro de la empresa, no en toda la instalación: dos
    -- empresas pueden tener cada una su zona «Norte» sin saber la una de la otra.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_app_zonas_nombre
      ON app_zonas(empresa_id, lower(nombre));

    ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS centro_id UUID;
    CREATE INDEX IF NOT EXISTS cash_registers_centro_idx ON cash_registers(centro_id);
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('public.app_centros') IS NOT NULL THEN
        ALTER TABLE app_centros ADD COLUMN IF NOT EXISTS zona_id UUID;
        CREATE INDEX IF NOT EXISTS idx_app_centros_zona ON app_centros(zona_id);
      END IF;
    END $$;
  `);

  /*
   * Cola de eventos de dominio hacia MC Central (fase 2).
   *
   * Es hermana de `cash_erp_outbox` y no la misma tabla a propósito: aquella
   * lleva `connector_key` y una clave ajena a `cash_operations`, y está en
   * producción. Mezclar dos dominios en una cola viva es riesgo gratuito.
   *
   * Y hay una diferencia que manda sobre todo el diseño: esta fila se escribe
   * DENTRO de la transacción que mueve el dinero. Si su INSERT fallara, se
   * desharía un cobro que ya ocurrió físicamente, que es la peor avería posible
   * en este módulo. Por eso aquí NO hay clave ajena, ni CHECK sobre el tipo, ni
   * ninguna restricción que dependa de los datos: lo único que puede rechazar
   * esta fila es que la base esté caída, y entonces el cobro tampoco se guarda.
   *
   * `estado` sí lleva CHECK porque su lista la escribe el worker, no los datos,
   * y vive en un solo sitio —éste— para no repetir el incidente de los motivos
   * de movimiento, donde dos bloques recreaban el mismo CHECK con listas
   * distintas y el servidor dejaba de arrancar.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_event_outbox (
      id BIGSERIAL PRIMARY KEY,
      -- Clave de deduplicación en destino. Se genera aquí y viaja como
      -- Idempotency-Key: reenviar el mismo evento no lo cuenta dos veces.
      event_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
      empresa_id UUID NOT NULL,
      -- El taller se copia en el evento aunque se pueda deducir de la caja:
      -- Central agrega por taller y no debería tener que preguntar por una
      -- caja que quizá se reasignó después. El evento cuenta lo que pasó
      -- ENTONCES, y eso incluye dónde pasó.
      centro_id UUID,
      register_id INTEGER,
      session_id INTEGER,
      aggregate_type TEXT,
      aggregate_id BIGINT,
      aggregate_version BIGINT,
      tipo TEXT NOT NULL,
      -- Cuándo OCURRIÓ, que no es cuándo se envía ni cuándo se tecleó.
      ocurrido_en_ms BIGINT NOT NULL,
      actor_user_id UUID,
      datos JSONB NOT NULL DEFAULT '{}'::jsonb,
      estado TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (estado IN ('PENDING','SENDING','SENT','ERROR','RETRY_PENDING','CANCELLED')),
      intentos INTEGER NOT NULL DEFAULT 0,
      proximo_intento_ms BIGINT,
      last_error TEXT,
      created_at_ms BIGINT NOT NULL,
      processed_at_ms BIGINT
    );

    CREATE INDEX IF NOT EXISTS cash_events_pendientes_idx
      ON cash_event_outbox(estado, proximo_intento_ms)
      WHERE estado IN ('PENDING','RETRY_PENDING');
    CREATE INDEX IF NOT EXISTS cash_events_empresa_idx
      ON cash_event_outbox(empresa_id, created_at_ms DESC);
    -- Orden de reconstrucción para Central: por agregado y versión.
    CREATE INDEX IF NOT EXISTS cash_events_agregado_idx
      ON cash_event_outbox(aggregate_type, aggregate_id, aggregate_version);
  `);

  /*
   * Versión del agregado, para que Central detecte un hueco o un evento que
   * llega tarde sin tener que fiarse del reloj.
   *
   * Sube dentro de bloqueos que YA existen —la jornada en `bloquearSesion` y la
   * caja en los ingresos bancarios—, así que no añade contención ninguna: el
   * incremento va donde ya había un `FOR UPDATE`.
   *
   * `NOT NULL DEFAULT 0` sobre una tabla con datos no reescribe las filas
   * (PostgreSQL guarda el valor por defecto en el catálogo desde la 11), así
   * que es seguro aunque la tabla sea grande.
   */
  await pool.query(`
    ALTER TABLE cash_sessions  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE cash_registers ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;
  `);

  /*
   * Integridad y versión de los justificantes (fase 9 de MC Central).
   *
   * · `sha256` es la huella del fichero tal y como se subió. Sirve para dos
   *   cosas: comprobar que lo que hay en el bucket hoy es lo mismo que se
   *   adjuntó —una factura que respalda una salida de caja no puede cambiar sin
   *   que se note— y detectar que el mismo papel se ha subido dos veces.
   *
   * · `version` y `reemplaza_a` porque un justificante SE SUSTITUYE, no se
   *   corrige: el escaneo salió torcido y se vuelve a escanear. El anterior se
   *   marca sustituido y se queda. Aquí no se borra nada, y menos lo que
   *   respalda un movimiento de dinero.
   *
   * Nullable: los documentos anteriores a esta fase no tienen huella, y eso es
   * un dato en sí mismo —no se puede verificar lo que se subió antes de
   * empezar a medirlo— no algo que haya que inventar.
   */
  await pool.query(`
    ALTER TABLE cash_operation_documents
      ADD COLUMN IF NOT EXISTS sha256 TEXT,
      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS reemplaza_a INTEGER,
      ADD COLUMN IF NOT EXISTS sustituido BOOLEAN NOT NULL DEFAULT false;

    CREATE INDEX IF NOT EXISTS cash_docs_sha_idx
      ON cash_operation_documents(empresa_id, sha256) WHERE sha256 IS NOT NULL;
  `);

  /*
   * Marca de reautenticación reciente.
   *
   * En la base y no en memoria: en Render hay varias instancias y la siguiente
   * petición puede caer en otra. Con un mapa en memoria, reautenticarse valdría
   * o no según a quién le tocara responder — intermitente y sin explicación,
   * que es la peor clase de fallo.
   *
   * Una fila por usuario, que se pisa: no interesa el histórico de cuándo se ha
   * identificado cada uno, y para eso ya está la auditoría.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_reauth (
      user_id UUID PRIMARY KEY,
      hasta_ms BIGINT NOT NULL
    );
  `);

  /*
   * Índice de cobertura para las consultas de consumo (fases 17 a 20).
   *
   * La predicción y el reparto preguntan lo mismo por cada caja: qué piezas han
   * salido dando cambio. Sin este índice, PostgreSQL recorría **la tabla
   * entera** de movimientos para contestarlo, así que el coste crecía con el
   * libro mayor de toda la empresa en vez de con la historia de esa caja — y el
   * libro mayor no mengua nunca.
   *
   * Medido sobre 365.000 movimientos (5 cajas, dos años): la llamada que hace
   * la pantalla de reparto pasa de 230 ms a 140 ms, y el plan deja de ser un
   * recorrido completo para ser una lectura solo del índice.
   *
   * `INCLUDE` en vez de más columnas de clave: no se busca por importe ni por
   * cantidad, solo se leen, y así el índice ocupa menos y no se reordena por
   * ellas.
   */
  await pool.query(`
    CREATE INDEX IF NOT EXISTS cash_denmov_consumo_idx
      ON cash_denomination_movements (session_id, motivo, direccion)
      INCLUDE (valor_unitario_centimos, cantidad);
  `);

  /*
   * Traslados de efectivo entre cajas de la misma empresa.
   *
   * La fase 19 sabía proponerlos —cruzar lo que sobra en una con lo que falta
   * en otra— pero no podía ejecutarlos, y por un motivo concreto: **en medio
   * del viaje el dinero no está en ninguna de las dos cajas**. Sin un documento
   * que lo represente, ese dinero se contaría dos veces o ninguna, que es el
   * doble conteo que la fase 4 vino a cerrar.
   *
   * Este es ese documento. La regla que lo sostiene es la misma que ya rige los
   * pedidos de cambio al banco y las entregas: **los asientos se hacen cuando
   * el dinero se mueve, no cuando se planea**. Al crear el traslado sale del
   * cajón de origen; al recibirlo entra en el de destino; en medio, ninguna de
   * las dos lo tiene y el tránsito dice dónde está y quién lo lleva.
   *
   * Cruza jornadas a propósito: se sale de un taller por la tarde y se llega al
   * otro al día siguiente. Cada asiento pertenece a la jornada en la que
   * ocurrió.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_transfers (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      numero TEXT NOT NULL,
      origen_register_id INTEGER NOT NULL REFERENCES cash_registers(id) ON DELETE RESTRICT,
      destino_register_id INTEGER NOT NULL REFERENCES cash_registers(id) ON DELETE RESTRICT,
      -- Una caja no se manda dinero a sí misma: sería un asiento de ida y otro
      -- de vuelta por el mismo importe, o sea, ruido en el libro mayor.
      CONSTRAINT cash_transfers_distintas CHECK (origen_register_id <> destino_register_id),

      estado TEXT NOT NULL DEFAULT 'EN_TRANSITO'
        CHECK (estado IN ('EN_TRANSITO','RECIBIDO','CANCELADO')),
      importe_centimos BIGINT NOT NULL CHECK (importe_centimos > 0),
      /* Lo que de verdad llegó, que puede no ser lo que salió. */
      recibido_centimos BIGINT,
      diferencia_motivo TEXT,

      /** Quién lleva la bolsa. Es lo que se pregunta cuando no aparece. */
      portador TEXT,
      notas TEXT,

      session_id_salida INTEGER REFERENCES cash_sessions(id) ON DELETE RESTRICT,
      operation_salida_id INTEGER REFERENCES cash_operations(id) ON DELETE RESTRICT,
      session_id_entrada INTEGER REFERENCES cash_sessions(id) ON DELETE RESTRICT,
      operation_entrada_id INTEGER REFERENCES cash_operations(id) ON DELETE RESTRICT,

      creado_por UUID,
      creado_at_ms BIGINT NOT NULL,
      cerrado_por UUID,
      cerrado_at_ms BIGINT
    );

    CREATE INDEX IF NOT EXISTS cash_transfers_empresa_idx
      ON cash_transfers(empresa_id, estado);
    CREATE INDEX IF NOT EXISTS cash_transfers_destino_idx
      ON cash_transfers(destino_register_id, estado);

    CREATE TABLE IF NOT EXISTS cash_transfer_lines (
      transfer_id INTEGER NOT NULL REFERENCES cash_transfers(id) ON DELETE CASCADE,
      -- ENVIADO o RECIBIDO: se guardan las dos, porque comparar lo que salió
      -- con lo que llegó es justo lo que hay que poder hacer.
      rol TEXT NOT NULL CHECK (rol IN ('ENVIADO','RECIBIDO')),
      valor_centimos INTEGER NOT NULL,
      cantidad INTEGER NOT NULL,
      PRIMARY KEY (transfer_id, rol, valor_centimos)
    );
  `);

  /*
   * El comprobante del banco se adjunta AL INGRESO, no a una jornada.
   *
   * Un ingreso junta varios cierres —el resguardo que da el banco cubre los
   * tres días de golpe— así que colgarlo de una jornada concreta sería mentir:
   * ¿de cuál? La fila de documentos gana un ancla más (`deposit_id`) y
   * `session_id` deja de ser obligatorio, con un CHECK que exige exactamente
   * un dueño: o jornada (con o sin operación) o ingreso, nunca ambos ni
   * ninguno. `documentosDeJornada` filtra por `session_id`, así que los
   * comprobantes de ingresos no se cuelan en los informes de cierre.
   */
  await pool.query(`
    ALTER TABLE cash_operation_documents
      ADD COLUMN IF NOT EXISTS deposit_id INTEGER REFERENCES cash_bank_deposits(id) ON DELETE RESTRICT;
    ALTER TABLE cash_operation_documents
      ALTER COLUMN session_id DROP NOT NULL;
    ALTER TABLE cash_operation_documents
      DROP CONSTRAINT IF EXISTS cash_opdoc_un_ancla;
    ALTER TABLE cash_operation_documents
      ADD CONSTRAINT cash_opdoc_un_ancla CHECK (
        (session_id IS NOT NULL AND deposit_id IS NULL)
        OR (session_id IS NULL AND deposit_id IS NOT NULL AND operation_id IS NULL)
      );
    CREATE INDEX IF NOT EXISTS cash_opdoc_deposit_idx
      ON cash_operation_documents(deposit_id) WHERE deposit_id IS NOT NULL;
  `);

  /*
   * Maestro de bancos, por empresa.
   *
   * El `codigo` son las cuatro cifras de entidad del IBAN, que es lo que
   * permite reconocer el banco al teclear la cuenta. Va por empresa y no
   * global porque el logotipo lo sube cada una: la lista de bancos es la misma
   * para todos, pero la imagen no se puede compartir entre inquilinos.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_banks (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      logo_url TEXT,
      activo BOOLEAN NOT NULL DEFAULT true,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (empresa_id, codigo)
    );
    CREATE INDEX IF NOT EXISTS cash_banks_empresa_idx ON cash_banks(empresa_id, activo);
  `);

  /*
   * Cuentas bancarias de la empresa: a dónde va el dinero de cada ingreso.
   *
   * Sin esto, un ingreso decía cuánto y cuándo pero no A DÓNDE, y con dos
   * bancos abiertos eso es justo lo que hace falta para conciliar contra el
   * extracto correcto.
   *
   * `activa` en vez de borrar: una cuenta que se cierra sigue siendo la de los
   * ingresos que ya se hicieron, y borrarla los dejaría huérfanos.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_bank_accounts (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      banco TEXT NOT NULL,
      /* IBAN normalizado: sin espacios y en mayúsculas, como se compara. */
      iban TEXT NOT NULL,
      /* Nombre corto para el desplegable: «BBVA nómina», «Caixa taller». */
      alias TEXT NOT NULL DEFAULT '',
      /* Logotipo del banco, para que el resguardo se reconozca de un vistazo. */
      logo_url TEXT,
      activa BOOLEAN NOT NULL DEFAULT true,
      por_defecto BOOLEAN NOT NULL DEFAULT false,
      orden INTEGER NOT NULL DEFAULT 0,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (empresa_id, iban)
    );
    CREATE INDEX IF NOT EXISTS cash_bank_accounts_empresa_idx
      ON cash_bank_accounts(empresa_id, activa, orden);
    ALTER TABLE cash_bank_accounts ADD COLUMN IF NOT EXISTS logo_url TEXT;
    /* El banco del maestro, del que sale el logotipo. Se resuelve solo por
       el código de entidad del IBAN. */
    ALTER TABLE cash_bank_accounts
      ADD COLUMN IF NOT EXISTS bank_id INTEGER REFERENCES cash_banks(id) ON DELETE SET NULL;
  `);

  /*
   * Enlaza con el maestro las cuentas que se dieron de alta ANTES de que
   * existiera.
   *
   * La columna se añadió vacía y solo se rellena al crear una cuenta nueva, así
   * que las que ya estaban se quedaban sin banco —y por tanto sin logotipo en
   * el resguardo— para siempre, sin que nada lo dijera.
   *
   * El enlace sale del propio IBAN: las cuatro cifras siguientes al `ES` y su
   * dígito de control son el código de entidad. Solo se tocan las que están a
   * NULL, así que esto no pisa nada puesto a mano y se puede repetir.
   */
  await pool.query(`
    UPDATE cash_bank_accounts c
       SET bank_id = b.id
      FROM cash_banks b
     WHERE c.bank_id IS NULL
       AND b.empresa_id = c.empresa_id
       AND c.iban LIKE 'ES%'
       AND length(c.iban) = 24
       AND b.codigo = substring(c.iban from 5 for 4)
  `);

  /*
   * Una sola cuenta por defecto por empresa. Índice único parcial y no una
   * comprobación en el código: con dos marcadas, «la de por defecto» dejaría
   * de significar nada y la elegida dependería del orden de la consulta.
   */
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS cash_bank_accounts_una_por_defecto_idx
      ON cash_bank_accounts(empresa_id) WHERE por_defecto;
  `);

  /*
   * La cuenta a la que fue cada ingreso. NULL en los ya hechos: no se puede
   * adivinar a qué banco fueron, y ponerles una a dedo sería inventarse un
   * dato contable. Se rellenan a mano desde la pantalla si hace falta.
   *
   * ON DELETE RESTRICT: una cuenta con ingresos detrás no se borra, se
   * desactiva.
   */
  await pool.query(`
    ALTER TABLE cash_bank_deposits
      ADD COLUMN IF NOT EXISTS bank_account_id INTEGER
        REFERENCES cash_bank_accounts(id) ON DELETE RESTRICT;
  `);

  /*
   * Reglas del escáner de facturas: qué TPV es de quién.
   *
   * Miran CAMPOS del resguardo, no su texto suelto, y eso no es un detalle. En
   * una factura real de este taller, cobrada por un TPV de BBVA, el resguardo
   * imprime «LBL : Visa CaixaBank», que es el producto de la tarjeta DEL
   * CLIENTE. Una regla de «si pone CaixaBank es CaixaBank» la clasificaría mal;
   * el número de comercio, en cambio, identifica el datáfono y no miente.
   *
   * `forma_pago` es un código del catálogo de la empresa y NO lleva clave
   * ajena: el catálogo es editable y una forma dada de baja no debe tumbar una
   * regla ni al revés. El clasificador comprueba al leer que el código siga
   * existiendo, y si no, se salta la regla y lo dice.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_payment_rules (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      campo TEXT NOT NULL
        CHECK (campo IN ('ADQUIRENTE','COMERCIO','TERMINAL','RED','CUENTA','PLANTILLA','TEXTO')),
      patron TEXT NOT NULL,
      forma_pago TEXT NOT NULL,
      /* 0..1. Es el techo de la propuesta: nunca sube por encima de esto. */
      confianza NUMERIC(3,2) NOT NULL DEFAULT 0.95
        CHECK (confianza >= 0 AND confianza <= 1),
      /* Si además puede quedar marcada sola en la pantalla de cobros. */
      auto_seleccionar BOOLEAN NOT NULL DEFAULT true,
      prioridad INTEGER NOT NULL DEFAULT 100,
      activa BOOLEAN NOT NULL DEFAULT true,
      notas TEXT,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      UNIQUE (empresa_id, campo, patron)
    );
    CREATE INDEX IF NOT EXISTS cash_payment_rules_empresa_idx
      ON cash_payment_rules(empresa_id, activa, prioridad);
  `);

  /*
   * El rastro de cada escaneo.
   *
   * Se guarda lo que dijo el modelo, lo que se entendió, lo que se propuso y
   * —cuando el cobro acaba registrándose— con qué se quedó la persona. Sirve
   * para tres cosas que solo se pueden hacer si el dato está: investigar un
   * cobro mal clasificado meses después, medir cuánto acierta el escáner y
   * saber qué campos corrige siempre el mostrador, que es por dónde hay que
   * mejorarlo.
   *
   * `operation_id` es NULL mientras el cobro no exista, y puede quedarse NULL
   * para siempre: escanear no obliga a cobrar. Es justamente la prueba de que
   * el escáner no confirma nada.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cash_invoice_scans (
      id SERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,
      session_id INTEGER REFERENCES cash_sessions(id) ON DELETE SET NULL,
      operation_id INTEGER REFERENCES cash_operations(id) ON DELETE SET NULL,

      /* Del fichero: nombre, tipo, tamaño y huella. El fichero en sí se cuelga
         del cobro por la vía de siempre, cuando el cobro existe. */
      nombre TEXT NOT NULL,
      mime TEXT NOT NULL,
      tamano_bytes BIGINT NOT NULL,
      sha256 TEXT NOT NULL,

      motor TEXT NOT NULL,
      duracion_ms INTEGER NOT NULL DEFAULT 0,
      /* Lo que dijo el modelo y lo que se entendió, uno al lado del otro. */
      extraccion_cruda JSONB,
      extraccion_normalizada JSONB,

      forma_pago_propuesta TEXT,
      forma_pago_confianza NUMERIC(3,2),
      forma_pago_motivo TEXT,
      regla_id INTEGER,
      auto_seleccionada BOOLEAN NOT NULL DEFAULT false,
      avisos JSONB,

      /* Se rellenan al confirmar el cobro, si se confirma. */
      campos_corregidos JSONB,
      forma_pago_final TEXT,
      confirmado_at_ms BIGINT,

      creado_por UUID,
      creado_at_ms BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cash_invoice_scans_empresa_idx
      ON cash_invoice_scans(empresa_id, creado_at_ms DESC);
    CREATE INDEX IF NOT EXISTS cash_invoice_scans_operacion_idx
      ON cash_invoice_scans(operation_id) WHERE operation_id IS NOT NULL;
  `);

  await asignarCodigosDeCaja();
  await renumerarDocumentos();

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
         (valor_centimos, tipo, etiqueta, piezas_por_cartucho, piezas_por_bolsa,
          activa, orden, created_at_ms, updated_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       ON CONFLICT (valor_centimos) DO NOTHING`,
      [d.valor, d.tipo, d.etiqueta, d.piezasPorCartucho, d.piezasPorBolsa, d.activa, d.orden, ahora]
    );
  }
}


/**
 * Pone código a las cajas que no lo tienen: `TAR1`, `TAR2`, `REU1`…
 *
 * Tres letras del centro —o del nombre, si la caja no tiene centro— y un
 * ordinal dentro de ese centro. Es una PROPUESTA de arranque: el código se
 * edita en Configuración y, una vez cambiado, esto no vuelve a tocarlo, porque
 * solo rellena las que están vacías.
 *
 * Las tildes se quitan a propósito (`Alcañiz` → `ALC`): el código acaba escrito
 * a mano en un resguardo del banco y en un extracto, y ahí no hay tildes.
 */
async function asignarCodigosDeCaja(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT id, empresa_id, centro, nombre FROM cash_registers
      WHERE codigo = '' ORDER BY empresa_id, centro, id`
  );
  if (rows.length === 0) return;

  // Los códigos ya en uso, por empresa, para no chocar con uno puesto a mano.
  const { rows: usados } = await pool.query(
    `SELECT empresa_id, codigo FROM cash_registers WHERE codigo <> ''`
  );
  const ocupados = new Map<string, Set<string>>();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const r of usados as any[]) {
    if (!ocupados.has(r.empresa_id)) ocupados.set(r.empresa_id, new Set());
    ocupados.get(r.empresa_id)!.add(r.codigo);
  }

  for (const c of rows as any[]) {
    if (!ocupados.has(c.empresa_id)) ocupados.set(c.empresa_id, new Set());
    const suyos = ocupados.get(c.empresa_id)!;
    const codigo = proponerCodigo(c.centro ?? "", c.nombre ?? "", suyos);
    suyos.add(codigo);
    await pool.query(`UPDATE cash_registers SET codigo = $2 WHERE id = $1`, [c.id, codigo]);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Pasa los números viejos (`MC-IB-2026-000001`) al formato nuevo
 * (`TAR1-IB-26-001`).
 *
 * El número viejo no decía de qué caja salía y era largo de leer y de dictar.
 * El nuevo lleva delante el código de la caja, que es por donde se ordena y por
 * donde se concilia.
 *
 * Se renumera TODO el histórico —decisión tomada a sabiendas de que un número
 * ya impreso deja de coincidir— para que el histórico quede homogéneo y no
 * haya que mirar dos formatos.
 *
 * El tipo y el año se leen del número VIEJO, no de las fechas: el contador
 * antiguo iba por tipo y año, así que respetarlos es lo único que garantiza
 * que el orden nuevo sea el mismo que el que ya se emitió. La secuencia se
 * reparte por (caja, tipo, año) siguiendo el número antiguo, así que dos
 * documentos nunca intercambian su posición relativa.
 *
 * Es idempotente: solo toca las filas que aún tienen el formato viejo, y en la
 * segunda pasada no hay ninguna.
 */
async function renumerarDocumentos(): Promise<void> {
  // Cada tabla con su forma de llegar a la caja. Las operaciones van por la
  // jornada; las demás ya guardan el register_id.
  const tablas: { tabla: string; caja: string }[] = [
    {
      tabla: "cash_operations",
      caja: `(SELECT r.codigo FROM cash_sessions s
                JOIN cash_registers r ON r.id = s.register_id
               WHERE s.id = t.session_id)`,
    },
    { tabla: "cash_bank_deposits", caja: `(SELECT r.codigo FROM cash_registers r WHERE r.id = t.register_id)` },
    { tabla: "cash_change_orders", caja: `(SELECT r.codigo FROM cash_registers r WHERE r.id = t.register_id)` },
    { tabla: "cash_advances", caja: `(SELECT r.codigo FROM cash_registers r WHERE r.id = t.register_id)` },
  ];

  let renumerados = 0;
  for (const { tabla, caja } of tablas) {
    const { rowCount } = await pool.query(`
      WITH viejos AS (
        SELECT t.id,
               ${caja}                                        AS codigo,
               (regexp_match(t.numero, '^MC-([A-Z]+)-([0-9]{4})-([0-9]+)$'))[1] AS tipo,
               (regexp_match(t.numero, '^MC-([A-Z]+)-([0-9]{4})-([0-9]+)$'))[2] AS anio,
               (regexp_match(t.numero, '^MC-([A-Z]+)-([0-9]{4})-([0-9]+)$'))[3]::bigint AS seq
          FROM ${tabla} t
         WHERE t.numero ~ '^MC-[A-Z]+-[0-9]{4}-[0-9]+$'
      ),
      ordenados AS (
        SELECT id, codigo, tipo, anio,
               row_number() OVER (PARTITION BY codigo, tipo, anio ORDER BY seq) AS nueva
          FROM viejos
         WHERE codigo IS NOT NULL AND codigo <> ''
      )
      UPDATE ${tabla} t
         SET numero = o.codigo || '-' || o.tipo || '-' || right(o.anio, 2)
                      || '-' || lpad(o.nueva::text, 3, '0')
        FROM ordenados o
       WHERE t.id = o.id
    `);
    renumerados += rowCount ?? 0;
  }

  if (renumerados === 0) return;

  /*
   * Y los contadores, a la altura de lo renumerado. Sin esto el primer
   * documento nuevo saldría con el 001 y chocaría con el que ya existe: la
   * clave única lo rechazaría y no se podría registrar nada.
   *
   * La clave pasa a ser CAJA:TIPO:AÑO, que es justo el cambio de fondo — antes
   * era TIPO:AÑO para toda la instalación.
   */
  await pool.query(`
    INSERT INTO cash_document_counters (clave, last_seq)
    SELECT clave, MAX(seq)
      FROM (
        SELECT split_part(numero, '-', 1) || ':' || split_part(numero, '-', 2)
                 || ':20' || split_part(numero, '-', 3)          AS clave,
               split_part(numero, '-', 4)::bigint                AS seq
          FROM cash_operations WHERE numero ~ '^[A-Z0-9]+-[A-Z]+-[0-9]{2}-[0-9]+$'
        UNION ALL
        SELECT split_part(numero, '-', 1) || ':' || split_part(numero, '-', 2)
                 || ':20' || split_part(numero, '-', 3),
               split_part(numero, '-', 4)::bigint
          FROM cash_bank_deposits WHERE numero ~ '^[A-Z0-9]+-[A-Z]+-[0-9]{2}-[0-9]+$'
        UNION ALL
        SELECT split_part(numero, '-', 1) || ':' || split_part(numero, '-', 2)
                 || ':20' || split_part(numero, '-', 3),
               split_part(numero, '-', 4)::bigint
          FROM cash_change_orders WHERE numero ~ '^[A-Z0-9]+-[A-Z]+-[0-9]{2}-[0-9]+$'
        UNION ALL
        SELECT split_part(numero, '-', 1) || ':' || split_part(numero, '-', 2)
                 || ':20' || split_part(numero, '-', 3),
               split_part(numero, '-', 4)::bigint
          FROM cash_advances WHERE numero ~ '^[A-Z0-9]+-[A-Z]+-[0-9]{2}-[0-9]+$'
      ) todo
     GROUP BY clave
    ON CONFLICT (clave) DO UPDATE
      SET last_seq = GREATEST(cash_document_counters.last_seq, EXCLUDED.last_seq)
  `);

  console.log(`Mobilink Cash: ${renumerados} documentos renumerados al formato CAJA-TIPO-AA-NNN`);
}
