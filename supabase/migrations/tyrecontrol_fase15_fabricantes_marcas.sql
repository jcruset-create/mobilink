-- ============================================================
-- SEA TyreControl — Fase 15: catálogo maestro de fabricantes y
-- marcas de neumático. tc_cat_marcas_neumatico (Fase 9/13) pasa
-- a ser el nivel "Brands"; se añade tc_cat_fabricantes como
-- nivel "Manufacturers" por encima.
-- ============================================================

-- ── 1. Fabricantes ─────────────────────────────────────────────
create table if not exists tc_cat_fabricantes (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null unique,
  pais_origen      text,
  anio_fundacion   int,
  web              text,
  logo_url         text,
  descripcion      text,
  grupo_empresarial text,
  activo           boolean not null default true,
  observaciones    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table tc_cat_fabricantes enable row level security;
drop policy if exists tc_cat_fabricantes_select on tc_cat_fabricantes;
create policy tc_cat_fabricantes_select on tc_cat_fabricantes for select using ( auth.uid() is not null );
drop policy if exists tc_cat_fabricantes_write on tc_cat_fabricantes;
create policy tc_cat_fabricantes_write on tc_cat_fabricantes for all
  using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );

-- ── 2. tc_cat_marcas_neumatico pasa a ser "Brands" ─────────────
alter table tc_cat_marcas_neumatico
  add column if not exists fabricante_id  uuid references tc_cat_fabricantes(id) on delete set null,
  add column if not exists pais_origen    text,
  add column if not exists segmento       text,
  add column if not exists tipo_principal text,
  add column if not exists observaciones  text;

alter table tc_cat_marcas_neumatico drop constraint if exists chk_marca_segmento;
alter table tc_cat_marcas_neumatico add constraint chk_marca_segmento
  check (segmento is null or segmento in (
    'premium','quality','budget','industrial','otr','agricola','carretillas_elevadoras'
  ));

alter table tc_cat_marcas_neumatico drop constraint if exists chk_marca_tipo_principal;
alter table tc_cat_marcas_neumatico add constraint chk_marca_tipo_principal
  check (tipo_principal is null or tipo_principal in (
    'camion','autobus','turismo','furgoneta','agricola','otr','industrial',
    'carretillas_elevadoras','multisegmento'
  ));

-- ── 3. Normalización de marcas ya usadas en almacén/neumáticos ─
-- Solo homogeneiza mayúsculas/espacios de valores YA existentes que
-- coinciden con el catálogo salvo formato (ej. "MICHELIN " -> "Michelin").
-- No toca marcas sin equivalente claro en el catálogo.
update tc_neumaticos n set marca = c.nombre
  from tc_cat_marcas_neumatico c
  where lower(trim(n.marca)) = lower(c.nombre) and n.marca <> c.nombre;

update productos_neumaticos p set marca = c.nombre
  from tc_cat_marcas_neumatico c
  where lower(trim(p.marca)) = lower(c.nombre) and p.marca <> c.nombre;

-- ── 4. Precarga de fabricantes ──────────────────────────────────
insert into tc_cat_fabricantes (nombre) values
  ('Michelin'),('Bridgestone'),('Goodyear'),('Continental'),('Pirelli'),
  ('Hankook'),('Yokohama'),('Apollo'),('Linglong'),('Zhongce Rubber'),
  ('Sailun Group'),('Sumitomo Rubber Industries'),('BKT'),('CEAT'),('JK Tyre')
on conflict (nombre) do nothing;

