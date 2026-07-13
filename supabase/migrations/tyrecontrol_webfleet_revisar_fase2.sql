-- ============================================================
-- SEA TyreControl — Webfleet "vehículos en base" (Fase 2:
-- integración con revisiones).
--
-- Calcula el estado de revisión de cada vehículo a partir de la última
-- revisión completada y la periodicidad (intervalo en días por vehículo
-- o, si no, por tipo). Y una tabla para posponer / marcar no disponible.
-- ============================================================

-- ── Estado de revisión por vehículo ─────────────────────────────────────────
-- estado: sin_revision | vencida | proxima | al_dia
-- security invoker → aplica la RLS del usuario (cada empresa ve lo suyo).
create or replace function tc_revision_estado()
returns table (
  vehiculo_id      uuid,
  ultima_revision  date,
  intervalo_dias   int,
  proxima_revision date,
  dias_vencido     int,
  estado           text
)
language sql security invoker stable
set search_path = public as $$
  with ult as (
    select vehiculo_id, max(fecha_revision)::date as ultima
    from revisiones_vehiculo
    where estado_revision = 'completada'
    group by vehiculo_id
  ),
  base as (
    select v.id as vehiculo_id,
           u.ultima,
           coalesce(v.revision_intervalo_dias, t.revision_intervalo_dias) as intervalo
    from tc_vehiculos v
    left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
    left join ult u on u.vehiculo_id = v.id
    where v.activo
  )
  select
    b.vehiculo_id,
    b.ultima,
    b.intervalo,
    case when b.ultima is not null and b.intervalo is not null then b.ultima + b.intervalo end as proxima_revision,
    case when b.ultima is not null and b.intervalo is not null then current_date - (b.ultima + b.intervalo) end as dias_vencido,
    case
      when b.ultima is null then 'sin_revision'
      when b.intervalo is null then 'al_dia'
      when current_date > b.ultima + b.intervalo then 'vencida'
      when (b.ultima + b.intervalo) - current_date <= 15 then 'proxima'
      else 'al_dia'
    end as estado
  from base b;
$$;

-- ── Posponer / marcar no disponible ─────────────────────────────────────────
create table if not exists tc_vehiculo_revision_flag (
  vehiculo_id     uuid primary key references tc_vehiculos(id) on delete cascade,
  empresa_id      uuid not null references tc_empresas(id) on delete cascade,
  pospuesta_hasta date,          -- oculto de "disponibles para revisar" hasta esta fecha
  no_disponible   boolean not null default false,
  motivo          text,
  updated_at      timestamptz not null default now()
);
alter table tc_vehiculo_revision_flag enable row level security;
drop policy if exists rev_flag_select on tc_vehiculo_revision_flag;
create policy rev_flag_select on tc_vehiculo_revision_flag for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists rev_flag_write on tc_vehiculo_revision_flag;
create policy rev_flag_write on tc_vehiculo_revision_flag for all
  using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );
