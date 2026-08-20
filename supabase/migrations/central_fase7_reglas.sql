-- MC Central · Fase 7 — motor de reglas jerarquico, alertas e incidencias
--
-- Las reglas son POCAS y de tipos cerrados a proposito: cada tipo mira una cosa
-- medible que Central ya conoce. Una regla generica con una expresion que hay
-- que interpretar es una regla que nadie sabe si esta bien escrita hasta el dia
-- que no avisa.
--
-- `ambito` + `ambito_id` es la jerarquia: EMPRESA, ZONA, CENTRO o CAJA, y gana
-- la mas especifica. La resolucion vive en server/central/rules/engine.ts, que
-- no toca la base de datos y se prueba en un milisegundo.
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_rules (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null,
  tipo              text not null,
  ambito            text not null,
  ambito_id         text,
  umbral            bigint not null,
  activa            boolean not null default true,
  creado_por        uuid,
  creado_en_ms      bigint not null,
  actualizado_en_ms bigint not null
);

create index if not exists central_rules_empresa_idx on central_rules (empresa_id, tipo);

-- Una sola regla por tipo y ambito concreto. Dos reglas del mismo alcance
-- obligarian a desempatar, y un aviso que aparece segun por donde se mire es
-- peor que no tener aviso.
create unique index if not exists central_rules_unica_idx
  on central_rules (empresa_id, tipo, ambito, coalesce(ambito_id, ''));

create table if not exists central_incidents (
  id                bigserial primary key,
  empresa_id        uuid not null,
  centro_id         uuid,
  register_id       integer,
  session_id        integer,
  tipo              text not null,
  regla_id          uuid,
  -- Identifica EL HECHO, no la regla: dos descuadres de dias distintos son dos
  -- incidencias; un transito que sigue fuera es la misma de ayer.
  clave             text not null,
  umbral            bigint not null default 0,
  valor             bigint not null default 0,
  estado            text not null default 'ABIERTA'
                    check (estado in ('ABIERTA','RECONOCIDA','RESUELTA')),
  detalle           jsonb not null default '{}'::jsonb,
  nota              text,
  abierta_en_ms     bigint not null,
  actualizada_en_ms bigint not null,
  cerrada_en_ms     bigint,
  cerrada_por       uuid,
  -- AUTO cuando la condicion dejo de darse; MANUAL cuando la cierra alguien.
  cerrada_motivo    text
);

-- Una incidencia VIVA por hecho. Es lo que impide que cada evaluacion vuelva a
-- abrir el mismo aviso: la barrera es el indice, no el codigo.
create unique index if not exists central_incidents_viva_idx
  on central_incidents (empresa_id, clave)
  where estado in ('ABIERTA','RECONOCIDA');

create index if not exists central_incidents_bandeja_idx
  on central_incidents (empresa_id, estado, abierta_en_ms desc);
