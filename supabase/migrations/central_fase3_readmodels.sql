-- MC Central · Fase 3 — proyecciones de supervisión
--
-- Central NO escribe nunca en las tablas cash_*. Estas tablas son proyecciones:
-- si se borraran enteras, se reconstruyen volviendo a pasar central_events. Esa
-- propiedad es lo que las hace seguras — un error de agregación aquí no puede
-- corromper la caja, que sigue siendo la fuente de verdad de lo suyo.
--
-- Equivalente en código: server/central/schema.ts.

-- Lo que ha llegado, y a la vez la BARRERA DE DEDUPLICACIÓN: event_id es clave
-- primaria, así que reenviar el mismo evento no puede aplicarlo dos veces. La
-- defensa contra el doble conteo no es una comprobación de código: es la clave.
create table if not exists central_events (
  event_id          uuid primary key,
  empresa_id        uuid not null,
  centro_id         uuid,
  register_id       integer,
  session_id        integer,
  aggregate_type    text,
  aggregate_id      bigint,
  aggregate_version bigint,
  tipo              text not null,
  ocurrido_en_ms    bigint not null,
  actor_user_id     uuid,
  datos             jsonb not null default '{}'::jsonb,
  recibido_en_ms    bigint not null,
  -- APLICADO: cambió la proyección. TARDIO: llegó detrás de uno más nuevo del
  -- mismo agregado. Distinguirlos es lo que separa «no ha llegado» de «llegó y
  -- se descartó».
  resultado         text not null default 'APLICADO'
);

create index if not exists central_events_empresa_idx
  on central_events (empresa_id, ocurrido_en_ms desc);
create index if not exists central_events_agregado_idx
  on central_events (aggregate_type, aggregate_id, aggregate_version);

-- La jornada vista desde la red. `ultima_version` es la del último evento de
-- ESTADO aplicado: uno con versión menor llega tarde y no lo pisa. Sin esto, un
-- evento retrasado por un reintento reabriría en pantalla una jornada cerrada.
create table if not exists central_sessions (
  session_id                integer primary key,
  empresa_id                uuid not null,
  centro_id                 uuid,
  register_id               integer not null,
  fecha                     date,
  estado                    text,
  fondo_inicial_centimos    bigint not null default 0,
  contado_centimos          bigint,
  diferencia_centimos       bigint,
  ingreso_bancario_centimos bigint,
  cambio_final_centimos     bigint,
  operaciones               integer not null default 0,
  efectivo_neto_centimos    bigint not null default 0,
  cobros_centimos           bigint not null default 0,
  pagos_centimos            bigint not null default 0,
  anulaciones               integer not null default 0,
  reaperturas               integer not null default 0,
  abierta_en_ms             bigint,
  cerrada_en_ms             bigint,
  ultima_version            bigint not null default 0,
  actualizado_en_ms         bigint not null
);

create index if not exists central_sessions_red_idx on central_sessions (empresa_id, fecha desc);
create index if not exists central_sessions_abiertas_idx on central_sessions (empresa_id, estado);
create index if not exists central_sessions_centro_idx on central_sessions (centro_id, fecha desc);

-- La caja vista desde la red. Existe para responder rápido a «¿cuál lleva tres
-- días sin cerrar?», que con solo la tabla de jornadas obligaría a agregar todo
-- el histórico cada vez que se abre la pantalla.
create table if not exists central_registers (
  register_id          integer primary key,
  empresa_id           uuid not null,
  centro_id            uuid,
  ultima_actividad_ms  bigint,
  ultima_fecha_cerrada date,
  jornada_abierta_id   integer,
  ingresos_bancarios   integer not null default 0,
  ingresado_centimos   bigint not null default 0,
  actualizado_en_ms    bigint not null
);

create index if not exists central_registers_empresa_idx on central_registers (empresa_id);

-- Alta del módulo `central` en licencias y permisos.
--
-- El CHECK se recrea con la lista COMPLETA y en UN SOLO sitio. Es la regla que
-- este proyecto aprendió por las malas: con dos bloques recreando el mismo
-- CHECK, el de arriba se queda con la lista vieja y el servidor deja de
-- arrancar en cuanto existe la primera fila con el valor nuevo.
alter table app_licencias drop constraint if exists app_licencias_modulo_check;
alter table app_licencias add constraint app_licencias_modulo_check
  check (modulo in ('administracion','tyrecontrol','almacen','sea-core','toolcontrol',
                    'safety','presencia','taller','workplanner','cash','central'));

alter table app_usuario_modulos drop constraint if exists app_usuario_modulos_modulo_check;
alter table app_usuario_modulos add constraint app_usuario_modulos_modulo_check
  check (modulo in ('administracion','tyrecontrol','almacen','sea-core','toolcontrol',
                    'safety','presencia','taller','workplanner','cash','central'));
