-- ============================================================
-- SEA TyreControl — Fase 9b: catálogos de índice de carga y
-- código/índice de velocidad (mismo patrón que marca/modelo/medida).
-- ============================================================

create table if not exists tc_cat_indices_carga (
  id         uuid primary key default gen_random_uuid(),
  valor      text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (valor)
);

create table if not exists tc_cat_indices_velocidad (
  id         uuid primary key default gen_random_uuid(),
  valor      text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (valor)
);

-- Backfill desde valores ya usados en tc_neumaticos
insert into tc_cat_indices_carga (valor)
  select distinct trim(indice_carga) from tc_neumaticos where indice_carga is not null and trim(indice_carga) <> ''
  on conflict (valor) do nothing;

insert into tc_cat_indices_velocidad (valor)
  select distinct trim(indice_velocidad) from tc_neumaticos where indice_velocidad is not null and trim(indice_velocidad) <> ''
  on conflict (valor) do nothing;

-- Semilla de códigos de velocidad estándar habituales en neumático de camión/tráiler
insert into tc_cat_indices_velocidad (valor) values ('F'),('G'),('J'),('K'),('L'),('M'),('N')
  on conflict (valor) do nothing;

-- ── RLS: lectura para autenticados, escritura solo super-admin ─
alter table tc_cat_indices_carga     enable row level security;
alter table tc_cat_indices_velocidad enable row level security;

drop policy if exists tc_cat_ic_select on tc_cat_indices_carga;
create policy tc_cat_ic_select on tc_cat_indices_carga for select using ( auth.uid() is not null );
drop policy if exists tc_cat_ic_write on tc_cat_indices_carga;
create policy tc_cat_ic_write on tc_cat_indices_carga for all
  using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );

drop policy if exists tc_cat_iv_select on tc_cat_indices_velocidad;
create policy tc_cat_iv_select on tc_cat_indices_velocidad for select using ( auth.uid() is not null );
drop policy if exists tc_cat_iv_write on tc_cat_indices_velocidad;
create policy tc_cat_iv_write on tc_cat_indices_velocidad for all
  using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );
