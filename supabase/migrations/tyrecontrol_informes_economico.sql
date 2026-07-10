-- ============================================================
-- SEA TyreControl — Informes: módulo económico (Informe 7 + rankings + ahorros)
-- · Costes de operación (material + mano de obra) en operaciones_neumaticos
-- · Precios de referencia por medida (nuevo / recauchutado) por empresa,
--   para calcular ahorros: ahorro reparación = precio nuevo − coste reparación
-- SECURITY INVOKER → respeta RLS por empresa. Requiere tc_norm_medida()
-- (creada en tyrecontrol_informes_umbrales_categoria.sql).
-- ============================================================

alter table public.operaciones_neumaticos
  add column if not exists coste_material numeric,
  add column if not exists coste_mano_obra numeric;

create table if not exists public.tc_precios_medida (
  empresa_id uuid not null references tc_empresas(id) on delete cascade,
  medida text not null,
  precio_nuevo numeric,
  precio_recauchutado numeric,
  updated_at timestamptz not null default now(),
  primary key (empresa_id, medida)
);
alter table public.tc_precios_medida enable row level security;
drop policy if exists tc_precios_medida_select on public.tc_precios_medida;
create policy tc_precios_medida_select on public.tc_precios_medida for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_precios_medida_write on public.tc_precios_medida;
create policy tc_precios_medida_write on public.tc_precios_medida for all using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

-- ── Resumen económico ────────────────────────────────────────
create or replace function public.tc_informes_economico(
  p_empresa uuid default null, p_desde date default null, p_hasta date default null
)
returns json language sql security invoker stable as $$
  with rango as (
    select coalesce(p_desde, date_trunc('year', now())::date) as d1, coalesce(p_hasta, now()::date) as d2
  ),
  neu as (
    select n.coste_compra from tc_neumaticos n, rango
    where (p_empresa is null or n.empresa_id = p_empresa) and n.fecha_compra between rango.d1 and rango.d2
  ),
  ops as (
    select o.tipo_operacion, coalesce(o.coste_material,0) + coalesce(o.coste_mano_obra,0) as coste
    from operaciones_neumaticos o, rango
    where (p_empresa is null or o.empresa_id = p_empresa) and o.fecha_operacion between rango.d1 and rango.d2
  ),
  reps as (
    select coalesce(o.coste_material,0) + coalesce(o.coste_mano_obra,0) as coste, pm.precio_nuevo
    from operaciones_neumaticos o
    join tc_neumaticos n on n.id = o.neumatico_id
    left join tc_precios_medida pm on pm.empresa_id = n.empresa_id and tc_norm_medida(pm.medida) = tc_norm_medida(n.medida)
    cross join rango
    where o.tipo_operacion = 'reparacion' and o.fecha_operacion between rango.d1 and rango.d2
      and (p_empresa is null or o.empresa_id = p_empresa)
  )
  select json_build_object(
    'coste_neumaticos', (select coalesce(sum(coste_compra),0) from neu),
    'coste_operaciones', (select coalesce(sum(coste),0) from ops),
    'coste_reparaciones', (select coalesce(sum(coste),0) from ops where tipo_operacion = 'reparacion'),
    'coste_sustituciones', (select coalesce(sum(coste),0) from ops where tipo_operacion = 'sustitucion'),
    'coste_montajes', (select coalesce(sum(coste),0) from ops where tipo_operacion in ('montaje','desmontaje','rotacion')),
    'coste_total', (select coalesce(sum(coste_compra),0) from neu) + (select coalesce(sum(coste),0) from ops),
    'n_vehiculos', (select count(*) from tc_vehiculos v where v.activo and (p_empresa is null or v.empresa_id = p_empresa)),
    'km_flota', (select coalesce(sum(km_actual),0) from tc_vehiculos v where v.activo and (p_empresa is null or v.empresa_id = p_empresa)),
    'ahorro_reparaciones', (select coalesce(sum(precio_nuevo - coste),0) from reps where precio_nuevo is not null and precio_nuevo > coste)
  );
$$;