-- ── 5. Precarga de marcas por segmento (idempotente vía tabla ya
-- existente tc_cat_marcas_neumatico, unique(nombre)) ────────────
insert into tc_cat_marcas_neumatico (nombre, segmento) values
  ('Michelin','premium'),('Bridgestone','premium'),('Goodyear','premium'),('Continental','premium'),
  ('Pirelli','premium'),('Hankook','premium'),('Yokohama','premium'),('Toyo Tires','premium'),
  ('Sumitomo','premium'),('Dunlop','premium'),
  ('Firestone','quality'),('BFGoodrich','quality'),('Uniroyal','quality'),('Semperit','quality'),
  ('Fulda','quality'),('Sava','quality'),('Kelly','quality'),('Apollo','quality'),
  ('Vredestein','quality'),('Nokian Tyres','quality'),('Kumho','quality'),('Falken','quality'),
  ('General Tire','quality'),('Giti','quality'),('Sailun','quality'),('Double Coin','quality'),
  ('Linglong','quality'),('Triangle','quality'),('Aeolus','quality'),('CEAT','quality'),
  ('JK Tyre','quality'),('Hercules','quality'),('Otani','quality'),('Marshal','quality'),
  ('Matador','quality'),('Barum','quality'),
  ('Westlake','budget'),('Goodride','budget'),('RoadX','budget'),('Longmarch','budget'),
  ('Windpower','budget'),('Boto','budget'),('Advance','budget'),('Kapsen','budget'),
  ('Annaite','budget'),('Hifly','budget'),('Fortune','budget'),('Sunfull','budget'),
  ('Leao','budget'),('Lanvigator','budget'),('Delinte','budget'),('Doublestar','budget'),
  ('Evergreen','budget'),('Blacklion','budget'),('Ovation','budget'),('Torque','budget'),
  ('Infinity','budget'),('Riken','budget'),('Kormoran','budget'),('Taurus','budget'),
  ('Tigar','budget'),('Deestone','budget'),('Samson','budget'),
  ('BKT','industrial'),('Alliance','industrial'),('Mitas','industrial'),
  ('Techking','industrial'),('Armour','industrial')
on conflict (nombre) do update set segmento = excluded.segmento where tc_cat_marcas_neumatico.segmento is null;

-- ── 6. Relación fabricante <-> marca ────────────────────────────
update tc_cat_marcas_neumatico m set fabricante_id = f.id
  from tc_cat_fabricantes f where f.nombre = 'Michelin'
  and m.nombre in ('Michelin','BFGoodrich','Kleber','Riken','Kormoran','Taurus','Tigar');

update tc_cat_marcas_neumatico m set fabricante_id = f.id
  from tc_cat_fabricantes f where f.nombre = 'Bridgestone'
  and m.nombre in ('Bridgestone','Firestone');

update tc_cat_marcas_neumatico m set fabricante_id = f.id
  from tc_cat_fabricantes f where f.nombre = 'Goodyear'
  and m.nombre in ('Goodyear','Dunlop','Fulda','Sava','Kelly');

update tc_cat_marcas_neumatico m set fabricante_id = f.id
  from tc_cat_fabricantes f where f.nombre = 'Continental'
  and m.nombre in ('Continental','Semperit','Uniroyal','Barum','General Tire','Matador');

update tc_cat_marcas_neumatico m set fabricante_id = f.id
  from tc_cat_fabricantes f where f.nombre = 'Apollo'
  and m.nombre in ('Apollo','Vredestein');

update tc_cat_marcas_neumatico m set fabricante_id = f.id
  from tc_cat_fabricantes f where f.nombre = 'Yokohama'
  and m.nombre in ('Yokohama','Alliance');

update tc_cat_marcas_neumatico m set fabricante_id = f.id
  from tc_cat_fabricantes f where f.nombre = 'Sumitomo Rubber Industries'
  and m.nombre in ('Sumitomo','Falken');

update tc_cat_marcas_neumatico m set fabricante_id = f.id
  from tc_cat_fabricantes f where f.nombre = 'Linglong'
  and m.nombre in ('Linglong','Leao');

update tc_cat_marcas_neumatico m set fabricante_id = f.id
  from tc_cat_fabricantes f where f.nombre = 'Sailun Group'
  and m.nombre in ('Sailun','RoadX');

update tc_cat_marcas_neumatico m set fabricante_id = f.id
  from tc_cat_fabricantes f where f.nombre = 'Zhongce Rubber'
  and m.nombre in ('Westlake','Goodride');

update tc_cat_marcas_neumatico m set fabricante_id = f.id
  from tc_cat_fabricantes f where f.nombre = 'Hankook' and m.nombre = 'Hankook';

update tc_cat_marcas_neumatico m set fabricante_id = f.id
  from tc_cat_fabricantes f where f.nombre = 'Pirelli' and m.nombre = 'Pirelli';

-- ── 7. Contadores de uso (por texto, no FK — ver notas Fase 9/12) ─
-- Vistas de apoyo para el panel de administración.
create or replace view tc_marcas_contadores as
select
  m.id,
  (select count(*) from tc_cat_modelos_neumatico mo where mo.marca_id = m.id and mo.activo) as num_modelos,
  (select count(*) from tc_neumaticos n where n.marca = m.nombre) as num_neumaticos,
  (select count(distinct n.vehiculo_id) from tc_neumaticos n where n.marca = m.nombre and n.vehiculo_id is not null) as num_vehiculos
from tc_cat_marcas_neumatico m;

grant select on tc_marcas_contadores to authenticated;
