-- ============================================================
-- Mobilink Cash — Fase 1
--
-- Gestión de la caja física: jornadas, cobros, pagos, denominaciones,
-- cambio, arqueos, cierres e ingresos bancarios. La integración con una
-- ERP externa es OPCIONAL: sin ninguna ERP configurada el módulo funciona
-- entero (abrir caja, cobrar y pagar a mano, arquear, cerrar).
--
-- Prefijo cash_ para no colisionar con otros módulos.
--
-- NOTA: esta migración también se aplica sola al arrancar el servidor
-- (server/cash/schema.ts), así que normalmente no hace falta ejecutarla a
-- mano. Se conserva aquí como referencia y para entornos sin ese arranque.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
--
-- CONVENCIÓN IMPORTANTE: todos los importes van en CÉNTIMOS ENTEROS
-- (BIGINT). Nunca NUMERIC ni DOUBLE. Es la misma representación que usa el
-- motor de dominio, así que no hay ninguna conversión por el camino que
-- pueda colar un decimal en coma flotante.
-- ============================================================

-- ── Catálogo de denominaciones y cartuchos ───────────────────
create table if not exists cash_denominations (
  id                   serial primary key,
  valor_centimos       integer not null unique,
  tipo                 text not null check (tipo in ('BILLETE','MONEDA')),
  etiqueta             text not null,
  piezas_por_cartucho  integer,
  activa               boolean not null default true,
  orden                integer not null default 0,
  created_at_ms        bigint not null,
  updated_at_ms        bigint not null
);
create index if not exists cash_den_activa_idx on cash_denominations (activa, orden);

insert into cash_denominations (valor_centimos, tipo, etiqueta, piezas_por_cartucho, activa, orden, created_at_ms, updated_at_ms)
values
  (50000,'BILLETE','500 €',  null, true,  1, 0, 0),
  (20000,'BILLETE','200 €',  null, true,  2, 0, 0),
  (10000,'BILLETE','100 €',  null, true,  3, 0, 0),
  ( 5000,'BILLETE','50 €',   null, true,  4, 0, 0),
  ( 2000,'BILLETE','20 €',   null, true,  5, 0, 0),
  ( 1000,'BILLETE','10 €',   null, true,  6, 0, 0),
  (  500,'BILLETE','5 €',    null, true,  7, 0, 0),
  (  200,'MONEDA', '2 €',      25, true,  8, 0, 0),
  (  100,'MONEDA', '1 €',      25, true,  9, 0, 0),
  (   50,'MONEDA', '0,50 €',   25, true, 10, 0, 0),
  (   20,'MONEDA', '0,20 €',   25, true, 11, 0, 0),
  (   10,'MONEDA', '0,10 €',   50, true, 12, 0, 0),
  (    5,'MONEDA', '0,05 €',   50, true, 13, 0, 0),
  (    2,'MONEDA', '0,02 €',   50, true, 14, 0, 0),
  (    1,'MONEDA', '0,01 €',   50, true, 15, 0, 0)
on conflict (valor_centimos) do nothing;

-- ── Cajas físicas ────────────────────────────────────────────
create table if not exists cash_registers (
  id             serial primary key,
  empresa_id     uuid not null,
  centro         text not null default '',
  nombre         text not null,
  activa         boolean not null default true,
  created_at_ms  bigint not null,
  updated_at_ms  bigint not null,
  unique (empresa_id, centro, nombre)
);
create index if not exists cash_registers_empresa_idx on cash_registers (empresa_id, activa);

-- ── Jornadas de caja ─────────────────────────────────────────
create table if not exists cash_sessions (
  id                        serial primary key,
  empresa_id                uuid not null,
  register_id               integer not null references cash_registers(id) on delete restrict,
  fecha                     date not null,
  estado                    text not null default 'OPEN'
                            check (estado in ('DRAFT','OPEN','PENDING_CLOSE','CLOSED','REOPENED','CANCELLED')),
  abierta_por               uuid,
  abierta_at_ms             bigint,
  cerrada_por               uuid,
  cerrada_at_ms             bigint,
  fondo_inicial_centimos    bigint not null default 0,
  fondo_inicial_heredado    boolean not null default false,
  sesion_anterior_id        integer references cash_sessions(id) on delete set null,
  contado_centimos          bigint,
  diferencia_centimos       bigint,
  denominaciones_cuadran    boolean,
  cambio_final_centimos     bigint,
  ingreso_bancario_centimos bigint,
  notas                     text,
  created_at_ms             bigint not null,
  updated_at_ms             bigint not null
);
create index if not exists cash_sessions_register_idx on cash_sessions (register_id, fecha desc);
create index if not exists cash_sessions_empresa_idx on cash_sessions (empresa_id, fecha desc);

-- Una caja NO puede tener dos jornadas abiertas a la vez. Lo impide la base
-- de datos y no el código: dos peticiones simultáneas pasan las dos por el
-- "if" antes de que ninguna haya insertado.
create unique index if not exists cash_sessions_una_abierta_idx
  on cash_sessions (register_id)
  where estado in ('OPEN','PENDING_CLOSE','REOPENED');

-- ── Documentos externos (caché local de la ERP) ──────────────
-- La ERP sigue siendo la fuente autoritativa; esto es la copia con la que se
-- opera para no depender de que conteste en cada pantalla.
create table if not exists cash_external_documents (
  id                  serial primary key,
  empresa_id          uuid not null,
  external_system     text not null,
  external_id         text not null,
  external_reference  text,
  tipo                text not null
                      check (tipo in ('CUSTOMER_INVOICE','SUPPLIER_INVOICE','RECEIPT','CREDIT_NOTE','PAYMENT_ORDER','OTHER')),
  party_tipo          text not null default 'CUSTOMER' check (party_tipo in ('CUSTOMER','SUPPLIER','OTHER')),
  party_external_id   text,
  party_nombre        text not null default '',
  numero              text not null default '',
  fecha               date,
  vencimiento         date,
  total_centimos      bigint not null default 0,
  pendiente_centimos  bigint not null default 0,
  moneda              text not null default 'EUR',
  estado              text not null default 'OPEN'
                      check (estado in ('OPEN','PARTIALLY_PAID','PAID','CANCELLED')),
  estado_erp          text,
  metadata            jsonb,
  last_sync_at_ms     bigint,
  created_at_ms       bigint not null,
  updated_at_ms       bigint not null,
  -- La pareja (sistema, id) es lo que evita duplicados: un número de factura
  -- NO es único entre ERPs distintas.
  unique (empresa_id, external_system, external_id)
);
create index if not exists cash_extdoc_busqueda_idx on cash_external_documents (empresa_id, tipo, estado);
create index if not exists cash_extdoc_numero_idx   on cash_external_documents (empresa_id, numero);
create index if not exists cash_extdoc_party_idx    on cash_external_documents (empresa_id, party_nombre);

-- ── Operaciones de caja ──────────────────────────────────────
create table if not exists cash_operations (
  id                           serial primary key,
  empresa_id                   uuid not null,
  session_id                   integer not null references cash_sessions(id) on delete restrict,
  numero                       text not null unique,
  tipo                         text not null check (tipo in (
                                 'COLLECTION','PAYMENT','MANUAL_IN','MANUAL_OUT','CASH_DELIVERY',
                                 'BANK_DEPOSIT','ADJUSTMENT','OPENING_FLOAT','CLOSING_FLOAT')),
  origen                       text not null default 'MANUAL'
                               check (origen in ('MANUAL','ERP','API','IMPORT','POS','OTHER')),
  external_system              text,
  external_document_id         text,
  external_document_reference  text,
  documento_id                 integer references cash_external_documents(id) on delete set null,
  party_nombre                 text not null default '',
  concepto                     text not null default '',
  referencia                   text,
  importe_centimos             bigint not null,
  efectivo_neto_centimos       bigint not null default 0,
  estado                       text not null default 'CONFIRMED'
                               check (estado in ('DRAFT','CONFIRMED','REVERSED','CANCELLED')),
  reversa_de_id                integer references cash_operations(id) on delete restrict,
  motivo_reversa               text,
  erp_sync_status              text not null default 'NOT_APPLICABLE'
                               check (erp_sync_status in ('NOT_APPLICABLE','PENDING','SYNCING','SYNCED','ERROR','RETRY_PENDING','CANCELLED')),
  erp_sync_at_ms               bigint,
  erp_error                    text,
  created_by                   uuid,
  created_at_ms                bigint not null,
  confirmed_at_ms              bigint,
  updated_at_ms                bigint not null
);
create index if not exists cash_ops_session_idx on cash_operations (session_id, created_at_ms desc);
create index if not exists cash_ops_tipo_idx    on cash_operations (empresa_id, tipo, created_at_ms desc);
create index if not exists cash_ops_origen_idx  on cash_operations (empresa_id, origen);
create index if not exists cash_ops_sync_idx    on cash_operations (erp_sync_status)
  where erp_sync_status in ('PENDING','ERROR','RETRY_PENDING');
create index if not exists cash_ops_extdoc_idx  on cash_operations (empresa_id, external_system, external_document_id)
  where external_document_id is not null;

-- ── Formas de pago de cada operación (soporta mixtos) ────────
create table if not exists cash_operation_payments (
  id                serial primary key,
  operation_id      integer not null references cash_operations(id) on delete restrict,
  forma_pago        text not null,
  importe_centimos  bigint not null,
  referencia        text,
  created_at_ms     bigint not null
);
create index if not exists cash_oppay_op_idx on cash_operation_payments (operation_id);

-- ── Libro mayor de piezas ────────────────────────────────────
-- INMUTABLE: solo INSERT. El stock teórico es la suma de esta tabla, así que
-- no hay ninguna columna de saldo acumulado que se pueda desincronizar. Una
-- corrección no borra: asienta el movimiento inverso.
create table if not exists cash_denomination_movements (
  id                        bigserial primary key,
  session_id                integer not null references cash_sessions(id) on delete restrict,
  operation_id              integer references cash_operations(id) on delete restrict,
  denomination_id           integer not null references cash_denominations(id) on delete restrict,
  direccion                 text not null check (direccion in ('IN','OUT')),
  cantidad                  integer not null check (cantidad > 0),
  -- Se guarda el valor unitario además del id: si mañana alguien corrige una
  -- etiqueta o desactiva una denominación, un movimiento de hace un año tiene
  -- que seguir valiendo lo que valía.
  valor_unitario_centimos   integer not null,
  importe_centimos          bigint not null,
  motivo                    text not null check (motivo in (
                              'OPENING_FLOAT','CUSTOMER_PAYMENT','CHANGE_GIVEN','SUPPLIER_PAYMENT',
                              'MANUAL_IN','MANUAL_OUT','CASH_DELIVERY','BANK_DEPOSIT','ADJUSTMENT','CLOSING_FLOAT')),
  created_by                uuid,
  created_at_ms             bigint not null
);
create index if not exists cash_denmov_session_idx on cash_denomination_movements (session_id);
create index if not exists cash_denmov_op_idx      on cash_denomination_movements (operation_id);
create index if not exists cash_denmov_stock_idx   on cash_denomination_movements (session_id, denomination_id, direccion);

-- ── Arqueos ──────────────────────────────────────────────────
create table if not exists cash_counts (
  id                      serial primary key,
  session_id              integer not null references cash_sessions(id) on delete restrict,
  tipo                    text not null default 'CLOSING' check (tipo in ('INTERMEDIATE','CLOSING')),
  teorico_centimos        bigint not null,
  contado_centimos        bigint not null,
  diferencia_centimos     bigint not null,
  denominaciones_cuadran  boolean not null,
  piezas_teoricas         integer not null default 0,
  piezas_contadas         integer not null default 0,
  notas                   text,
  created_by              uuid,
  created_at_ms           bigint not null
);
create index if not exists cash_counts_session_idx on cash_counts (session_id, created_at_ms desc);

create table if not exists cash_count_lines (
  id                       bigserial primary key,
  count_id                 integer not null references cash_counts(id) on delete cascade,
  denomination_id          integer not null references cash_denominations(id) on delete restrict,
  valor_unitario_centimos  integer not null,
  cantidad_teorica         integer not null default 0,
  cantidad_contada         integer not null default 0,
  cartuchos_contados       integer not null default 0,
  diferencia               integer not null default 0,
  unique (count_id, denomination_id)
);
create index if not exists cash_countlines_count_idx on cash_count_lines (count_id);

