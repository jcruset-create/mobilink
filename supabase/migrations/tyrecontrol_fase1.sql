-- ============================================================
-- SEA TyreControl — Fase 1: empresas, usuarios, permisos_cliente
-- Multiempresa + super-admin global + RLS
-- Pegar en Supabase (SQL Editor). Idempotente donde es posible.
-- ============================================================

-- ── ENUM de roles ────────────────────────────────────────────
do $$ begin
  create type rol_usuario as enum ('administrador','operador','cliente');
exception when duplicate_object then null; end $$;

-- ── EMPRESAS (tenant) ────────────────────────────────────────
create table if not exists empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  cif         text unique,
  telefono    text,
  email       text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ── USUARIOS (perfil ligado a auth.users) ────────────────────
create table if not exists usuarios (
  id            uuid primary key references auth.users(id) on delete cascade,
  empresa_id    uuid not null references empresas(id) on delete restrict,
  nombre        text not null,
  email         text not null,
  rol           rol_usuario not null default 'cliente',
  activo        boolean not null default true,
  acceso_apk    boolean not null default false,
  acceso_panel  boolean not null default true,
  es_superadmin boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists idx_usuarios_empresa on usuarios (empresa_id);

-- ── PERMISOS DE CLIENTE (granular) ───────────────────────────
create table if not exists permisos_cliente (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references usuarios(id) on delete cascade,
  pantalla       text not null,
  puede_ver      boolean not null default false,
  puede_exportar boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (usuario_id, pantalla)
);
create index if not exists idx_permisos_usuario on permisos_cliente (usuario_id);

-- ── Funciones helper (SECURITY DEFINER: no disparan RLS) ─────
create or replace function auth_empresa_id()
returns uuid language sql stable security definer set search_path = public as $$
  select empresa_id from usuarios where id = auth.uid()
$$;

create or replace function auth_rol()
returns rol_usuario language sql stable security definer set search_path = public as $$
  select rol from usuarios where id = auth.uid()
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'administrador' from usuarios where id = auth.uid()), false)
$$;

create or replace function is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select es_superadmin from usuarios where id = auth.uid()), false)
$$;

-- ── RLS ──────────────────────────────────────────────────────
alter table empresas          enable row level security;
alter table usuarios          enable row level security;
alter table permisos_cliente  enable row level security;

-- EMPRESAS
drop policy if exists empresas_select on empresas;
create policy empresas_select on empresas for select
  using ( is_superadmin() or id = auth_empresa_id() );

drop policy if exists empresas_write on empresas;
create policy empresas_write on empresas for all
  using      ( is_superadmin() or (is_admin() and id = auth_empresa_id()) )
  with check ( is_superadmin() or (is_admin() and id = auth_empresa_id()) );

-- USUARIOS
drop policy if exists usuarios_select on usuarios;
create policy usuarios_select on usuarios for select
  using ( is_superadmin() or empresa_id = auth_empresa_id() );

drop policy if exists usuarios_write on usuarios;
create policy usuarios_write on usuarios for all
  using      ( is_superadmin() or (is_admin() and empresa_id = auth_empresa_id()) )
  with check ( is_superadmin() or (is_admin() and empresa_id = auth_empresa_id()) );

-- PERMISOS_CLIENTE
drop policy if exists permisos_admin_all on permisos_cliente;
create policy permisos_admin_all on permisos_cliente for all
  using ( is_superadmin() or (is_admin() and exists (
    select 1 from usuarios u where u.id = permisos_cliente.usuario_id and u.empresa_id = auth_empresa_id())) )
  with check ( is_superadmin() or (is_admin() and exists (
    select 1 from usuarios u where u.id = permisos_cliente.usuario_id and u.empresa_id = auth_empresa_id())) );

drop policy if exists permisos_self_select on permisos_cliente;
create policy permisos_self_select on permisos_cliente for select
  using ( usuario_id = auth.uid() );

-- ============================================================
-- SEMILLA INICIAL (ejecutar UNA vez, ajustando valores)
-- 1) Crea la empresa SEA y 2) marca a tu usuario como super-admin.
--    Sustituye el email por el tuyo (debe existir ya en auth.users;
--    créalo desde Authentication → Users si hace falta).
-- ============================================================
-- insert into empresas (nombre, cif) values ('SEA Tarragona', 'B00000000')
--   on conflict (cif) do nothing;
--
-- insert into usuarios (id, empresa_id, nombre, email, rol, es_superadmin, acceso_panel)
-- select u.id, (select id from empresas where nombre='SEA Tarragona'),
--        'Administrador SEA', u.email, 'administrador', true, true
-- from auth.users u where u.email = 'jcruset@gmail.com'
-- on conflict (id) do update set es_superadmin = true, rol = 'administrador';
