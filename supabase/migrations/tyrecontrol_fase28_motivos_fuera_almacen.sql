-- ============================================================
-- SEA TyreControl — Fase 28: catálogo de motivos para el montaje
-- "fuera de almacén" (antes texto libre). Editable desde
-- Configuración (crear/editar/dar de baja), igual que el resto de
-- catálogos de la app.
-- ============================================================

create table if not exists tc_cat_motivos_fuera_almacen (
  id         uuid primary key default gen_random_uuid(),
  motivo     text not null unique,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table tc_cat_motivos_fuera_almacen enable row level security;
drop policy if exists tc_cat_motivos_fuera_almacen_select on tc_cat_motivos_fuera_almacen;
create policy tc_cat_motivos_fuera_almacen_select on tc_cat_motivos_fuera_almacen for select using ( auth.uid() is not null );
drop policy if exists tc_cat_motivos_fuera_almacen_write on tc_cat_motivos_fuera_almacen;
create policy tc_cat_motivos_fuera_almacen_write on tc_cat_motivos_fuera_almacen for all
  using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );

insert into tc_cat_motivos_fuera_almacen (motivo) values
  ('Neumático ya instalado antes de usar el sistema'),
  ('Montaje urgente en carretera (asistencia)'),
  ('Sustitución de emergencia sin stock en almacén'),
  ('Neumático aportado por el proveedor/taller externo'),
  ('Migración de datos históricos')
on conflict (motivo) do nothing;
