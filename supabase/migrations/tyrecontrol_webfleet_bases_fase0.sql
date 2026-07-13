-- ============================================================
-- SEA TyreControl — Webfleet "vehículos en base" (Fase 0: fundación).
--
-- Objetivo: saber qué vehículos están físicamente en una base para
-- aprovechar y hacer las revisiones pendientes (NO es seguimiento GPS).
--
-- La BASE es la DELEGACIÓN: la geo-zona (posición GPS + radio) se define
-- en la propia delegación, y los vehículos asignados a ella la heredan.
-- El estado se calcula por posición: comparamos la última posición GPS
-- (showObjectReportExtern) con la geo-zona de las delegaciones.
--
-- Estado Webfleet: en_base | otra_base | en_ruta | sin_conexion | sin_dispositivo.
-- ============================================================

-- Si existía la tabla de bases separada de una versión previa, se elimina:
-- ahora las bases son las delegaciones.
drop table if exists tc_bases_webfleet cascade;

-- ── 1. Geo-zona en la delegación (la "base") ────────────────────────────────
alter table tc_delegaciones add column if not exists webfleet_lat            numeric;
alter table tc_delegaciones add column if not exists webfleet_lng            numeric;
alter table tc_delegaciones add column if not exists webfleet_radio_m        int default 300;
alter table tc_delegaciones add column if not exists webfleet_zona_nombre    text;   -- nombre de la zona en Webfleet (referencia)
alter table tc_delegaciones add column if not exists webfleet_genera_avisos  boolean not null default true;

comment on column tc_delegaciones.webfleet_lat is
  'Centro de la geo-zona de la base (lat). Con lng+radio define dónde está "en base".';

-- ── 2. Periodicidad de revisión (para "vencida / próxima") ──────────────────
alter table tc_tipos_vehiculo add column if not exists revision_intervalo_dias int;
alter table tc_tipos_vehiculo add column if not exists revision_intervalo_km   int;
alter table tc_vehiculos      add column if not exists revision_intervalo_dias int;
alter table tc_vehiculos      add column if not exists revision_intervalo_km   int;

-- ── 3. Estado Webfleet actual por vehículo ──────────────────────────────────
create table if not exists tc_vehiculo_webfleet_estado (
  vehiculo_id     uuid primary key references tc_vehiculos(id) on delete cascade,
  empresa_id      uuid not null references tc_empresas(id) on delete cascade,
  estado          text not null default 'sin_dispositivo'
                    check (estado in ('en_base','otra_base','en_ruta','sin_conexion','sin_dispositivo')),
  delegacion_id   uuid references tc_delegaciones(id) on delete set null,  -- base detectada
  lat             numeric,
  lng             numeric,
  postext         text,
  velocidad_kmh   numeric,
  odometro_km     int,
  pos_time        timestamptz,
  entrada_base_at timestamptz,
  updated_at      timestamptz not null default now()
);
-- Compatibilidad si venía de una versión con base_id:
alter table tc_vehiculo_webfleet_estado add column if not exists delegacion_id uuid references tc_delegaciones(id) on delete set null;
alter table tc_vehiculo_webfleet_estado drop column if exists base_id;
create index if not exists idx_wf_estado_estado  on tc_vehiculo_webfleet_estado (estado);
create index if not exists idx_wf_estado_empresa on tc_vehiculo_webfleet_estado (empresa_id);

-- ── 4. Configuración del servicio de sincronización (única fila) ────────────
create table if not exists tc_webfleet_sync_config (
  id                       int primary key default 1 check (id = 1),
  intervalo_min            int not null default 5,
  min_tiempo_base_min      int not null default 10,
  antiguedad_max_pos_min   int not null default 30,
  alertas_activas          boolean not null default true,
  updated_at               timestamptz not null default now()
);
insert into tc_webfleet_sync_config (id) values (1) on conflict (id) do nothing;

-- ── 5. Alertas internas (entrada en base con revisión vencida) ──────────────
create table if not exists tc_webfleet_alertas (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references tc_empresas(id) on delete cascade,
  vehiculo_id     uuid not null references tc_vehiculos(id) on delete cascade,
  delegacion_id   uuid references tc_delegaciones(id) on delete set null,
  entrada_base_at timestamptz,
  mensaje         text not null,
  leida           boolean not null default false,
  created_at      timestamptz not null default now()
);
alter table tc_webfleet_alertas add column if not exists delegacion_id uuid references tc_delegaciones(id) on delete set null;
alter table tc_webfleet_alertas drop column if exists base_id cascade;
create unique index if not exists uq_wf_alertas_estancia on tc_webfleet_alertas (vehiculo_id, delegacion_id, entrada_base_at);
create index if not exists idx_wf_alertas_no_leidas on tc_webfleet_alertas (empresa_id) where not leida;

-- ── 6. RLS ──────────────────────────────────────────────────────────────────
alter table tc_vehiculo_webfleet_estado   enable row level security;
alter table tc_webfleet_sync_config       enable row level security;
alter table tc_webfleet_alertas           enable row level security;

drop policy if exists wf_estado_select on tc_vehiculo_webfleet_estado;
create policy wf_estado_select on tc_vehiculo_webfleet_estado for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists wf_estado_write on tc_vehiculo_webfleet_estado;
create policy wf_estado_write on tc_vehiculo_webfleet_estado for all
  using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

drop policy if exists wf_sync_cfg_all on tc_webfleet_sync_config;
create policy wf_sync_cfg_all on tc_webfleet_sync_config for all
  using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

drop policy if exists wf_alertas_select on tc_webfleet_alertas;
create policy wf_alertas_select on tc_webfleet_alertas for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists wf_alertas_write on tc_webfleet_alertas;
create policy wf_alertas_write on tc_webfleet_alertas for all
  using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );
