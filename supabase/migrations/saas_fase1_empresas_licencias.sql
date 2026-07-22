-- ============================================================
-- SaaS — Fase 1: multiempresa (tenancy) + licencias + auditoría
--
--   · app_empresas: tabla de tenants. Cada empresa cliente de
--     Mobilink es una fila. SEA Tarragona se crea como tenant 1.
--   · app_centros: centros de trabajo de cada empresa.
--   · app_usuarios.empresa_id: todo usuario pertenece a UNA empresa.
--   · app_licencias: módulos contratados por empresa, con vigencia
--     y límites. El hub y el backend deciden visibilidad/acceso
--     cruzando app_usuario_modulos (permiso de usuario) con
--     app_licencias (contratación de la empresa).
--   · app_auditoria: registro de acciones relevantes.
--   · Helpers: app_empresa_actual(), app_licencia_activa().
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

-- ── 1) Empresas (tenants) ────────────────────────────────────
create table if not exists app_empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  slug        text not null,
  cif         text,
  estado      text not null default 'activa'
              check (estado in ('activa','suspendida','prueba')),
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists idx_app_empresas_slug on app_empresas (lower(slug));

-- Tenant 1: SEA Tarragona (uuid fijo para poder referenciarlo
-- desde backfills y desde el seed de licencias).
insert into app_empresas (id, nombre, slug, estado)
values ('00000000-0000-4000-a000-000000000001', 'SEA Tarragona', 'sea-tarragona', 'activa')
on conflict (id) do nothing;

-- ── 2) Centros de trabajo ────────────────────────────────────
create table if not exists app_centros (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references app_empresas(id) on delete cascade,
  nombre      text not null,
  direccion   text,
  timezone    text not null default 'Europe/Madrid',
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_app_centros_empresa on app_centros (empresa_id);

insert into app_centros (empresa_id, nombre)
select '00000000-0000-4000-a000-000000000001', 'Taller Tarragona'
where not exists (
  select 1 from app_centros
  where empresa_id = '00000000-0000-4000-a000-000000000001'
);

-- ── 3) Usuarios → empresa ────────────────────────────────────
alter table app_usuarios
  add column if not exists empresa_id uuid references app_empresas(id);

update app_usuarios
set empresa_id = '00000000-0000-4000-a000-000000000001'
where empresa_id is null;

alter table app_usuarios alter column empresa_id set not null;
create index if not exists idx_app_usuarios_empresa on app_usuarios (empresa_id);

-- Centro opcional del usuario (para Responsable Centro / Empleado)
alter table app_usuario_modulos
  add column if not exists centro_id uuid references app_centros(id);

-- ── 4) Licencias por empresa y módulo ────────────────────────
create table if not exists app_licencias (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references app_empresas(id) on delete cascade,
  modulo            text not null
                    check (modulo in ('administracion','tyrecontrol','almacen','sea-core','toolcontrol','safety','presencia')),
  fecha_inicio      date not null default current_date,
  fecha_fin         date,               -- null = sin caducidad
  estado            text not null default 'activa'
                    check (estado in ('activa','caducada','suspendida','cancelada')),
  max_usuarios      integer,
  max_dispositivos  integer,
  notas             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (empresa_id, modulo, fecha_inicio)
);
create index if not exists idx_app_licencias_empresa on app_licencias (empresa_id, modulo);

-- Seed: SEA tiene licencia sin caducidad de todos los módulos actuales.
insert into app_licencias (empresa_id, modulo)
select '00000000-0000-4000-a000-000000000001', m
from unnest(array['administracion','tyrecontrol','almacen','sea-core','toolcontrol','safety','presencia']) as m
where not exists (
  select 1 from app_licencias
  where empresa_id = '00000000-0000-4000-a000-000000000001' and modulo = m
);

-- ── 5) Auditoría ─────────────────────────────────────────────
create table if not exists app_auditoria (
  id          bigint generated always as identity primary key,
  empresa_id  uuid not null references app_empresas(id),
  user_id     uuid references app_usuarios(id) on delete set null,
  accion      text not null,            -- p.ej. 'auth.login', 'licencia.caducada'
  entidad     text,
  entidad_id  text,
  detalle     jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);
create index if not exists idx_app_auditoria_empresa_fecha on app_auditoria (empresa_id, created_at desc);

-- ── 6) Helpers ───────────────────────────────────────────────

-- Empresa del usuario autenticado.
create or replace function app_empresa_actual()
returns uuid language sql stable security definer set search_path = public as $$
  select empresa_id from app_usuarios where id = auth.uid() and activo
$$;

-- ¿La empresa tiene licencia vigente del módulo?
-- (estado activa Y no vencida por fecha; la fecha manda aunque el
--  worker aún no haya marcado la fila como caducada)
create or replace function app_licencia_activa(p_empresa uuid, p_modulo text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_licencias
    where empresa_id = p_empresa
      and modulo = p_modulo
      and estado = 'activa'
      and fecha_inicio <= current_date
      and (fecha_fin is null or fecha_fin >= current_date)
  )
$$;

-- Módulos con licencia vigente del usuario autenticado (para el hub:
-- intersección entre lo que la empresa contrata y lo que el usuario
-- tiene permitido en app_usuario_modulos).
create or replace function app_mis_modulos()
returns table (modulo text, rol text, pantallas text[]) language sql stable security definer
set search_path = public as $$
  select m.modulo, m.rol, m.pantallas
  from app_usuario_modulos m
  join app_usuarios u on u.id = m.user_id and u.activo
  where m.user_id = auth.uid()
    and app_licencia_activa(u.empresa_id, m.modulo)
$$;
grant execute on function app_mis_modulos() to authenticated;

-- ── 7) RLS ───────────────────────────────────────────────────
alter table app_empresas  enable row level security;
alter table app_centros   enable row level security;
alter table app_licencias enable row level security;
alter table app_auditoria enable row level security;

-- Lectura: cada usuario ve solo su empresa; superadmin ve todas.
drop policy if exists sel_app_empresas on app_empresas;
create policy sel_app_empresas on app_empresas for select
  using (id = app_empresa_actual() or app_es_admin());

drop policy if exists sel_app_centros on app_centros;
create policy sel_app_centros on app_centros for select
  using (empresa_id = app_empresa_actual() or app_es_admin());

drop policy if exists sel_app_licencias on app_licencias;
create policy sel_app_licencias on app_licencias for select
  using (empresa_id = app_empresa_actual() or app_es_admin());

drop policy if exists sel_app_auditoria on app_auditoria;
create policy sel_app_auditoria on app_auditoria for select
  using (empresa_id = app_empresa_actual() or app_es_admin());

-- Escritura de empresas/licencias: solo superadmin (gestión Mobilink).
drop policy if exists mod_app_empresas on app_empresas;
create policy mod_app_empresas on app_empresas for all
  using (app_es_admin()) with check (app_es_admin());

drop policy if exists mod_app_licencias on app_licencias;
create policy mod_app_licencias on app_licencias for all
  using (app_es_admin()) with check (app_es_admin());

drop policy if exists mod_app_centros on app_centros;
create policy mod_app_centros on app_centros for all
  using (app_es_admin()) with check (app_es_admin());

-- Auditoría: insertable por cualquier usuario autenticado de su empresa.
drop policy if exists ins_app_auditoria on app_auditoria;
create policy ins_app_auditoria on app_auditoria for insert
  with check (empresa_id = app_empresa_actual() or app_es_admin());
