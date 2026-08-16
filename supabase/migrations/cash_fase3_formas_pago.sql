-- ============================================================
-- Mobilink Cash — Fase 3: catálogo de formas de pago
--
--   Las formas de pago dejan de estar escritas en el código y pasan a ser
--   configurables por empresa: alta, baja, nombre, imagen del botón y si
--   exigen referencia.
--
--   `codigo` es lo que ya guarda cash_operation_payments.forma_pago, así que
--   un cobro de hace un año conserva su etiqueta aunque hoy la forma esté de
--   baja. Por eso la baja es lógica (activa = false) y nunca un DELETE.
--
-- NOTA: esta migración también se aplica sola al arrancar el servidor
-- (server/cash/schema.ts). Se conserva aquí para pegar en el SQL Editor de
-- Supabase y para entornos sin ese arranque. Idempotente.
--
-- La SIEMBRA no va aquí: las formas son por empresa y se siembran solas la
-- primera vez que una empresa abre el catálogo (server/cash/config.ts,
-- asegurarFormasPago). Sembrar aquí obligaría a recorrer app_empresas y a
-- decidir por empresas que quizá ni usan el módulo.
-- ============================================================

create table if not exists cash_payment_methods (
  id              serial primary key,
  empresa_id      uuid not null,
  codigo          text not null,
  nombre          text not null,
  imagen_url      text,
  afecta_efectivo boolean not null default false,
  pide_referencia boolean not null default false,
  activa          boolean not null default true,
  orden           integer not null default 0,
  created_at_ms   bigint not null,
  updated_at_ms   bigint not null,
  unique (empresa_id, codigo)
);

create index if not exists cash_pay_methods_empresa_idx
  on cash_payment_methods (empresa_id, activa, orden);

-- Como mucho una forma de efectivo por empresa: con dos, el desglose por
-- denominación de cada operación dejaría de ser interpretable.
create unique index if not exists cash_pay_methods_un_efectivo_idx
  on cash_payment_methods (empresa_id) where afecta_efectivo;
