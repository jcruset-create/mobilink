-- «Por dónde rueda»: km por tipo de vía (autopista, autovía, nacional,
-- autonómica/comarcal, local, urbana) de los vehículos marcados.
--
-- Cómo funciona (el cálculo lo hace el servidor, server/tyrecontrol/tipoVia):
--   · Cada noche pide a Movertis el recorrido del día anterior (un punto cada
--     ~10 s) de los vehículos con la casilla «Analizar por dónde rueda».
--   · Pega cada punto a la vía más cercana del mapa de OpenStreetMap
--     (tc_vias_osm), que se va cargando por teselas solo donde ruedan.
--   · Guarda el RESUMEN por vehículo, día, tipo y carretera. No los puntos.
--
-- Esta migración:
--   1. Activa PostGIS (en el esquema extensions, como recomienda Supabase).
--   2. Crea las tablas: vías, teselas cargadas, la casilla por vehículo, el
--      resumen por día y el resumen por tipo de vía.
--   3. tc_vias_candidatas: las vías más cercanas a cada punto (solo servidor).
--   4. tc_analisis_vias_activar: la casilla de la ficha (administradores).
--   5. Marca ya los vehículos con seguimiento de rendimiento activo.
--
-- No toca tc_neumaticos, tc_montajes_actuales, tc_vehiculo_ejes,
-- config_ejes_id ni km_actual. Idempotente: se puede pegar dos veces.

create extension if not exists postgis with schema extensions;

-- 1. El mapa de carreteras (solo lo que se necesita para clasificar).
create table if not exists tc_vias_osm (
  osm_id     bigint primary key,
  highway    text not null,
  ref        text,
  nombre     text,
  maxspeed   integer,
  peaje      boolean not null default false,
  geom       extensions.geometry(LineString, 4326) not null,
  cargada_at timestamptz not null default now()
);
create index if not exists tc_vias_osm_geom on tc_vias_osm using gist (geom);

-- Teselas de 0,1° × 0,1° ya descargadas de OpenStreetMap.
create table if not exists tc_vias_osm_teselas (
  tesela     text primary key,
  vias       integer not null default 0,
  cargada_at timestamptz not null default now()
);

-- 2. La casilla «Analizar por dónde rueda» de la ficha del vehículo.
create table if not exists tc_analisis_vias_vehiculo (
  vehiculo_id uuid primary key references tc_vehiculos(id) on delete cascade,
  empresa_id  uuid not null,
  activo      boolean not null default true,
  creado_por  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Un día analizado de un vehículo.
create table if not exists tc_recorrido_dia (
  vehiculo_id  uuid not null references tc_vehiculos(id) on delete cascade,
  empresa_id   uuid not null,
  fecha        date not null,
  estado       text not null check (estado in ('ok', 'sin_puntos', 'error')),
  puntos       integer not null default 0,
  km_puntos    numeric,
  km_resumen   numeric,
  km_sin_via   numeric,
  error        text,
  procesado_at timestamptz not null default now(),
  primary key (vehiculo_id, fecha)
);

-- Km y tiempo por tipo de vía y carretera, por vehículo y día.
create table if not exists tc_recorrido_tipo_via (
  vehiculo_id uuid not null references tc_vehiculos(id) on delete cascade,
  empresa_id  uuid not null,
  fecha       date not null,
  tipo        text not null check (tipo in ('autopista', 'autovia', 'nacional', 'autonomica', 'local', 'urbana', 'sin_via')),
  ref         text not null default '',
  km          numeric not null,
  segundos    integer not null default 0,
  primary key (vehiculo_id, fecha, tipo, ref)
);
create index if not exists tc_recorrido_tipo_via_empresa_fecha on tc_recorrido_tipo_via (empresa_id, fecha);

alter table tc_vias_osm enable row level security;
alter table tc_vias_osm_teselas enable row level security;
alter table tc_analisis_vias_vehiculo enable row level security;
alter table tc_recorrido_dia enable row level security;
alter table tc_recorrido_tipo_via enable row level security;
-- Las vías y teselas solo las usa el servidor (service_role, sin políticas).
drop policy if exists tc_analisis_vias_select on tc_analisis_vias_vehiculo;
create policy tc_analisis_vias_select on tc_analisis_vias_vehiculo for select to authenticated
  using ((select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id));
drop policy if exists tc_recorrido_dia_select on tc_recorrido_dia;
create policy tc_recorrido_dia_select on tc_recorrido_dia for select to authenticated
  using ((select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id));
drop policy if exists tc_recorrido_tipo_via_select on tc_recorrido_tipo_via;
create policy tc_recorrido_tipo_via_select on tc_recorrido_tipo_via for select to authenticated
  using ((select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id));

-- 3. Las (hasta 3) vías más cercanas a cada punto, a menos de p_radio_m metros.
--    p_puntos: [{"i":0,"lat":41.1,"lng":1.2}, ...]. Devuelve un único jsonb
--    (una fila) para no chocar con el tope de 1000 filas de la API.
drop function if exists public.tc_vias_candidatas(jsonb, numeric);
create or replace function public.tc_vias_candidatas(p_puntos jsonb, p_radio_m numeric default 30)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  with p as (
    select (e->>'i')::int as i,
           ST_SetSRID(ST_MakePoint((e->>'lng')::float8, (e->>'lat')::float8), 4326) as g
      from jsonb_array_elements(p_puntos) e
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'i', p.i, 'osm_id', c.osm_id, 'highway', c.highway, 'ref', c.ref, 'nombre', c.nombre,
           'maxspeed', c.maxspeed, 'peaje', c.peaje, 'dist_m', round(c.dist::numeric, 1))), '[]'::jsonb)
    from p
    cross join lateral (
      select v.osm_id, v.highway, v.ref, v.nombre, v.maxspeed, v.peaje,
             ST_Distance(v.geom::geography, p.g::geography) as dist
        from tc_vias_osm v
       where v.geom && ST_Expand(p.g, 0.0006)
       order by v.geom <-> p.g
       limit 3
    ) c
   where c.dist <= p_radio_m
$$;
revoke all on function public.tc_vias_candidatas(jsonb, numeric) from public, anon, authenticated;
grant execute on function public.tc_vias_candidatas(jsonb, numeric) to service_role;

-- 4. La casilla de la ficha.
create or replace function public.tc_analisis_vias_activar(p_vehiculo uuid, p_activo boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_emp uuid;
begin
  select empresa_id into v_emp from tc_vehiculos where id = p_vehiculo;
  if v_emp is null then raise exception 'Vehículo no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and v_emp = tc_auth_empresa_id())) then
    raise exception 'Solo un administrador puede cambiar el análisis de por dónde rueda';
  end if;
  insert into tc_analisis_vias_vehiculo (vehiculo_id, empresa_id, activo)
  values (p_vehiculo, v_emp, p_activo)
  on conflict (vehiculo_id) do update set activo = excluded.activo, updated_at = now();
end
$$;
revoke all on function public.tc_analisis_vias_activar(uuid, boolean) from public, anon;
grant execute on function public.tc_analisis_vias_activar(uuid, boolean) to authenticated, service_role;

-- 5. Los vehículos con seguimiento de rendimiento activo, ya marcados.
insert into tc_analisis_vias_vehiculo (vehiculo_id, empresa_id, activo, creado_por)
select s.vehiculo_id, s.empresa_id, true, null
  from tc_seguimiento_rendimiento s
 where s.activo
on conflict (vehiculo_id) do nothing;

do $migracion$
declare v_marcados int;
begin
  if to_regprocedure('public.tc_vias_candidatas(jsonb,numeric)') is null then
    raise exception 'No se ha creado tc_vias_candidatas';
  end if;
  select count(*) into v_marcados from tc_analisis_vias_vehiculo where activo;
  perform set_config('mobilink.resultado',
    format('OK: PostGIS activo y tablas de «Por dónde rueda» creadas; %s vehículos marcados para analizar.', v_marcados), false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
