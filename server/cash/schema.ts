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

export async function initCash(): Promise<void> {
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
        'CLOSING_FLOAT','CARTRIDGE_OPENED','BAG_OPENED')),
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
        'CLOSING_FLOAT','CARTRIDGE_OPENED','BAG_OPENED','EXCHANGE'));

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
