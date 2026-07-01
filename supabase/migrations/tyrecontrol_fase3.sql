-- ============================================================
-- SEA TyreControl — Fase 3: vehículos, tipos de vehículo y
-- posiciones (esquema de ejes/ruedas). Requiere Fase 1 y 2.
-- ============================================================

-- ── TIPOS DE VEHÍCULO (catálogo global) ──────────────────────
create table if not exists tc_tipos_vehiculo (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null unique,
  descripcion   text,
  numero_ejes   int not null default 2,
  numero_ruedas int not null default 4,
  activo        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ── POSICIONES POR TIPO (esquema de ruedas) ──────────────────
create table if not exists tc_posiciones_vehiculo (
  id                 uuid primary key default gen_random_uuid(),
  tipo_vehiculo_id   uuid not null references tc_tipos_vehiculo(id) on delete cascade,
  codigo_posicion    text not null,
  nombre             text,
  eje                int,
  lado               text,               -- 'izq' | 'der'
  interior_exterior  text,               -- 'int' | 'ext' | null
  orden_visual       int not null default 0,
  activo             boolean not null default true,
  unique (tipo_vehiculo_id, codigo_posicion)
);
create index if not exists idx_tc_posiciones_tipo on tc_posiciones_vehiculo (tipo_vehiculo_id);

-- ── VEHÍCULOS ────────────────────────────────────────────────
create table if not exists tc_vehiculos (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references tc_empresas(id) on delete restrict,
  delegacion_id       uuid references tc_delegaciones(id) on delete set null,
  tipo_vehiculo_id    uuid references tc_tipos_vehiculo(id) on delete set null,
  matricula           text not null,
  marca               text,
  modelo              text,
  bastidor            text,
  fecha_matriculacion date,
  webfleet_vehicle_id text,
  km_actual           numeric not null default 0,
  origen_km           text not null default 'manual',   -- manual | webfleet | importacion_excel
  activo              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- matrícula única por empresa
  unique (empresa_id, matricula)
);
create index if not exists idx_tc_vehiculos_empresa on tc_vehiculos (empresa_id);
create index if not exists idx_tc_vehiculos_matricula on tc_vehiculos (matricula);

-- ── RLS ──────────────────────────────────────────────────────
alter table tc_tipos_vehiculo      enable row level security;
alter table tc_posiciones_vehiculo enable row level security;
alter table tc_vehiculos           enable row level security;

-- Catálogo (tipos/posiciones): lectura para autenticados; escritura super-admin
drop policy if exists tc_tipos_select on tc_tipos_vehiculo;
create policy tc_tipos_select on tc_tipos_vehiculo for select using ( auth.uid() is not null );
drop policy if exists tc_tipos_write on tc_tipos_vehiculo;
create policy tc_tipos_write on tc_tipos_vehiculo for all using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );

drop policy if exists tc_posiciones_select on tc_posiciones_vehiculo;
create policy tc_posiciones_select on tc_posiciones_vehiculo for select using ( auth.uid() is not null );
drop policy if exists tc_posiciones_write on tc_posiciones_vehiculo;
create policy tc_posiciones_write on tc_posiciones_vehiculo for all using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );

-- Vehículos: ver si puedes ver la empresa; escribir super-admin o admin de su empresa
drop policy if exists tc_vehiculos_select on tc_vehiculos;
create policy tc_vehiculos_select on tc_vehiculos for select
  using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_vehiculos_write on tc_vehiculos;
create policy tc_vehiculos_write on tc_vehiculos for all
  using      ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );

-- ── SEMILLA: tipos de vehículo ───────────────────────────────
insert into tc_tipos_vehiculo (nombre, descripcion, numero_ejes, numero_ruedas) values
  ('turismo','Turismo',2,4),
  ('furgoneta','Furgoneta',2,4),
  ('camion_2_ejes','Camión 2 ejes',2,6),
  ('camion_3_ejes','Camión 3 ejes',3,10),
  ('tractora','Cabeza tractora',3,10),
  ('remolque','Remolque',2,8),
  ('semirremolque','Semirremolque',3,12),
  ('autobus','Autobús',2,6),
  ('autocar','Autocar',3,10)
on conflict (nombre) do nothing;

-- ── SEMILLA: posiciones (ejemplos del enunciado) ─────────────
-- turismo y furgoneta: 4 ruedas
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, nombre, eje, lado, interior_exterior, orden_visual)
select t.id, v.codigo, v.nombre, v.eje, v.lado, v.io, v.orden
from tc_tipos_vehiculo t
join (values
  ('DEL_IZQ','Delantera izquierda',1,'izq',null,1),
  ('DEL_DER','Delantera derecha',1,'der',null,2),
  ('TRAS_IZQ','Trasera izquierda',2,'izq',null,3),
  ('TRAS_DER','Trasera derecha',2,'der',null,4)
) as v(codigo,nombre,eje,lado,io,orden) on true
where t.nombre in ('turismo','furgoneta')
on conflict (tipo_vehiculo_id, codigo_posicion) do nothing;

-- camión 2 ejes (eje trasero doble)
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, nombre, eje, lado, interior_exterior, orden_visual)
select t.id, v.codigo, v.nombre, v.eje, v.lado, v.io, v.orden
from tc_tipos_vehiculo t
join (values
  ('E1_IZQ','Eje 1 izquierda',1,'izq',null,1),
  ('E1_DER','Eje 1 derecha',1,'der',null,2),
  ('E2_IZQ_EXT','Eje 2 izq. exterior',2,'izq','ext',3),
  ('E2_IZQ_INT','Eje 2 izq. interior',2,'izq','int',4),
  ('E2_DER_INT','Eje 2 der. interior',2,'der','int',5),
  ('E2_DER_EXT','Eje 2 der. exterior',2,'der','ext',6)
) as v(codigo,nombre,eje,lado,io,orden) on true
where t.nombre = 'camion_2_ejes'
on conflict (tipo_vehiculo_id, codigo_posicion) do nothing;

-- tractora (3 ejes, dobles traseros)
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, nombre, eje, lado, interior_exterior, orden_visual)
select t.id, v.codigo, v.nombre, v.eje, v.lado, v.io, v.orden
from tc_tipos_vehiculo t
join (values
  ('E1_IZQ','Eje 1 izquierda',1,'izq',null,1),
  ('E1_DER','Eje 1 derecha',1,'der',null,2),
  ('E2_IZQ_EXT','Eje 2 izq. exterior',2,'izq','ext',3),
  ('E2_IZQ_INT','Eje 2 izq. interior',2,'izq','int',4),
  ('E2_DER_INT','Eje 2 der. interior',2,'der','int',5),
  ('E2_DER_EXT','Eje 2 der. exterior',2,'der','ext',6),
  ('E3_IZQ_EXT','Eje 3 izq. exterior',3,'izq','ext',7),
  ('E3_IZQ_INT','Eje 3 izq. interior',3,'izq','int',8),
  ('E3_DER_INT','Eje 3 der. interior',3,'der','int',9),
  ('E3_DER_EXT','Eje 3 der. exterior',3,'der','ext',10)
) as v(codigo,nombre,eje,lado,io,orden) on true
where t.nombre = 'tractora'
on conflict (tipo_vehiculo_id, codigo_posicion) do nothing;
