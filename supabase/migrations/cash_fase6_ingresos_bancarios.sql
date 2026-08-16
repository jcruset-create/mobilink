-- ============================================================
-- Mobilink Cash — Fase 6: gestión de ingresos bancarios
--
--   El cierre de cada jornada aparta un importe "para el banco", pero al banco
--   no se va cada día: se acumulan varios cierres y luego un solo ingreso los
--   agrupa. El banco solo admite billetes, así que las monedas que no se
--   consiguen convertir se quedan en tienda como REMANENTE, que arrastra al
--   ingreso siguiente.
--
--   La ecuación contable va como CHECK de la tabla, no como validación de
--   código: ninguna fila puede descuadrar, la escriba quien la escriba.
--
--       remanente_anterior + total_cierres − importe = remanente_nuevo
--
--   El remanente actual de una caja NO es una columna: es el remanente_nuevo
--   de su último ingreso confirmado. Derivado, como el stock teórico, para que
--   no exista un contador que pueda desincronizarse.
--
-- NOTA: esta migración también se aplica sola al arrancar el servidor
-- (server/cash/schema.ts). Se conserva aquí para pegar en el SQL Editor de
-- Supabase y para entornos sin ese arranque. Idempotente.
-- ============================================================

create table if not exists cash_bank_deposits (
  id                           serial primary key,
  empresa_id                   uuid not null,
  register_id                  integer not null references cash_registers(id) on delete restrict,
  numero                       text not null,
  estado                       text not null default 'CONFIRMADO'
                                 check (estado in ('CONFIRMADO','ANULADO')),

  fecha_ingreso                date,
  referencia                   text,
  observaciones                text,

  remanente_anterior_centimos  bigint not null check (remanente_anterior_centimos >= 0),
  total_cierres_centimos       bigint not null check (total_cierres_centimos >= 0),
  importe_centimos             bigint not null check (importe_centimos > 0),
  remanente_nuevo_centimos     bigint not null check (remanente_nuevo_centimos >= 0),
  constraint cash_bank_deposits_ecuacion check (
    remanente_anterior_centimos + total_cierres_centimos - importe_centimos
      = remanente_nuevo_centimos
  ),

  creado_por                   uuid,
  creado_at_ms                 bigint not null,
  anulado_por                  uuid,
  anulado_at_ms                bigint,
  anulado_motivo               text,
  unique (empresa_id, numero)
);

create index if not exists cash_bank_deposits_caja_idx
  on cash_bank_deposits (register_id, estado, id desc);

-- Qué cierres componen cada ingreso. `vigente` baja a false al anular el
-- ingreso, y el índice único parcial impide A NIVEL DE BASE DE DATOS que el
-- mismo cierre entre en dos ingresos a la vez.
create table if not exists cash_bank_deposit_sessions (
  id               serial primary key,
  deposit_id       integer not null references cash_bank_deposits(id) on delete restrict,
  session_id       integer not null references cash_sessions(id) on delete restrict,
  importe_centimos bigint not null check (importe_centimos >= 0),
  vigente          boolean not null default true
);

create unique index if not exists cash_bank_dep_ses_unico_idx
  on cash_bank_deposit_sessions (session_id) where vigente;

create index if not exists cash_bank_dep_ses_deposito_idx
  on cash_bank_deposit_sessions (deposit_id);
