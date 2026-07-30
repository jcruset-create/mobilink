-- ============================================================
-- SEA TyreControl - Imagen de chasis por CONFIGURACION + MARCA.
--
-- Un 2x4 de MAN no se dibuja igual que un 2x4 de Volvo, asi que cada
-- configuracion puede tener una imagen por marca. Si esa marca no tiene
-- imagen propia se usa la generica de la configuracion, y si tampoco, la
-- del tipo de vehiculo (comportamiento anterior).
-- ============================================================

create table if not exists tc_config_ejes_marca (
  id                uuid primary key default gen_random_uuid(),
  config_ejes_id    uuid not null references tc_config_ejes(id) on delete cascade,
  marca_id          uuid not null references tc_cat_marcas_vehiculo(id) on delete cascade,
  imagen_chasis_url text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (config_ejes_id, marca_id)
);

create index if not exists idx_config_ejes_marca_config on tc_config_ejes_marca (config_ejes_id);

alter table tc_config_ejes_marca enable row level security;

-- Mismo criterio que tc_config_ejes: lee cualquier usuario autenticado,
-- escribe admin o super-admin.
drop policy if exists config_ejes_marca_select on tc_config_ejes_marca;
create policy config_ejes_marca_select on tc_config_ejes_marca
  for select to authenticated using (auth.uid() is not null);

drop policy if exists config_ejes_marca_write on tc_config_ejes_marca;
create policy config_ejes_marca_write on tc_config_ejes_marca
  for all to authenticated
  using (tc_is_superadmin() or tc_is_admin())
  with check (tc_is_superadmin() or tc_is_admin());
