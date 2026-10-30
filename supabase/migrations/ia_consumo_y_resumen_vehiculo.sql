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

-- ── 4. Coordinación entre instancias ─────────────────────────────────────
--
-- Dos personas pulsando «Resumen IA» a la vez sobre la misma ficha deben
-- costar UNA llamada, no dos. Dentro de un proceso eso lo resuelve un Map;
-- entre procesos, no: hoy el manifiesto de Render declara una sola instancia,
-- pero subir de plan añade instancias sin tocar una línea de código, y
-- durante un despliegue conviven dos procesos unos segundos.
--
-- Así que la coordinación vive en la base, con un arrendamiento por clave:
-- quien consigue insertar la fila es el que llama al proveedor; el resto
-- espera a que aparezca el resumen en la caché.
--
-- `caduca_at` es lo que hace esto recuperable: si la instancia que tenía el
-- arrendamiento se muere a media llamada, la fila caduca y otra lo toma. Sin
-- caducidad, un proceso muerto dejaría la ficha bloqueada para siempre.
--
-- Y a propósito NO se usa un lock de transacción: eso obligaría a mantener
-- una transacción abierta mientras se espera a OpenAI —medio minuto con una
-- conexión del pool secuestrada—, que es exactamente lo que no se debe hacer.
create table if not exists ia_resumen_en_curso (
  clave       text primary key,
  empresa_id  uuid not null references tc_empresas(id) on delete cascade,
  vehiculo_id uuid not null references tc_vehiculos(id) on delete cascade,
  -- Quién lo tiene. Solo para diagnóstico: no se confía en ello para nada.
  instancia   text not null,
  iniciado_at timestamptz not null default now(),
  caduca_at   timestamptz not null
);

create index if not exists ia_resumen_en_curso_caduca_idx
  on ia_resumen_en_curso (caduca_at);

-- ── Permisos ─────────────────────────────────────────────────────────────
--
-- Las tres las escribe el servidor con la service key. El panel todavía no
-- las lee, así que no se concede nada a `authenticated` más allá de lo que
-- hace falta para que un administrador pueda mirar su propio consumo cuando
-- se construya esa pantalla. Escribir, nunca desde la aplicación.
alter table ia_uso               enable row level security;
alter table ia_limites           enable row level security;
alter table ia_resumen_vehiculo  enable row level security;
alter table ia_resumen_en_curso  enable row level security;

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

-- Se revoca TODO primero y se concede después solo lo que hace falta. En este
-- orden a propósito: Supabase trae `alter default privileges` que conceden de
-- oficio a anon y authenticated sobre lo nuevo de public, así que crear una
-- tabla y no decir nada equivale a abrirla. Esto lo cierra.
revoke all on ia_uso              from public, anon, authenticated;
revoke all on ia_limites          from public, anon, authenticated;
revoke all on ia_resumen_vehiculo from public, anon, authenticated;
revoke all on ia_resumen_en_curso from public, anon, authenticated;

-- Lectura para el panel, acotada por las políticas de arriba (que solo
-- cubren SELECT: sin política de escritura, con RLS activa, escribir desde la
-- aplicación es imposible aunque alguien concediera el permiso por error).
grant select on ia_uso, ia_limites, ia_resumen_vehiculo to authenticated;

-- El servidor escribe con la service key, que además salta la RLS.
grant select, insert, update, delete on ia_uso, ia_limites, ia_resumen_vehiculo, ia_resumen_en_curso to service_role;

-- `ia_resumen_en_curso` es fontanería interna: ni el panel ni la APK la
-- necesitan, así que no se le concede nada a authenticated. Sin grant y sin
-- política, para un cliente no existe.

-- No se crea ninguna función SQL para reservar cuota: la lógica vive en el
-- servidor (server/core/iaConsumo.ts) y lo único que se usa de la base es
-- `pg_advisory_xact_lock`, que es un built-in de PostgreSQL con EXECUTE para
-- PUBLIC de fábrica. Es decir: no se añade superficie nueva invocable desde
-- el cliente, y no hay ninguna función SECURITY DEFINER que auditar.
