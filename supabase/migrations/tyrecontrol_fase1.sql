-- ============================================================
-- SEA TyreControl — Fase 1 (tablas propias con prefijo tc_)
-- Multiempresa + super-admin global + RLS.
-- Prefijo tc_ para NO colisionar con tablas de otros módulos
-- (sea-core ya tiene 'empresas'/'usuarios').
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

-- ── ENUM de roles ────────────────────────────────────────────
do $$ begin
  create type tc_rol as enum ('administrador','operador','cliente');
exception when duplicate_object then null; end $$;

-- ── EMPRESAS (tenant) ────────────────────────────────────────
create table if not exists tc_empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  cif         text unique,
  telefono    text,
  email       text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── USUARIOS (perfil ligado a auth.users) ────────────────────
create table if not exists tc_usuarios (
  id            uuid primary key references auth.users(id) on delete cascade,
  empresa_id    uuid not null references tc_empresas(id) on delete restrict,
  nombre        text not null,
  email         text not null,
  rol           tc_rol not null default 'cliente',
  activo        boolean not null default true,
  acceso_apk    boolean not null default false,
  acceso_panel  boolean not null default true,
  es_superadmin boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists idx_tc_usuarios_empresa on tc_usuarios (empresa_id);

-- ── PERMISOS DE CLIENTE (granular) ───────────────────────────
create table if not exists tc_permisos_cliente (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references tc_usuarios(id) on delete cascade,
  pantalla       text not null,
  puede_ver      boolean not null default false,
  puede_exportar boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (usuario_id, pantalla)
);
create index if not exists idx_tc_permisos_usuario on tc_permisos_cliente (usuario_id);

-- ── Funciones helper (SECURITY DEFINER: no disparan RLS) ─────
create or replace function tc_auth_empresa_id()
returns uuid language sql stable security definer set search_path = public as $$
  select empresa_id from tc_usuarios where id = auth.uid()
$$;

create or replace function tc_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'administrador' from tc_usuarios where id = auth.uid()), false)
$$;

create or replace function tc_is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select es_superadmin from tc_usuarios where id = auth.uid()), false)
$$;

-- ── RLS ──────────────────────────────────────────────────────
alter table tc_empresas          enable row level security;
alter table tc_usuarios          enable row level security;
alter table tc_permisos_cliente  enable row level security;

-- EMPRESAS
drop policy if exists tc_empresas_select on tc_empresas;
create policy tc_empresas_select on tc_empresas for select
  using ( tc_is_superadmin() or id = tc_auth_empresa_id() );

drop policy if exists tc_empresas_write on tc_empresas;
create policy tc_empresas_write on tc_empresas for all
  using      ( tc_is_superadmin() or (tc_is_admin() and id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and id = tc_auth_empresa_id()) );

-- USUARIOS
drop policy if exists tc_usuarios_select on tc_usuarios;
create policy tc_usuarios_select on tc_usuarios for select
  using ( tc_is_superadmin() or empresa_id = tc_auth_empresa_id() );

drop policy if exists tc_usuarios_write on tc_usuarios;
create policy tc_usuarios_write on tc_usuarios for all
  using      ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );

-- PERMISOS_CLIENTE
drop policy if exists tc_permisos_admin_all on tc_permisos_cliente;
create policy tc_permisos_admin_all on tc_permisos_cliente for all
  using ( tc_is_superadmin() or (tc_is_admin() and exists (
    select 1 from tc_usuarios u where u.id = tc_permisos_cliente.usuario_id and u.empresa_id = tc_auth_empresa_id())) )
  with check ( tc_is_superadmin() or (tc_is_admin() and exists (
    select 1 from tc_usuarios u where u.id = tc_permisos_cliente.usuario_id and u.empresa_id = tc_auth_empresa_id())) );

drop policy if exists tc_permisos_self_select on tc_permisos_cliente;
create policy tc_permisos_self_select on tc_permisos_cliente for select
  using ( usuario_id = auth.uid() );

-- ============================================================
-- SEMILLA (ejecutar UNA vez). Crea empresa SEA y te marca super-admin.
-- Requiere que tu cuenta exista ya en Authentication → Users.
-- ============================================================
-- insert into tc_empresas (nombre, cif) values ('SEA Tarragona', 'B00000000')
--   on conflict (cif) do nothing;
--
-- insert into tc_usuarios (id, empresa_id, nombre, email, rol, es_superadmin, acceso_panel)
-- select u.id, (select id from tc_empresas where nombre='SEA Tarragona'),
--        'Administrador SEA', u.email, 'administrador', true, true
-- from auth.users u where u.email = 'jcruset@gmail.com'
-- on conflict (id) do update set es_superadmin = true, rol = 'administrador', acceso_panel = true;