-- ── Ranking de vehículos ─────────────────────────────────────
create or replace function public.tc_informes_ranking_vehiculos(
  p_empresa uuid default null, p_orden text default 'coste_km'
)
returns table(vehiculo_id uuid, matricula text, km numeric, coste_total numeric, coste_km numeric, n_pinchazos bigint, n_reparaciones bigint)
language sql security invoker stable as $$
  with veh as (
    select v.id, v.matricula, v.km_actual from tc_vehiculos v where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  costes as (
    select o.vehiculo_id, sum(coalesce(o.coste_material,0) + coalesce(o.coste_mano_obra,0)) as coste_ops
    from operaciones_neumaticos o where o.vehiculo_id is not null and (p_empresa is null or o.empresa_id = p_empresa)
    group by o.vehiculo_id
  ),
  compras as (
    select m.vehiculo_id, sum(coalesce(n.coste_compra,0)) as coste_compra
    from tc_montajes_actuales m
    join tc_neumaticos n on n.id = m.neumatico_id
    join tc_vehiculos vv on vv.id = m.vehiculo_id
    where (p_empresa is null or vv.empresa_id = p_empresa)
    group by m.vehiculo_id
  ),
  pinch as (select vehiculo_id, count(*) as n from operaciones_neumaticos where motivo = 'pinchazo' and vehiculo_id is not null group by vehiculo_id),
  reps as (select vehiculo_id, count(*) as n from operaciones_neumaticos where tipo_operacion = 'reparacion' and vehiculo_id is not null group by vehiculo_id)
  select v.id, v.matricula, v.km_actual,
    coalesce(co.coste_ops,0) + coalesce(cp.coste_compra,0) as coste_total,
    case when v.km_actual > 0 then round((coalesce(co.coste_ops,0) + coalesce(cp.coste_compra,0)) / v.km_actual, 4) else null end as coste_km,
    coalesce(p.n,0), coalesce(r.n,0)
  from veh v
  left join costes co on co.vehiculo_id = v.id
  left join compras cp on cp.vehiculo_id = v.id
  left join pinch p on p.vehiculo_id = v.id
  left join reps r on r.vehiculo_id = v.id
  order by case p_orden
    when 'coste' then coalesce(co.coste_ops,0) + coalesce(cp.coste_compra,0)
    when 'coste_km' then case when v.km_actual > 0 then (coalesce(co.coste_ops,0) + coalesce(cp.coste_compra,0)) / v.km_actual else 0 end
    when 'pinchazos' then coalesce(p.n,0)::numeric
    when 'reparaciones' then coalesce(r.n,0)::numeric
    else coalesce(co.coste_ops,0) + coalesce(cp.coste_compra,0) end desc
  limit 50;
$$;

-- ── Ranking de marcas ────────────────────────────────────────
drop function if exists public.tc_informes_ranking_marcas(uuid);
create or replace function public.tc_informes_ranking_marcas(
  p_empresa uuid default null
)
returns table(marca text, n_neumaticos bigint, coste_medio numeric, prof_media numeric, n_reparaciones bigint)
language sql security invoker stable as $$
  with neu as (
    select n.id, n.marca, n.coste_compra from tc_neumaticos n
    where (p_empresa is null or n.empresa_id = p_empresa) and n.marca is not null and n.marca <> ''
  ),
  ultp as (
    select distinct on (d.neumatico_id) d.neumatico_id, d.profundidad_mm
    from revisiones_neumaticos_detalle d join revisiones_vehiculo rv on rv.id = d.revision_id
    where d.profundidad_mm is not null and rv.estado_revision <> 'anulada'
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
  ),
  reps as (
    select n.marca, count(*) as n from operaciones_neumaticos o
    join tc_neumaticos n on n.id = o.neumatico_id
    where o.tipo_operacion = 'reparacion' and (p_empresa is null or n.empresa_id = p_empresa) and n.marca is not null
    group by n.marca
  )
  select n.marca, count(*)::bigint,
    round(avg(coalesce(n.coste_compra,0))::numeric, 2),
    round(avg(u.profundidad_mm)::numeric, 2),
    coalesce(max(r.n),0)::bigint
  from neu n
  left join ultp u on u.neumatico_id = n.id
  left join reps r on r.marca = n.marca
  group by n.marca
  order by count(*) desc;
$$;

grant execute on function public.tc_informes_economico(uuid, date, date) to authenticated;
grant execute on function public.tc_informes_ranking_vehiculos(uuid, text) to authenticated;
grant execute on function public.tc_informes_ranking_marcas(uuid) to authenticated;
