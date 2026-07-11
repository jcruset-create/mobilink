-- ============================================================
-- SEA TyreControl — Configuración Webfleet POR EMPRESA (cliente)
-- Cada cliente tiene su propia cuenta/API de Webfleet. Aquí se guardan
-- sus credenciales; el backend (service role) las lee para sincronizar km
-- y posición de los vehículos de esa empresa (enlazados por webfleet_vehicle_id).
-- Credenciales sensibles: solo admin/super-admin (no clientes).
-- ============================================================

create table if not exists public.tc_webfleet_config (
  empresa_id uuid primary key references tc_empresas(id) on delete cascade,
  account    text,
  username   text,
  password   text,
  apikey     text,
  base_url   text not null default 'https://csv.webfleet.com/extern',
  activo     boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.tc_webfleet_config enable row level security;

drop policy if exists tc_webfleet_config_all on public.tc_webfleet_config;
create policy tc_webfleet_config_all on public.tc_webfleet_config
  for all using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );
