-- ─────────────────────────────────────────────────────────────────
-- Mobilink Telematics Engine (MTE) - Esquema PostgreSQL / Supabase
-- Ejecutar en el SQL Editor de Supabase o con psql.
-- ─────────────────────────────────────────────────────────────────

-- Dispositivos autorizados
create table if not exists mte_devices (
  imei text primary key,
  device_type text not null default 'UNKNOWN', -- FMC150 | FMC650 | ...
  vehicle_id text,                             -- referencia al vehículo en Mobilink Fleet
  authorized boolean not null default false,
  label text,
  last_seen_at timestamptz,
  last_ip text,
  created_at timestamptz not null default now()
);

-- Histórico de posiciones (particionable por rango de ts cuando crezca)
create table if not exists mte_positions (
  id bigint generated always as identity primary key,
  imei text not null references mte_devices(imei),
  vehicle_id text,
  device_type text,
  ts timestamptz not null,
  priority smallint,
  event_io_id integer not null default 0,
  latitude double precision not null,
  longitude double precision not null,
  altitude double precision,
  speed double precision not null default 0,
  heading double precision not null default 0,
  satellites smallint,
  gps_valid boolean not null default true,
  ignition boolean,
  movement boolean,
  rpm integer,
  engine_hours double precision,
  engine_temperature double precision,
  odometer double precision,
  odometer_source text,
  fuel_level double precision,
  fuel_consumed double precision,
  external_voltage double precision,
  io jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (imei, ts, event_io_id)               -- protección contra duplicados
);

create index if not exists idx_mte_positions_imei_ts on mte_positions (imei, ts desc);
create index if not exists idx_mte_positions_vehicle_ts on mte_positions (vehicle_id, ts desc);

-- Posición actual (una fila por dispositivo)
create table if not exists mte_current_positions (
  imei text primary key references mte_devices(imei),
  vehicle_id text,
  device_type text,
  ts timestamptz not null,
  priority smallint,
  event_io_id integer,
  latitude double precision not null,
  longitude double precision not null,
  altitude double precision,
  speed double precision,
  heading double precision,
  satellites smallint,
  gps_valid boolean,
  ignition boolean,
  movement boolean,
  rpm integer,
  engine_hours double precision,
  engine_temperature double precision,
  odometer double precision,
  odometer_source text,
  fuel_level double precision,
  fuel_consumed double precision,
  external_voltage double precision,
  io jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Eventos de dominio (ignición, geocercas, llegadas, alertas...)
create table if not exists mte_events (
  id bigint generated always as identity primary key,
  imei text not null,
  vehicle_id text,
  type text not null,
  ts timestamptz not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_mte_events_imei_ts on mte_events (imei, ts desc);
create index if not exists idx_mte_events_type_ts on mte_events (type, ts desc);

-- Geocercas circulares (kind enlaza con asistencias, clientes y taller)
create table if not exists mte_geofences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'generic',        -- generic | assistance | customer | workshop
  latitude double precision not null,
  longitude double precision not null,
  radius_m double precision not null default 150,
  active boolean not null default true,
  external_ref text,                           -- id de la asistencia/cliente/OTF en otros módulos
  created_at timestamptz not null default now()
);

-- Viajes calculados (ignición ON -> OFF)
create table if not exists mte_trips (
  id bigint generated always as identity primary key,
  imei text not null,
  vehicle_id text,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  start_latitude double precision,
  start_longitude double precision,
  end_latitude double precision,
  end_longitude double precision,
  distance_m double precision not null default 0,
  duration_s integer not null default 0,
  max_speed double precision,
  created_at timestamptz not null default now()
);

create index if not exists idx_mte_trips_imei on mte_trips (imei, started_at desc);

-- Ejemplo de alta de dispositivo:
-- insert into mte_devices (imei, device_type, vehicle_id, authorized, label)
-- values ('356307042441013', 'FMC650', 'veh-001', true, 'Camión taller 1');
