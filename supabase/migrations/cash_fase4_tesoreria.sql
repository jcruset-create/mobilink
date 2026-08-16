-- ============================================================
-- Mobilink Cash — Fase 4: tesorería
--
--   Dos documentos para el mismo problema: dinero que sale hoy de la caja y
--   vuelve más tarde, entero o en parte.
--
--   · cash_change_orders — se va al banco con billetes y se vuelve con
--     calderilla. Entre una cosa y otra pasan horas o días.
--   · cash_advances — se le dan 50 € a un empleado para que compre algo.
--
--   Los dos CRUZAN JORNADAS a propósito: el banco no contesta el mismo día y
--   el empleado vuelve en el turno siguiente. Cada asiento pertenece a la
--   jornada en la que ocurrió, así que los dos arqueos cuadran por separado.
--   Ese era el encargo: que un billete de 50 € no desaparezca en un cambio de
--   turno sin que nadie sepa quién lo tiene.
--
-- NOTA: esta migración también se aplica sola al arrancar el servidor
-- (server/cash/schema.ts). Se conserva aquí para pegar en el SQL Editor de
-- Supabase y para entornos sin ese arranque. Idempotente.
-- ============================================================

create table if not exists cash_change_orders (
  id                          serial primary key,
  empresa_id                  uuid not null,
  register_id                 integer not null references cash_registers(id) on delete restrict,
  numero                      text not null,
  estado                      text not null default 'PENDIENTE'
                                check (estado in ('PENDIENTE','RECIBIDO','CANCELADO')),

  importe_centimos            bigint not null,
  -- Lo que el banco ha dado de verdad. Puede no coincidir con lo pedido.
  importe_recibido_centimos   bigint,
  diferencia_motivo           text,

  session_id_salida           integer not null references cash_sessions(id) on delete restrict,
  session_id_entrada          integer references cash_sessions(id) on delete restrict,
  operation_salida_id         integer references cash_operations(id) on delete restrict,
  operation_entrada_id        integer references cash_operations(id) on delete restrict,

  notas                       text,
  creado_por                  uuid,
  creado_at_ms                bigint not null,
  cerrado_por                 uuid,
  cerrado_at_ms               bigint,
  unique (empresa_id, numero)
);

create index if not exists cash_change_orders_abiertos_idx
  on cash_change_orders (register_id, estado);

create table if not exists cash_change_order_lines (
  id               serial primary key,
  change_order_id  integer not null references cash_change_orders(id) on delete cascade,
  -- SOLICITADO: lo que se le pide al banco. ENVIADO: los billetes que salen de
  -- la caja. RECIBIDO: lo que el banco acaba dando.
  rol              text not null check (rol in ('SOLICITADO','ENVIADO','RECIBIDO')),
  valor_centimos   integer not null,
  cantidad         integer not null check (cantidad > 0),
  cartuchos        integer not null default 0,
  motivo           text
);

create index if not exists cash_change_order_lines_idx
  on cash_change_order_lines (change_order_id, rol);

create table if not exists cash_advances (
  id                      serial primary key,
  empresa_id              uuid not null,
  register_id             integer not null references cash_registers(id) on delete restrict,
  numero                  text not null,
  estado                  text not null default 'ABIERTA'
                            check (estado in ('ABIERTA','LIQUIDADA','DEVUELTA','CANCELADA')),

  persona                 text not null,
  motivo                  text not null,
  importe_centimos        bigint not null,

  -- Al liquidar: lo que dice la factura y lo que ha vuelto en piezas.
  gasto_centimos          bigint,
  devuelto_centimos       bigint,
  -- Entregado − devuelto − gastado. Distinto de cero = falta dinero.
  diferencia_centimos     bigint,
  diferencia_motivo       text,
  factura_referencia      text,
  proveedor               text,

  session_id_entrega      integer not null references cash_sessions(id) on delete restrict,
  session_id_liquidacion  integer references cash_sessions(id) on delete restrict,
  operation_entrega_id    integer references cash_operations(id) on delete restrict,
  operation_devolucion_id integer references cash_operations(id) on delete restrict,
  operation_pago_id       integer references cash_operations(id) on delete restrict,

  notas                   text,
  creado_por              uuid,
  creado_at_ms            bigint not null,
  cerrado_por             uuid,
  cerrado_at_ms           bigint,
  unique (empresa_id, numero)
);

create index if not exists cash_advances_abiertas_idx
  on cash_advances (register_id, estado);
