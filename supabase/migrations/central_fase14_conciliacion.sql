-- MC Central · Fase 14 — conciliacion bancaria asistida
--
-- Los apuntes se guardan tal cual vienen del banco, sin interpretar: es el
-- documento original y lo que permite volver a mirarlo cuando alguien pregunta
-- por que se caso una cosa con otra.
--
-- La conciliacion es una columna en el apunte y no una tabla aparte: un apunte
-- se concilia con un ingreso, uno a uno. Si algun dia hiciera falta casar un
-- apunte con varios ingresos seria otra historia, pero inventar hoy esa tabla
-- es complicar sin caso.
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_bank_statements (
  id                     uuid primary key default gen_random_uuid(),
  empresa_id             uuid not null,
  nombre_fichero         text,
  cuenta                 text,
  desde                  date,
  hasta                  date,
  saldo_inicial_centimos bigint,
  saldo_final_centimos   bigint,
  -- El saldo declarado por el banco cuadra con sus propios movimientos. Un
  -- extracto que no cuadra NO se guarda: conciliar contra medio extracto da
  -- por descuadrado lo que en realidad estaba bien.
  cuadra                 boolean not null default false,
  importado_por          uuid,
  importado_en_ms        bigint not null
);

create index if not exists central_statements_empresa_idx
  on central_bank_statements (empresa_id, hasta desc nulls last);

create table if not exists central_statement_lines (
  id                uuid primary key default gen_random_uuid(),
  statement_id      uuid not null,
  empresa_id        uuid not null,
  fecha             date,
  fecha_valor       date,
  importe_centimos  bigint not null,
  concepto          text,
  ampliado          text,
  referencia        text,
  deposit_id        integer,
  conciliado_por    uuid,
  conciliado_en_ms  bigint,
  -- Comisiones, recibos, nominas: se marcan como ajenos a la caja o la lista de
  -- pendientes se llena de apuntes que nunca van a casar con nada.
  descartado        boolean not null default false,
  descartado_motivo text
);

create index if not exists central_lines_extracto_idx
  on central_statement_lines (statement_id, fecha);
create index if not exists central_lines_pendientes_idx
  on central_statement_lines (empresa_id)
  where deposit_id is null and not descartado;

-- Un ingreso no puede quedar conciliado con dos apuntes del banco: seria
-- contarlo dos veces en el extracto.
create unique index if not exists central_lines_deposito_idx
  on central_statement_lines (deposit_id) where deposit_id is not null;
