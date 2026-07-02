-- ============================================================
-- SEA TyreControl — Fase 9: catálogos de Marca / Modelo / Medida
-- de neumático (antes eran texto libre). Los valores de
-- tc_neumaticos.marca/modelo/medida siguen siendo texto (no se
-- convierten en FK, para no romper nada existente) — estos
-- catálogos solo alimentan los desplegables del formulario.
-- ============================================================

create table if not exists tc_cat_marcas_neumatico (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (nombre)
);

create table if not exists tc_cat_modelos_neumatico (
  id         uuid primary key default gen_random_uuid(),
  marca_id   uuid references tc_cat_marcas_neumatico(id) on delete cascade,
  nombre     text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (marca_id, nombre)
);
create index if not exists idx_tc_cat_modelos_marca on tc_cat_modelos_neumatico (marca_id);

create table if not exists tc_cat_medidas_neumatico (
  id         uuid primary key default gen_random_uuid(),
  valor      text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (valor)
);

-- Backfill: incorpora los valores ya usados en tc_neumaticos para no perder histórico
insert into tc_cat_marcas_neumatico (nombre)
  select distinct trim(marca) from tc_neumaticos where marca is not null and trim(marca) <> ''
  on conflict (nombre) do nothing;

insert into tc_cat_medidas_neumatico (valor)
  select distinct trim(medida) from tc_neumaticos where medida is not null and trim(medida) <> ''
  on conflict (valor) do nothing;

insert into tc_cat_modelos_neumatico (marca_id, nombre)
  select distinct m.id, trim(n.modelo)
  from tc_neumaticos n
  join tc_cat_marcas_neumatico m on m.nombre = trim(n.marca)
  where n.modelo is not null and trim(n.modelo) <> ''
  on conflict (marca_id, nombre) do nothing;

-- lo mismo desde productos_neumaticos (catálogo real de almacén)
insert into tc_cat_marcas_neumatico (nombre)
  select distinct trim(marca) from productos_neumaticos where marca is not null and trim(marca) <> ''
  on conflict (nombre) do nothing;
insert into tc_cat_medidas_neumatico (valor)
  select distinct trim(medida) from productos_neumaticos where medida is not null and trim(medida) <> ''
  on conflict (valor) do nothing;

-- ── RLS: lectura para autenticados, escritura solo super-admin ─
alter table tc_cat_marcas_neumatico  enable row level security;
alter table tc_cat_modelos_neumatico enable row level security;
alter table tc_cat_medidas_neumatico enable row level security;

drop policy if exists tc_cat_marcas_select on tc_cat_marcas_neumatico;
create policy tc_cat_marcas_select on tc_cat_marcas_neumatico for select using ( auth.uid() is not null );
drop policy if exists tc_cat_marcas_write on tc_cat_marcas_neumatico;
create policy tc_cat_marcas_write on tc_cat_marcas_neumatico for all
  using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );

drop policy if exists tc_cat_modelos_select on tc_cat_modelos_neumatico;
create policy tc_cat_modelos_select on tc_cat_modelos_neumatico for select using ( auth.uid() is not null );
drop policy if exists tc_cat_modelos_write on tc_cat_modelos_neumatico;
create policy tc_cat_modelos_write on tc_cat_modelos_neumatico for all
  using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );

drop policy if exists tc_cat_medidas_select on tc_cat_medidas_neumatico;
create policy tc_cat_medidas_select on tc_cat_medidas_neumatico for select using ( auth.uid() is not null );
drop policy if exists tc_cat_medidas_write on tc_cat_medidas_neumatico;
create policy tc_cat_medidas_write on tc_cat_medidas_neumatico for all
  using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );
