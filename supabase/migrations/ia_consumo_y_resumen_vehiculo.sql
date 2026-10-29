-- ─────────────────────────────────────────────────────────────────────────
-- IA: control de consumo, interruptor por empresa y caché del resumen.
--
-- Hasta ahora la capa única de IA (server/core/openaiService.ts) solo escribía
-- sus métricas con `console.log`: ni coste acumulado, ni cuota, ni forma de
-- saber qué empresa gasta. Con cinco lectores de imagen y un asistente ya en
-- producción, eso es un grifo abierto sin contador. Esto pone el contador.
--
-- Tres tablas y ninguna toca lo que ya había.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. El contador ───────────────────────────────────────────────────────
--
-- UNA fila por PETICIÓN lógica, no por intento: si el proveedor falla dos
-- veces y responde a la tercera, eso es una fila con `intentos = 3`. Si hubo
-- que caer al modelo de respaldo, `uso_respaldo` lo dice y `modelo_servido`
-- guarda el que de verdad contestó, que no tiene por qué ser el pedido.
--
-- Lo que NO se guarda, y no es un olvido: ni el prompt, ni la respuesta, ni
-- matrículas, ni documentos, ni nada que identifique a una persona o a un
-- vehículo. Por esta capa pasan fichas técnicas y datos de clientes, y un
-- contador de gasto no es sitio para eso. `error_codigo` va recortado y sin
-- cuerpo del error.
create table if not exists ia_uso (
  id               uuid primary key default gen_random_uuid(),
  -- Null cuando la llamada no pertenece a ninguna empresa (p. ej. una
  -- transcripción de WhatsApp de Assist). No se inventa una.
  empresa_id       uuid references tc_empresas(id) on delete set null,
  modulo           text not null,
  operacion        text not null,
  -- Lo pedido y lo servido se guardan por separado a propósito: con respaldo
  -- configurado, "qué modelo contestó" es justo lo que no se puede deducir.
  modelo_pedido    text not null,
  modelo_servido   text,
  uso_respaldo     boolean not null default false,
  -- Intentos contra el proveedor. 0 en una respuesta servida de caché.
  intentos         integer not null default 0,
  origen           text not null default 'proveedor'
                   check (origen in ('proveedor', 'cache')),
  tokens_entrada   integer,
  tokens_salida    integer,
  duracion_ms      integer not null default 0,
  resultado        text not null
                   check (resultado in ('en_curso', 'ok', 'error', 'sin_clave', 'cuota')),
  -- Código corto, nunca el mensaje entero del proveedor.
  error_codigo     text,
  -- El id de la respuesta del proveedor, para poder cruzar una incidencia
  -- con su factura sin guardar el contenido.
  peticion_id      text,
  creado_at        timestamptz not null default now(),
  cerrado_at       timestamptz
);

-- El índice que de verdad se usa: "cuánto lleva esta empresa hoy".
create index if not exists ia_uso_empresa_dia_idx
  on ia_uso (empresa_id, creado_at desc);
create index if not exists ia_uso_operacion_idx
  on ia_uso (operacion, creado_at desc);

-- ── 2. El interruptor y los topes ────────────────────────────────────────
--
-- Sin fila para una empresa valen los valores por defecto del entorno, y eso
-- es deliberado: añadir el contador NO puede apagarle la IA a nadie que hoy
-- la tenga funcionando. Por eso `ia_activa` nace en `true`.
--
-- `resumen_vehiculo_activo` nace en `false` por el motivo contrario: es
-- funcionalidad nueva y no se le enciende a todos los clientes por el hecho
-- de desplegarla. Se activa cliente a cliente.
--
-- Los topes son de PETICIONES y de TOKENS, que es lo que el proveedor informa.
-- No son un presupuesto en euros: convertir tokens a dinero exige una tarifa
-- vigente y verificada, y mientras no la haya, aquí no se finge que la hay.
create table if not exists ia_limites (
  empresa_id              uuid primary key references tc_empresas(id) on delete cascade,
  ia_activa               boolean not null default true,
  resumen_vehiculo_activo boolean not null default false,
  -- Null = sin tope propio; se aplica el del entorno.
  max_peticiones_dia      integer check (max_peticiones_dia is null or max_peticiones_dia >= 0),
  max_tokens_dia          integer check (max_tokens_dia is null or max_tokens_dia >= 0),
  nota                    text,
  actualizado_at          timestamptz not null default now(),
  actualizado_por         uuid
);

-- ── 3. La caché del resumen ──────────────────────────────────────────────
--
-- La huella cubre todo lo que puede cambiar la respuesta: los datos de
-- entrada, la versión del prompt y del esquema, y el ALCANCE con el que se
-- pidió. Lo último importa: dos usuarios con permisos distintos pueden ver
-- distinto, y servirle a uno lo que se generó para otro sería una fuga.
--
-- `caduca_at` existe además de la huella porque hay afirmaciones que dependen
-- del reloj y no de ningún registro: «lleva 12 días abierta» envejece sola
-- aunque no cambie una fila.
create table if not exists ia_resumen_vehiculo (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references tc_empresas(id) on delete cascade,
  vehiculo_id   uuid not null references tc_vehiculos(id) on delete cascade,
  huella        text not null,
  version       text not null,
  modelo        text,
  payload       jsonb not null,
  generado_at   timestamptz not null default now(),
  caduca_at     timestamptz not null,
  unique (vehiculo_id, huella)
);

create index if not exists ia_resumen_vehiculo_busqueda_idx
  on ia_resumen_vehiculo (vehiculo_id, caduca_at desc);

-- ── Permisos ─────────────────────────────────────────────────────────────
--
-- Las tres las escribe el servidor con la service key. El panel todavía no
-- las lee, así que no se concede nada a `authenticated` más allá de lo que
-- hace falta para que un administrador pueda mirar su propio consumo cuando
-- se construya esa pantalla. Escribir, nunca desde la aplicación.
alter table ia_uso              enable row level security;
alter table ia_limites          enable row level security;
alter table ia_resumen_vehiculo enable row level security;

drop policy if exists ia_uso_lectura on ia_uso;
create policy ia_uso_lectura on ia_uso
  for select to authenticated
  using (empresa_id is not null and tc_puede_ver_empresa(empresa_id));

drop policy if exists ia_limites_lectura on ia_limites;
create policy ia_limites_lectura on ia_limites
  for select to authenticated
  using (tc_puede_ver_empresa(empresa_id));

drop policy if exists ia_resumen_lectura on ia_resumen_vehiculo;
create policy ia_resumen_lectura on ia_resumen_vehiculo
  for select to authenticated
  using (tc_puede_ver_empresa(empresa_id));

revoke insert, update, delete, truncate on ia_uso              from anon, authenticated;
revoke insert, update, delete, truncate on ia_limites          from anon, authenticated;
revoke insert, update, delete, truncate on ia_resumen_vehiculo from anon, authenticated;

grant select on ia_uso, ia_limites, ia_resumen_vehiculo to authenticated, service_role;
