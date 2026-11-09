-- Dónde está la tablet de cada operario, y dónde se hizo cada revisión.
--
-- ── Dos cosas distintas, y conviene no confundirlas ─────────────────────────
--
--   1. `tc_posicion_tablet`: dónde está AHORA la tablet de un operario. Una
--      sola fila por operario, la última. No es un recorrido: no se guarda por
--      dónde ha ido, igual que en Mobilink Assist («el mapa enseña dónde está
--      ahora, no por dónde ha ido»). Se borra al cerrar sesión.
--
--   2. Las coordenadas en `revisiones_vehiculo`: dónde se abrió y dónde se
--      cerró cada revisión. Eso sí es permanente, porque forma parte del
--      registro de la revisión: certifica que se hizo donde dice que se hizo.
--
-- ── Por qué tabla aparte y no columnas en tc_usuarios ───────────────────────
--
-- Porque `tc_usuarios` la lee CADA comprobación de RLS del sistema
-- (`tc_auth_empresa_id()`, `tc_is_admin()`, `tc_is_cliente()`), y la posición
-- se escribe una vez por minuto y por operario. Meter esa escritura en la
-- tabla más leída de la instalación ensuciaría sin parar unas páginas que
-- están en el camino de todas las consultas. En su propia tabla, el churn se
-- queda donde no molesta.
--
-- ── Y por qué `empresa_id` repetido aquí ────────────────────────────────────
--
-- Para que la política de lectura sea una comparación y no una subconsulta
-- contra tc_usuarios en cada fila. Lo escribe el servidor copiando el del
-- perfil; es la empresa del OPERARIO (la de servicio), no la del cliente cuya
-- flota esté revisando.

-- ── 1. La posición de la tablet ─────────────────────────────────────────────

create table if not exists tc_posicion_tablet (
  usuario_id     uuid primary key references tc_usuarios(id) on delete cascade,
  empresa_id     uuid references tc_empresas(id) on delete set null,
  lat            double precision not null,
  lng            double precision not null,
  precision_m    double precision,
  velocidad_kmh  double precision,
  -- Cuándo se tomó la posición en la tablet, no cuándo llegó aquí: con la cola
  -- offline pueden ser dos momentos muy distintos.
  visto_at       timestamptz not null,
  actualizado_at timestamptz not null default now()
);

comment on table tc_posicion_tablet is
  'Última posición conocida de la tablet de cada operario. Una fila por operario; se borra al cerrar sesión. No es un recorrido.';

create index if not exists idx_tc_posicion_tablet_empresa
  on tc_posicion_tablet (empresa_id, visto_at desc);

alter table tc_posicion_tablet enable row level security;

/*
 * Quién la ve: lo mismo que quién ve al usuario.
 *
 * Mismo criterio que `tc_usuarios_select`, a propósito: si alguien puede ver
 * que existe un operario, puede ver dónde tiene la tablet; y si no, no. Dos
 * criterios distintos para la misma persona serían una puerta de atrás.
 *
 * Un cliente (`tc_is_cliente()`) no ve ninguna: la posición de los técnicos de
 * Mobilink no es asunto suyo.
 */
drop policy if exists tc_posicion_tablet_select on tc_posicion_tablet;
create policy tc_posicion_tablet_select on tc_posicion_tablet
  for select using (
    usuario_id = auth.uid()
    or tc_is_superadmin()
    or ((not tc_is_cliente()) and empresa_id = tc_auth_empresa_id())
  );

/*
 * Escribir, solo el servidor.
 *
 * No hay política de INSERT ni de UPDATE para `authenticated`: la tablet manda
 * su posición al backend y es el backend, con la clave de servicio, quien
 * escribe. Así nadie puede colocar su tablet donde le convenga desde el móvil
 * con un token de usuario.
 */

grant select on tc_posicion_tablet to authenticated;

-- ── 2. Dónde se hizo la revisión ────────────────────────────────────────────

alter table revisiones_vehiculo
  add column if not exists inicio_lat         double precision,
  add column if not exists inicio_lng         double precision,
  add column if not exists inicio_precision_m double precision,
  add column if not exists fin_lat            double precision,
  add column if not exists fin_lng            double precision,
  add column if not exists fin_precision_m    double precision;

comment on column revisiones_vehiculo.inicio_lat is
  'Dónde estaba la tablet al abrir la revisión. Null en las del CheckPoint y en las anteriores a esta función.';
comment on column revisiones_vehiculo.fin_lat is
  'Dónde estaba la tablet al cerrarla. Null si el cierre llegó por la cola offline sin posición.';

-- Las seis columnas son legibles por quien ya puede leer la revisión: la RLS
-- de `revisiones_vehiculo` no se toca, y en Postgres es por filas, no por
-- columnas. No hace falta ningún grant nuevo.
