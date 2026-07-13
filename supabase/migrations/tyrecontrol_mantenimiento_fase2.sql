-- ============================================================
-- SEA TyreControl — Planificación de revisiones (Fase 2).
-- Plantillas de mantenimiento + lotes de revisión (visitas).
-- Reutiliza tc_empresas, tc_delegaciones (bases), tc_vehiculos,
-- tc_usuarios (técnicos), tc_operaciones_mantenimiento.
-- ============================================================

-- ── Plantillas de mantenimiento ─────────────────────────────────────────────
create table if not exists tc_plantillas_mantenimiento (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null,
  descripcion      text,
  tipo_vehiculo_id uuid references tc_tipos_vehiculo(id) on delete set null, -- sugerida para este tipo
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid()
);

create table if not exists tc_plantilla_items (
  id                uuid primary key default gen_random_uuid(),
  plantilla_id      uuid not null references tc_plantillas_mantenimiento(id) on delete cascade,
  operacion_id      uuid not null references tc_operaciones_mantenimiento(id),
  nombre            text,
  frecuencia_dias   int,
  frecuencia_meses  int,
  frecuencia_km     int,
  frecuencia_horas  int,
  margen_aviso_dias int not null default 15,
  tiempo_estimado_min int,
  orden             int not null default 100
);
create index if not exists idx_plantilla_items_plantilla on tc_plantilla_items (plantilla_id);

-- ── Lotes de revisión (visita conjunta a una base) ──────────────────────────
create table if not exists tc_lotes_revision (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references tc_empresas(id) on delete cascade,
  delegacion_id  uuid references tc_delegaciones(id) on delete set null,
  fecha_prevista date,
  hora_prevista  time,
  estado         text not null default 'borrador'
                   check (estado in ('borrador','planificado','confirmado','en_curso','finalizado','parcial','cancelado')),
  tecnico_id     uuid references tc_usuarios(id) on delete set null,
  tiempo_estimado_min int,
  observaciones  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid default auth.uid()
);
create index if not exists idx_lotes_empresa on tc_lotes_revision (empresa_id);
create index if not exists idx_lotes_fecha on tc_lotes_revision (fecha_prevista);

create table if not exists tc_lote_vehiculos (
  lote_id     uuid not null references tc_lotes_revision(id) on delete cascade,
  vehiculo_id uuid not null references tc_vehiculos(id) on delete cascade,
  plan_id     uuid references tc_planes_mantenimiento(id) on delete set null,
  orden       int not null default 0,
  estado      text not null default 'pendiente' check (estado in ('pendiente','realizada','no_disponible')),
  primary key (lote_id, vehiculo_id)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table tc_plantillas_mantenimiento enable row level security;
alter table tc_plantilla_items          enable row level security;
alter table tc_lotes_revision           enable row level security;
alter table tc_lote_vehiculos           enable row level security;

-- Plantillas: catálogo global; leen todos, editan admin/superadmin.
drop policy if exists plantillas_select on tc_plantillas_mantenimiento;
create policy plantillas_select on tc_plantillas_mantenimiento for select using ( true );
drop policy if exists plantillas_write on tc_plantillas_mantenimiento;
create policy plantillas_write on tc_plantillas_mantenimiento for all
  using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

drop policy if exists plantilla_items_select on tc_plantilla_items;
create policy plantilla_items_select on tc_plantilla_items for select using ( true );
drop policy if exists plantilla_items_write on tc_plantilla_items;
create policy plantilla_items_write on tc_plantilla_items for all
  using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

-- Lotes: por empresa.
drop policy if exists lotes_select on tc_lotes_revision;
create policy lotes_select on tc_lotes_revision for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists lotes_write on tc_lotes_revision;
create policy lotes_write on tc_lotes_revision for all
  using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

drop policy if exists lote_veh_select on tc_lote_vehiculos;
create policy lote_veh_select on tc_lote_vehiculos for select
  using ( exists (select 1 from tc_lotes_revision l where l.id = lote_id and tc_puede_ver_empresa(l.empresa_id)) );
drop policy if exists lote_veh_write on tc_lote_vehiculos;
create policy lote_veh_write on tc_lote_vehiculos for all
  using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

-- ── Aplicar una plantilla a varios vehículos (crea los planes) ──────────────
create or replace function tc_aplicar_plantilla(p_plantilla uuid, p_vehiculos uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_veh uuid; v_item record; n int := 0;
begin
  if not (tc_is_superadmin() or tc_is_admin()) then raise exception 'Sin permiso'; end if;
  foreach v_veh in array p_vehiculos loop
    for v_item in select * from tc_plantilla_items where plantilla_id = p_plantilla loop
      if not exists (select 1 from tc_planes_mantenimiento pm
                     where pm.vehiculo_id = v_veh and pm.operacion_id = v_item.operacion_id and pm.activo) then
        insert into tc_planes_mantenimiento
          (empresa_id, vehiculo_id, operacion_id, nombre, frecuencia_dias, frecuencia_meses,
           frecuencia_km, frecuencia_horas, margen_aviso_dias, ultima_fecha, ultima_km, delegacion_id)
        select vh.empresa_id, vh.id, v_item.operacion_id, v_item.nombre, v_item.frecuencia_dias, v_item.frecuencia_meses,
          v_item.frecuencia_km, v_item.frecuencia_horas, v_item.margen_aviso_dias,
          (select r.fecha_revision from revisiones_vehiculo r where r.vehiculo_id = vh.id and r.estado_revision = 'completada' order by r.fecha_revision desc limit 1),
          (select r.km_vehiculo   from revisiones_vehiculo r where r.vehiculo_id = vh.id and r.estado_revision = 'completada' order by r.fecha_revision desc limit 1),
          vh.delegacion_id
        from tc_vehiculos vh where vh.id = v_veh;
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;

-- ── Finalizar un lote: registra las revisiones "realizada" y cierra ─────────
create or replace function tc_finalizar_lote(p_lote uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lv record; v_km numeric; v_fecha date; v_tec uuid;
begin
  if not (tc_is_superadmin() or tc_is_admin()) then raise exception 'Sin permiso'; end if;
  select coalesce(fecha_prevista, current_date), tecnico_id into v_fecha, v_tec from tc_lotes_revision where id = p_lote;
  for lv in select * from tc_lote_vehiculos where lote_id = p_lote and estado = 'realizada' loop
    select km_actual into v_km from tc_vehiculos where id = lv.vehiculo_id;
    if lv.plan_id is not null then
      insert into tc_mantenimiento_realizadas (empresa_id, vehiculo_id, plan_id, operacion_id, fecha, tecnico_id, km, resultado, observaciones)
      select p.empresa_id, p.vehiculo_id, p.id, p.operacion_id, v_fecha, v_tec, v_km, 'correcta', 'Registrada desde lote de revisión'
      from tc_planes_mantenimiento p where p.id = lv.plan_id;
      update tc_planes_mantenimiento
        set ultima_fecha = v_fecha, ultima_km = coalesce(v_km, ultima_km), ajuste_manual = false, estado_manual = null, updated_at = now()
      where id = lv.plan_id;
    end if;
  end loop;
  update tc_lotes_revision
    set estado = case when exists (select 1 from tc_lote_vehiculos where lote_id = p_lote and estado = 'pendiente') then 'parcial' else 'finalizado' end,
        updated_at = now()
  where id = p_lote;
end $$;
