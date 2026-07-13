-- ============================================================
-- SEA TyreControl — Webfleet "vehículos en base" (Fase 0: fundación).
--
-- Objetivo: saber qué vehículos están físicamente en una base para
-- aprovechar y hacer las revisiones pendientes (NO es seguimiento GPS).
--
-- Módulo desacoplado: tablas propias + un servicio de sincronización
-- aislado en el backend. Sin valores fijos en código.
--
-- Estado Webfleet por vehículo: en_base | otra_base | en_ruta |
-- sin_conexion | sin_dispositivo. Se calcula por posición: comparamos
-- la última posición GPS (showObjectReportExtern) con las bases
-- definidas (centro+radio o polígono).
-- ============================================================

-- ── 1. Periodicidad de revisión (para "vencida / próxima") ──────────────────
-- Por defecto por tipo de vehículo; override opcional por vehículo.
alter table tc_tipos_vehiculo add column if not exists revision_intervalo_dias int;
alter table tc_tipos_vehiculo add column if not exists revision_intervalo_km   int;
alter table tc_vehiculos      add column if not exists revision_intervalo_dias int;
alter table tc_vehiculos      add column if not exists revision_intervalo_km   int;

comment on column tc_vehiculos.revision_intervalo_dias is
  'Cada cuántos días toca revisión (override del tipo). NULL = usar el del tipo.';

-- ── 2. Bases ↔ zona Webfleet ────────────────────────────────────────────────
-- Cada base de un cliente (empresa) se asocia a una zona. La pertenencia se
-- calcula por centro+radio, o por polígono si se define (jsonb [[lat,lng],…]).
create table if not exists tc_bases_webfleet (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references tc_empresas(id) on delete cascade,
  nombre              text not null,                 -- p.ej. "Autocares Plana - Reus"
  webfleet_area_id    text,                          -- id de la zona en Webfleet (referencia)
  webfleet_area_nombre text,                         -- nombre de la zona en Webfleet
  centro_lat          numeric,
  centro_lng          numeric,
  radio_m             int default 300,               -- radio en metros (si no hay polígono)
  poligono            jsonb,                          -- opcional: [[lat,lng],…]
  genera_avisos       boolean not null default true, -- ¿genera alertas al entrar?
  activa              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_bases_wf_empresa on tc_bases_webfleet (empresa_id) where activa;

-- ── 3. Estado Webfleet actual por vehículo ──────────────────────────────────
create table if not exists tc_vehiculo_webfleet_estado (
  vehiculo_id     uuid primary key references tc_vehiculos(id) on delete cascade,
  empresa_id      uuid not null references tc_empresas(id) on delete cascade, -- para RLS
  estado          text not null default 'sin_dispositivo'
                    check (estado in ('en_base','otra_base','en_ruta','sin_conexion','sin_dispositivo')),
  base_id         uuid references tc_bases_webfleet(id) on delete set null,   -- base detectada
  lat             numeric,
  lng             numeric,
  postext         text,
  velocidad_kmh   numeric,
  odometro_km     int,
  pos_time        timestamptz,   -- hora de la última posición recibida
  entrada_base_at timestamptz,   -- desde cuándo está en la base actual
  updated_at      timestamptz not null default now()
);
create index if not exists idx_wf_estado_estado  on tc_vehiculo_webfleet_estado (estado);
create index if not exists idx_wf_estado_empresa on tc_vehiculo_webfleet_estado (empresa_id);
create index if not exists idx_wf_estado_base    on tc_vehiculo_webfleet_estado (base_id);

-- ── 4. Configuración del servicio de sincronización (única fila) ────────────
create table if not exists tc_webfleet_sync_config (
  id                       int primary key default 1 check (id = 1),
  intervalo_min            int not null default 5,   -- cada cuántos minutos sincroniza
  min_tiempo_base_min      int not null default 10,  -- min. dentro para considerar "en base"
  antiguedad_max_pos_min   int not null default 30,  -- si la posición es más vieja → sin_conexion
  alertas_activas          boolean not null default true,
  updated_at               timestamptz not null default now()
);
insert into tc_webfleet_sync_config (id) values (1) on conflict (id) do nothing;

-- ── 5. Alertas internas (entrada en base con revisión vencida) ──────────────
-- Se deduplican por "estancia": mientras el vehículo siga en la misma base
-- (mismo entrada_base_at) no se repite la alerta.
create table if not exists tc_webfleet_alertas (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references tc_empresas(id) on delete cascade,
  vehiculo_id     uuid not null references tc_vehiculos(id) on delete cascade,
  base_id         uuid references tc_bases_webfleet(id) on delete set null,
  entrada_base_at timestamptz,   -- estancia a la que corresponde (para no repetir)
  mensaje         text not null,
  leida           boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (vehiculo_id, base_id, entrada_base_at)
);
create index if not exists idx_wf_alertas_no_leidas on tc_webfleet_alertas (empresa_id) where not leida;

-- ── 6. RLS ──────────────────────────────────────────────────────────────────
alter table tc_bases_webfleet             enable row level security;
alter table tc_vehiculo_webfleet_estado   enable row level security;
alter table tc_webfleet_sync_config       enable row level security;
alter table tc_webfleet_alertas           enable row level security;

-- Bases: ven quienes ven la empresa; editan admin/superadmin.
drop policy if exists bases_wf_select on tc_bases_webfleet;
create policy bases_wf_select on tc_bases_webfleet for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists bases_wf_write on tc_bases_webfleet;
create policy bases_wf_write on tc_bases_webfleet for all
  using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );

-- Estado: lectura por empresa; escritura solo servicio (service role) / admin.
drop policy if exists wf_estado_select on tc_vehiculo_webfleet_estado;
create policy wf_estado_select on tc_vehiculo_webfleet_estado for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists wf_estado_write on tc_vehiculo_webfleet_estado;
create policy wf_estado_write on tc_vehiculo_webfleet_estado for all
  using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );

-- Config: solo admin/superadmin.
drop policy if exists wf_sync_cfg_all on tc_webfleet_sync_config;
create policy wf_sync_cfg_all on tc_webfleet_sync_config for all
  using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );

-- Alertas: lectura por empresa; marcar leída admin/superadmin.
drop policy if exists wf_alertas_select on tc_webfleet_alertas;
create policy wf_alertas_select on tc_webfleet_alertas for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists wf_alertas_write on tc_webfleet_alertas;
create policy wf_alertas_write on tc_webfleet_alertas for all
  using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );
