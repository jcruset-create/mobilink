-- ============================================================
-- SEA TyreControl — Fase 2: empresas (ampliada), delegaciones,
-- usuarios por empresa/delegación, asignación operador↔empresa, RLS.
-- Requiere haber ejecutado Fase 1. Pegar en Supabase (SQL Editor).
-- ============================================================

-- ── EMPRESAS: campos nuevos ──────────────────────────────────
alter table tc_empresas
  add column if not exists direccion     text,
  add column if not exists ciudad        text,
  add column if not exists provincia     text,
  add column if not exists codigo_postal text,
  add column if not exists pais          text,
  add column if not exists updated_at    timestamptz not null default now();

-- ── DELEGACIONES / BASES ─────────────────────────────────────
create table if not exists tc_delegaciones (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references tc_empresas(id) on delete cascade,
  nombre        text not null,
  direccion     text,
  ciudad        text,
  provincia     text,
  codigo_postal text,
  pais          text,
  responsable   text,
  telefono      text,
  email         text,
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_tc_delegaciones_empresa on tc_delegaciones (empresa_id);

-- ── USUARIOS: delegación + updated_at ────────────────────────
alter table tc_usuarios
  add column if not exists delegacion_id uuid references tc_delegaciones(id) on delete set null,
  add column if not exists updated_at    timestamptz not null default now();

-- ── OPERADOR ↔ EMPRESAS (asignación) ─────────────────────────
create table if not exists tc_operador_empresas (
  usuario_id uuid not null references tc_usuarios(id) on delete cascade,
  empresa_id uuid not null references tc_empresas(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (usuario_id, empresa_id)
);

-- ── Helpers ──────────────────────────────────────────────────
-- ¿El operador conectado tiene asignada esta empresa?
create or replace function tc_operador_ve_empresa(emp uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tc_operador_empresas
                 where usuario_id = auth.uid() and empresa_id = emp)
$$;

-- ¿El usuario conectado puede VER esta empresa? (super-admin / su empresa / operador asignado)
create or replace function tc_puede_ver_empresa(emp uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select tc_is_superadmin()
      or emp = tc_auth_empresa_id()
      or tc_operador_ve_empresa(emp)
$$;

-- ── RLS: EMPRESAS ────────────────────────────────────────────
drop policy if exists tc_empresas_select on tc_empresas;
create policy tc_empresas_select on tc_empresas for select
  using ( tc_puede_ver_empresa(id) );

drop policy if exists tc_empresas_write on tc_empresas;
create policy tc_empresas_write on tc_empresas for all
  using      ( tc_is_superadmin() or (tc_is_admin() and id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and id = tc_auth_empresa_id()) );
-- (No hay política de DELETE aparte → borrado físico bloqueado. Se usa activo=false.)

-- ── RLS: DELEGACIONES ────────────────────────────────────────
alter table tc_delegaciones enable row level security;

drop policy if exists tc_delegaciones_select on tc_delegaciones;
create policy tc_delegaciones_select on tc_delegaciones for select
  using ( tc_puede_ver_empresa(empresa_id) );

drop policy if exists tc_delegaciones_write on tc_delegaciones;
create policy tc_delegaciones_write on tc_delegaciones for all
  using      ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );

-- ── RLS: OPERADOR_EMPRESAS ───────────────────────────────────
alter table tc_operador_empresas enable row level security;

drop policy if exists tc_operador_empresas_select on tc_operador_empresas;
create policy tc_operador_empresas_select on tc_operador_empresas for select
  using ( tc_is_superadmin() or usuario_id = auth.uid()
          or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );

drop policy if exists tc_operador_empresas_write on tc_operador_empresas;
create policy tc_operador_empresas_write on tc_operador_empresas for all
  using      ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );

-- ── RLS: USUARIOS (ver también a operadores asignados) ───────
-- (se mantiene la política de Fase 1; el select ya cubre su empresa / super-admin)
