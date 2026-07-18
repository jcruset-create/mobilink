-- ============================================================
-- SEA TyreControl — Catálogo configurable de motivos por los que
-- una incidencia queda "pendiente".
--
-- Antes estaban fijos en la APK (kMotivosPendiente) y en el CHECK de
-- tc_incidencias.motivo_pendiente. Ahora se editan desde el panel de
-- administración (misma pantalla que los tipos de incidencia).
-- ============================================================

create table if not exists tc_cat_motivos_pendiente (
  id          uuid primary key default gen_random_uuid(),
  clave       text not null unique,   -- slug estable (lo que se guarda en tc_incidencias.motivo_pendiente)
  etiqueta    text not null,          -- texto visible
  orden       integer not null default 0,
  activo      boolean not null default true,
  es_sistema  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_tc_cat_motivos_pendiente_activo on tc_cat_motivos_pendiente (activo, orden);

create or replace function tc_cat_motivos_pendiente_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_tc_cat_motivos_pendiente_touch on tc_cat_motivos_pendiente;
create trigger trg_tc_cat_motivos_pendiente_touch before update on tc_cat_motivos_pendiente
  for each row execute function tc_cat_motivos_pendiente_touch();

-- ── Semilla: los motivos que ya existían en el código ────────
insert into tc_cat_motivos_pendiente (clave, etiqueta, orden, es_sistema) values
  ('falta_autorizacion',     'Falta autorización del cliente',      10, true),
  ('falta_neumatico',        'Falta neumático',                     20, true),
  ('falta_material',         'Falta material',                      30, true),
  ('no_hay_tiempo',          'No hay tiempo',                       40, true),
  ('vehiculo_debe_salir',    'El vehículo debe salir',              50, true),
  ('requiere_taller',        'Reparación requiere taller',          60, true),
  ('pendiente_presupuesto',  'Pendiente de presupuesto',            70, true),
  ('pendiente_unidad_movil', 'Pendiente de unidad móvil',           80, true),
  ('no_accesible',           'No se puede acceder correctamente',   90, true),
  ('otro',                   'Otro motivo',                        100, true)
on conflict (clave) do nothing;

-- ── Liberar el CHECK fijo de tc_incidencias.motivo_pendiente ──
alter table tc_incidencias drop constraint if exists tc_incidencias_motivo_pendiente_check;

-- ── RLS: lectura para autenticados, escritura admin/super-admin ─
alter table tc_cat_motivos_pendiente enable row level security;

drop policy if exists tc_cat_motivos_pendiente_select on tc_cat_motivos_pendiente;
create policy tc_cat_motivos_pendiente_select on tc_cat_motivos_pendiente for select
  using ( auth.uid() is not null );

drop policy if exists tc_cat_motivos_pendiente_write on tc_cat_motivos_pendiente;
create policy tc_cat_motivos_pendiente_write on tc_cat_motivos_pendiente for all
  using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );
