-- MC Central · Fase 4 — posición global de efectivo sin doble conteo
--
-- La pieza que falta para que la suma cuadre: el dinero que SALIÓ del cajón y
-- todavía no ha vuelto. El módulo de caja asienta cuando el dinero se mueve
-- físicamente, no cuando se planea, así que lo que se fue al banco a cambiar o
-- lo que lleva un empleado ya no está en el cajón.
--
-- Sin esta tabla la red parecería tener menos efectivo del que tiene cada vez
-- que alguien va al banco. Y la tentación contraria -sumarlo al cajón- sería
-- contarlo dos veces.
--
-- Equivalente en código: server/central/schema.ts.

create table if not exists central_transits (
  clase              text not null,          -- CHANGE_ORDER | ADVANCE
  documento_id       bigint not null,
  empresa_id         uuid not null,
  centro_id          uuid,
  register_id        integer,
  session_id         integer,
  numero             text,
  importe_centimos   bigint not null default 0,
  -- Quién lo tiene. La pregunta que hay que poder contestar no es solo cuánto
  -- falta, sino con quién está.
  responsable        text,
  estado             text not null default 'ABIERTO',
  abierto_en_ms      bigint,
  cerrado_en_ms      bigint,
  liquidado_centimos bigint,
  actualizado_en_ms  bigint not null,
  primary key (clase, documento_id)
);

create index if not exists central_transits_abiertos_idx
  on central_transits (empresa_id, estado);

-- Marca de conciliación. El importe que un cierre aparta «para el banco» sale
-- del cajón y espera en la tienda hasta que un ingreso lo recoge: mientras no
-- se concilie, ese dinero existe y hay que contarlo. Sin esta marca, la
-- posición global seguiría contando billetes que ya están en el banco.
alter table central_sessions
  add column if not exists conciliada boolean not null default false;
