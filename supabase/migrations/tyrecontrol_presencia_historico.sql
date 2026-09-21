-- ============================================================================
-- Histórico de presencia en bases: dónde ha estado cada vehículo y cuándo.
--
-- ── Por qué hace falta otra tabla ───────────────────────────────────────────
--
-- `tc_vehiculo_presencia_base` tiene `vehiculo_id` como CLAVE PRIMARIA: guarda
-- el ahora y el barrido de cada 10 minutos lo pisa. Contesta «¿dónde está?» y
-- no puede contestar «¿dónde suele estar?», que es lo que hace falta para
-- planificar revisiones: a este autobús lo pillas en Vilanova a partir de las
-- 22:00, y los domingos a cualquier hora.
--
-- El dato ya se está midiendo —una llamada al proveedor por cuenta y vuelta,
-- 144 al día para 751 vehículos—. Lo único que faltaba era no tirarlo.
--
-- ── Estancias, no muestras ──────────────────────────────────────────────────
--
-- Una fila por ESTANCIA, no por barrido. Un autobús que pasa la noche en la
-- base genera una fila, no sesenta. Mientras el barrido lo siga viendo en el
-- mismo sitio y en el mismo estado, se alarga la fila abierta (`visto_at` y
-- `muestras`); cuando cambia, se cierra y se abre otra.
--
-- Medido en la flota de Plana: un vehículo de servicio diario da unas dos
-- estancias al día, no 144.
--
-- ── `hasta` es la ÚLTIMA MUESTRA, no el momento de cerrar ───────────────────
--
-- Y `desde`/`hasta` cubren solo tiempo OBSERVADO. Si el servidor se cae tres
-- horas y al volver el autobús sigue donde estaba, NO se alarga la estancia:
-- se cierra la anterior y se abre una nueva. Alargarla diría que se le vio
-- allí durante esas tres horas, y no se le vio. El hueco se queda como hueco,
-- que es lo que permite decir después «este porcentaje está medido sobre 110
-- horas, no sobre 120».
--
-- ── Esto no es seguimiento de personas ──────────────────────────────────────
--
-- Se guarda el estado y la base, no el recorrido: ni rutas, ni paradas fuera
-- de base, ni conductor. Sirve para saber a quién se puede revisar sin sacarlo
-- de servicio, y para nada más.
-- ============================================================================

create table if not exists tc_vehiculo_presencia_historico (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references tc_empresas(id) on delete cascade,
  vehiculo_id    uuid not null references tc_vehiculos(id) on delete cascade,

  -- Los mismos cinco estados que la tabla del ahora. Se repiten aquí en vez de
  -- referenciarlos para que esta tabla se entienda sola al leerla.
  estado         text not null check (estado in (
                   'IN_BASE', 'OUTSIDE_BASES', 'STALE_POSITION',
                   'NO_POSITION', 'INVALID_POSITION')),
  -- La base, cuando la hay. `on delete set null`: borrar una delegación no
  -- puede llevarse por delante el histórico de lo que pasó cuando existía.
  delegacion_id  uuid references tc_delegaciones(id) on delete set null,

  desde          timestamptz not null,
  -- Última vez que un barrido confirmó esta estancia.
  visto_at       timestamptz not null,
  -- Null = abierta. Al cerrar se copia `visto_at`, nunca `now()`.
  hasta          timestamptz,
  muestras       integer not null default 1 check (muestras > 0),

  creado_at      timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

-- Un vehículo no puede tener dos estancias abiertas a la vez. Es la invariante
-- de la que depende todo lo demás, y se deja que la garantice la base: si un
-- fallo del barrido intentara abrir una segunda, falla ahí y no callando.
create unique index if not exists idx_presencia_hist_abierta
  on tc_vehiculo_presencia_historico (vehiculo_id) where hasta is null;

-- El acceso normal: las estancias de un vehículo, de la más reciente atrás.
create index if not exists idx_presencia_hist_vehiculo
  on tc_vehiculo_presencia_historico (vehiculo_id, desde desc);
-- Para los informes por empresa y ventana.
create index if not exists idx_presencia_hist_empresa
  on tc_vehiculo_presencia_historico (empresa_id, desde desc);
create index if not exists idx_presencia_hist_delegacion
  on tc_vehiculo_presencia_historico (delegacion_id, desde desc);

comment on table tc_vehiculo_presencia_historico is
  'Estancias de cada vehículo respecto a las bases, una fila por estancia y no por barrido. Sale del mismo barrido de presencia que ya corre, sin peticiones extra al proveedor. `desde`..`hasta` cubren solo tiempo observado: un hueco de barrido corta la estancia en vez de alargarla.';
comment on column tc_vehiculo_presencia_historico.visto_at is
  'Última muestra que confirmó la estancia. Al cerrar, `hasta` toma este valor y no la hora de cierre: así el intervalo nunca incluye tiempo que no se vio.';
comment on column tc_vehiculo_presencia_historico.hasta is
  'Null mientras la estancia sigue abierta.';

-- ── RLS: mismo criterio que la tabla del ahora ─────────────────────────────
alter table tc_vehiculo_presencia_historico enable row level security;

drop policy if exists presencia_hist_select on tc_vehiculo_presencia_historico;
create policy presencia_hist_select on tc_vehiculo_presencia_historico for select
  using ( tc_puede_ver_empresa(empresa_id) );

-- Escribe el barrido, que corre con la clave de servicio y no pasa por RLS.
-- Se deja también a los administradores para poder corregir a mano.
drop policy if exists presencia_hist_write on tc_vehiculo_presencia_historico;
create policy presencia_hist_write on tc_vehiculo_presencia_historico for all
  using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );

-- ── Dos funciones, para no hacer 700 peticiones cada diez minutos ──────────
--
-- En un barrido normal la inmensa mayoría de los vehículos siguen donde
-- estaban, así que lo habitual es alargar ~700 estancias de golpe. Con un
-- UPDATE por fila serían 700 viajes a la base cada diez minutos; con esto, uno.
--
-- `muestras` no se puede resolver con un upsert porque depende de su propio
-- valor, y `hasta` al cerrar no es un parámetro: es el `visto_at` de cada fila
-- —su última muestra observada—, y por eso se copia en el propio UPDATE.

create or replace function tc_presencia_hist_extender(p_ids uuid[], p_visto_at timestamptz)
returns integer language sql security definer set search_path = public as $$
  with tocadas as (
    update tc_vehiculo_presencia_historico
       set visto_at = p_visto_at,
           muestras = muestras + 1,
           actualizado_at = p_visto_at
     where id = any(p_ids) and hasta is null
     returning 1
  ) select count(*)::integer from tocadas;
$$;

create or replace function tc_presencia_hist_cerrar(p_ids uuid[], p_ahora timestamptz)
returns integer language sql security definer set search_path = public as $$
  with tocadas as (
    update tc_vehiculo_presencia_historico
       -- `hasta` = su propia última muestra, NUNCA `p_ahora`: el intervalo no
       -- puede incluir tiempo que no se observó.
       set hasta = visto_at,
           actualizado_at = p_ahora
     where id = any(p_ids) and hasta is null
     returning 1
  ) select count(*)::integer from tocadas;
$$;

revoke all on function tc_presencia_hist_extender(uuid[], timestamptz) from public, anon;
revoke all on function tc_presencia_hist_cerrar(uuid[], timestamptz) from public, anon;
grant execute on function tc_presencia_hist_extender(uuid[], timestamptz) to service_role;
grant execute on function tc_presencia_hist_cerrar(uuid[], timestamptz) to service_role;