-- ── Integración ERP: configuración ───────────────────────────
-- SIN FILA = ERP NO CONFIGURADA, y el módulo funciona igual. La configuración
-- se asocia a empresa y opcionalmente a centro, para que un centro pueda tener
-- ERP y otro trabajar a mano.
--
-- `ajustes` guarda SOLO lo no secreto (URL base, banderas). Las credenciales
-- viven en variables de entorno dentro del conector: no entran en esta tabla
-- ni salen jamás hacia el navegador.
create table if not exists cash_erp_configs (
  id                     serial primary key,
  empresa_id             uuid not null,
  -- '' = configuración para toda la empresa. NO se usa null: en Postgres dos
  -- null son distintos para un unique, así que (empresa, null) no deduplica y
  -- cada guardado insertaría una fila nueva en vez de actualizar la existente.
  centro                 text not null default '',
  connector_key          text not null,
  activo                 boolean not null default false,
  ajustes                jsonb not null default '{}'::jsonb,
  permite_cobro_parcial  boolean not null default true,
  last_sync_at_ms        bigint,
  last_status            text,
  last_error             text,
  created_at_ms          bigint not null,
  updated_at_ms          bigint not null,
  unique (empresa_id, centro)
);

-- ── Outbox transaccional ─────────────────────────────────────
-- El evento se escribe en la MISMA transacción que la operación y sus
-- movimientos; el worker lo envía después. Es lo que impide el fallo grave de
-- estas integraciones: el operador cobra, el dinero entra físicamente en el
-- cajón, la ERP contesta 503 y el cobro se pierde. Aquí el cobro está guardado
-- pase lo que pase y solo queda pendiente avisar a la ERP.
create table if not exists cash_erp_outbox (
  id                  bigserial primary key,
  empresa_id          uuid not null,
  operation_id        integer references cash_operations(id) on delete restrict,
  connector_key       text,
  evento              text not null,
  -- Clave de idempotencia: el número de operación de Mobilink Cash. Un
  -- reintento con la misma clave no puede contabilizar el cobro dos veces.
  idempotency_key     text not null unique,
  payload             jsonb not null,
  estado              text not null default 'PENDING'
                      check (estado in ('PENDING','SYNCING','SYNCED','ERROR','RETRY_PENDING','CANCELLED')),
  intentos            integer not null default 0,
  proximo_intento_ms  bigint,
  last_error          text,
  response_payload    jsonb,
  created_at_ms       bigint not null,
  processed_at_ms     bigint
);
create index if not exists cash_outbox_pendientes_idx on cash_erp_outbox (estado, proximo_intento_ms)
  where estado in ('PENDING','RETRY_PENDING');
create index if not exists cash_outbox_op_idx on cash_erp_outbox (operation_id);

-- ── Log técnico de integración (sin secretos) ────────────────
create table if not exists cash_erp_logs (
  id               bigserial primary key,
  empresa_id       uuid not null,
  direccion        text not null check (direccion in ('IN','OUT')),
  evento           text not null,
  external_system  text,
  external_id      text,
  mobilink_id      text,
  estado           text not null,
  intentos         integer not null default 0,
  last_error       text,
  created_at_ms    bigint not null,
  processed_at_ms  bigint
);
create index if not exists cash_erplogs_empresa_idx on cash_erp_logs (empresa_id, created_at_ms desc);

-- ── Numeración propia (MC-C-2026-000001) ─────────────────────
-- No depende de ningún número que dé la ERP: en modo autónomo no hay ERP.
create table if not exists cash_document_counters (
  clave     text primary key,
  last_seq  integer not null default 0
);

-- ── Alta del módulo 'cash' como licenciable ──────────────────
do $migracion$
begin
  if to_regclass('public.app_licencias') is not null then
    alter table app_licencias drop constraint if exists app_licencias_modulo_check;
    alter table app_licencias add constraint app_licencias_modulo_check
      check (modulo in ('administracion','tyrecontrol','almacen','sea-core','toolcontrol','safety','presencia','taller','workplanner','cash'));

    insert into app_licencias (empresa_id, modulo)
    select '00000000-0000-4000-a000-000000000001', 'cash'
    where not exists (
      select 1 from app_licencias
      where empresa_id = '00000000-0000-4000-a000-000000000001' and modulo = 'cash'
    );
  end if;

  if to_regclass('public.app_usuario_modulos') is not null then
    alter table app_usuario_modulos drop constraint if exists app_usuario_modulos_modulo_check;
    alter table app_usuario_modulos add constraint app_usuario_modulos_modulo_check
      check (modulo in ('administracion','tyrecontrol','almacen','sea-core','toolcontrol','safety','presencia','taller','workplanner','cash'));
  end if;
end
$migracion$;
