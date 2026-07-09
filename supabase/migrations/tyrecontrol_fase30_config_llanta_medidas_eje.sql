-- ============================================================
-- SEA TyreControl — Fase 30: en la ficha del vehículo
--   · Configuración de ejes (catálogo editable: 2x2x2, 2x4…)
--   · Medida de neumático (del maestro tc_cat_medidas_neumatico)
--   · Tipo de llanta (catálogo editable: material + medida)
--   · Medidas/llanta distintas por eje (desglose opcional)
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

-- ── 1. Catálogo de configuraciones de ejes ────────────────────
create table if not exists tc_config_ejes (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,     -- "2x2x2", "2x4", "2x2x4"…
  descripcion text,
  orden       int not null default 0,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into tc_config_ejes (nombre, descripcion, orden) values
  ('2x2',    'Camión rígido 2 ejes',              10),
  ('2x4',    'Camión rígido 2 ejes (tracción gemela)', 20),
  ('2x2x2',  '3 ejes sencillos',                  30),
  ('2x2x4',  '3 ejes, tracción gemela',           40),
  ('2x4x4',  '3 ejes, dos tracciones gemelas',    50),
  ('2x2x2x2','4 ejes sencillos (remolque)',       60)
on conflict (nombre) do nothing;

-- ── 2. Catálogo de tipos de llanta (material + medida) ────────
create table if not exists tc_tipos_llanta (
  id          uuid primary key default gen_random_uuid(),
  material    text not null,            -- 'acero' | 'aluminio' | otros
  medida      text not null,            -- pulgadas, ej "22.5x11.75"
  activo      boolean not null default true,
  orden       int not null default 0,
  created_at  timestamptz not null default now(),
  unique (material, medida)
);

insert into tc_tipos_llanta (material, medida, orden) values
  ('acero',    '22.5x11.75', 10),
  ('acero',    '22.5x9.00',  20),
  ('aluminio', '22.5x11.75', 30),
  ('aluminio', '22.5x9.00',  40),
  ('acero',    '19.5x6.75',  50)
on conflict (material, medida) do nothing;

-- ── 3. Campos en el vehículo (medida/llanta únicas por defecto) ─
alter table tc_vehiculos
  add column if not exists config_ejes_id  uuid references tc_config_ejes(id) on delete set null,
  add column if not exists medida_id       uuid references tc_cat_medidas_neumatico(id) on delete set null,
  add column if not exists tipo_llanta_id  uuid references tc_tipos_llanta(id) on delete set null,
  add column if not exists medidas_por_eje boolean not null default false;

-- ── 4. Desglose por eje (cuando medidas_por_eje = true) ───────
create table if not exists tc_vehiculo_ejes (
  id             uuid primary key default gen_random_uuid(),
  vehiculo_id    uuid not null references tc_vehiculos(id) on delete cascade,
  eje            int not null,
  ruedas         int,                    -- 2 (sencillo) | 4 (gemelo), derivado de la config
  medida_id      uuid references tc_cat_medidas_neumatico(id) on delete set null,
  tipo_llanta_id uuid references tc_tipos_llanta(id) on delete set null,
  unique (vehiculo_id, eje)
);
create index if not exists idx_tc_veh_ejes_vehiculo on tc_vehiculo_ejes (vehiculo_id);

-- ── 5. RLS ────────────────────────────────────────────────────
alter table tc_config_ejes    enable row level security;
alter table tc_tipos_llanta   enable row level security;
alter table tc_vehiculo_ejes  enable row level security;

drop policy if exists tc_config_ejes_select on tc_config_ejes;
create policy tc_config_ejes_select on tc_config_ejes for select using ( auth.uid() is not null );
drop policy if exists tc_config_ejes_write on tc_config_ejes;
create policy tc_config_ejes_write on tc_config_ejes for all
  using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

drop policy if exists tc_tipos_llanta_select on tc_tipos_llanta;
create policy tc_tipos_llanta_select on tc_tipos_llanta for select using ( auth.uid() is not null );
drop policy if exists tc_tipos_llanta_write on tc_tipos_llanta;
create policy tc_tipos_llanta_write on tc_tipos_llanta for all
  using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

drop policy if exists tc_veh_ejes_select on tc_vehiculo_ejes;
create policy tc_veh_ejes_select on tc_vehiculo_ejes for select
  using ( exists (select 1 from tc_vehiculos v where v.id = vehiculo_id and tc_puede_ver_empresa(v.empresa_id)) );
drop policy if exists tc_veh_ejes_write on tc_vehiculo_ejes;
create policy tc_veh_ejes_write on tc_vehiculo_ejes for all
  using ( exists (select 1 from tc_vehiculos v where v.id = vehiculo_id
    and (tc_is_superadmin() or (tc_is_admin() and v.empresa_id = tc_auth_empresa_id()))) )
  with check ( exists (select 1 from tc_vehiculos v where v.id = vehiculo_id
    and (tc_is_superadmin() or (tc_is_admin() and v.empresa_id = tc_auth_empresa_id()))) );

-- ── 6. Guardar el desglose por eje de un vehículo (reemplazo) ──
-- p_ejes: [{"eje":1,"ruedas":2,"medida_id":"…"|null,"tipo_llanta_id":"…"|null}, …]
create or replace function tc_set_vehiculo_ejes(p_vehiculo uuid, p_ejes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_e jsonb;
begin
  select empresa_id into v_emp from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and v_emp = tc_auth_empresa_id())) then
    raise exception 'Sin permiso para editar este vehículo';
  end if;

  delete from tc_vehiculo_ejes where vehiculo_id = p_vehiculo;
  for v_e in select jsonb_array_elements(coalesce(p_ejes, '[]'::jsonb)) loop
    insert into tc_vehiculo_ejes (vehiculo_id, eje, ruedas, medida_id, tipo_llanta_id)
    values (
      p_vehiculo,
      (v_e->>'eje')::int,
      nullif(v_e->>'ruedas','')::int,
      nullif(v_e->>'medida_id','')::uuid,
      nullif(v_e->>'tipo_llanta_id','')::uuid
    );
  end loop;
end $$;
