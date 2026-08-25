-- MC Central · Fase 5 — ciclo de ingresos bancarios y asignación de origen
--
-- Un ingreso no es un numero suelto: agrupa los cierres de varios dias de una
-- caja. `central_deposit_sources` guarda ese desglose -que jornada puso
-- cuanto- y es lo que permite contestar, cuando el banco apunta un abono de
-- 3.480 EUR, de que dias y de que caja salio. Sin el desglose, conciliar con el
-- extracto es adivinar.
--
-- Va en tabla aparte y no como JSON dentro del ingreso porque la pregunta que
-- de verdad se hace es la inversa: «esta jornada, en que ingreso acabo?».
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_bank_deposits (
  deposit_id                  integer primary key,
  empresa_id                  uuid not null,
  centro_id                   uuid,
  register_id                 integer,
  numero                      text,
  fecha                       date,
  referencia                  text,
  importe_centimos            bigint not null default 0,
  total_cierres_centimos      bigint not null default 0,
  remanente_anterior_centimos bigint not null default 0,
  remanente_nuevo_centimos    bigint not null default 0,
  estado                      text not null default 'CONFIRMADO',
  anulado_motivo              text,
  creado_en_ms                bigint,
  anulado_en_ms               bigint,
  actualizado_en_ms           bigint not null
);

create index if not exists central_deposits_empresa_idx
  on central_bank_deposits (empresa_id, fecha desc nulls last);
create index if not exists central_deposits_caja_idx
  on central_bank_deposits (register_id, estado);

create table if not exists central_deposit_sources (
  deposit_id       integer not null,
  session_id       integer not null,
  empresa_id       uuid not null,
  fecha            date,
  importe_centimos bigint not null default 0,
  primary key (deposit_id, session_id)
);

create index if not exists central_sources_session_idx
  on central_deposit_sources (session_id);
