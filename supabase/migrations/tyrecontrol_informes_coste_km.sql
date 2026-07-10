-- ============================================================
-- SEA TyreControl — Coste por km DEL NEUMÁTICO (KPI clave del sector)
-- km rodados por un neumático = suma de (km desmontaje − km montaje) de sus
-- montajes históricos + (km actual del vehículo − km montaje) del montaje
-- vigente. Coste = coste de compra + costes de sus operaciones.
-- Solo se calcula donde hay km (>0); si faltan km, queda sin €/km.
-- ============================================================

-- Detalle por neumático (ranking de neumáticos por €/km).
create or replace function public.tc_informes_coste_km_neumatico(
  p_empresa uuid default null
)
returns table(
  neumatico_id uuid, codigo text, marca text, modelo text, medida text,
  km_recorridos numeric, coste_total numeric, coste_km numeric
)
language sql security invoker stable as $$
  with base as (
    select n.id, coalesce(n.codigo_interno, n.numero_serie) as codigo, n.marca, n.modelo, n.medida,
           coalesce(n.coste_compra, 0) as coste_compra
    from tc_neumaticos n
    where (p_empresa is null or n.empresa_id = p_empresa)
  ),
  km_hist as (
    select h.neumatico_id, sum(greatest(coalesce(h.km_desmontaje,0) - coalesce(h.km_montaje,0), 0)) as km
    from tc_historial_montajes h
    where coalesce(h.km_desmontaje,0) > 0 and coalesce(h.km_montaje,0) > 0
    group by h.neumatico_id
  ),
  km_act as (
    select m.neumatico_id, greatest(coalesce(v.km_actual,0) - coalesce(m.km_montaje,0), 0) as km
    from tc_montajes_actuales m
    join tc_vehiculos v on v.id = m.vehiculo_id
    where coalesce(m.km_montaje,0) > 0 and coalesce(v.km_actual,0) > 0
  ),
  ops as (
    select o.neumatico_id, sum(coalesce(o.coste_material,0) + coalesce(o.coste_mano_obra,0)) as coste
    from operaciones_neumaticos o where o.neumatico_id is not null group by o.neumatico_id
  )
  select b.id, b.codigo, b.marca, b.modelo, b.medida,
    (coalesce(kh.km,0) + coalesce(ka.km,0)) as km_recorridos,
    (b.coste_compra + coalesce(op.coste,0)) as coste_total,
    case when (coalesce(kh.km,0) + coalesce(ka.km,0)) > 0
      then round((b.coste_compra + coalesce(op.coste,0)) / (coalesce(kh.km,0) + coalesce(ka.km,0)), 4)
      else null end as coste_km
  from base b
  left join km_hist kh on kh.neumatico_id = b.id
  left join km_act ka on ka.neumatico_id = b.id
  left join ops op on op.neumatico_id = b.id
  order by coste_km desc nulls last
  limit 100;
$$;

-- Ranking de marcas con €/km y km medios por neumático.
create or replace function public.tc_informes_ranking_marcas(
  p_empresa uuid default null
)
returns table(
  marca text, n_neumaticos bigint, coste_medio numeric, prof_media numeric,
  n_reparaciones bigint, km_medio numeric, coste_km_medio numeric
)
language sql security invoker stable as $$
  with base as (
    select n.id, n.marca, coalesce(n.coste_compra,0) as coste_compra
    from tc_neumaticos n
    where (p_empresa is null or n.empresa_id = p_empresa) and n.marca is not null and n.marca <> ''
  ),
  km_hist as (
    select h.neumatico_id, sum(greatest(coalesce(h.km_desmontaje,0) - coalesce(h.km_montaje,0), 0)) as km
    from tc_historial_montajes h
    where coalesce(h.km_desmontaje,0) > 0 and coalesce(h.km_montaje,0) > 0
    group by h.neumatico_id
  ),
  km_act as (
    select m.neumatico_id, greatest(coalesce(v.km_actual,0) - coalesce(m.km_montaje,0), 0) as km
    from tc_montajes_actuales m join tc_vehiculos v on v.id = m.vehiculo_id
    where coalesce(m.km_montaje,0) > 0 and coalesce(v.km_actual,0) > 0
  ),
  ops as (
    select o.neumatico_id, sum(coalesce(o.coste_material,0) + coalesce(o.coste_mano_obra,0)) as coste
    from operaciones_neumaticos o where o.neumatico_id is not null group by o.neumatico_id
  ),
  ultp as (
    select distinct on (d.neumatico_id) d.neumatico_id, d.profundidad_mm
    from revisiones_neumaticos_detalle d join revisiones_vehiculo rv on rv.id = d.revision_id
    where d.profundidad_mm is not null and rv.estado_revision <> 'anulada'
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
  ),
  tyre as (
    select b.marca, b.coste_compra + coalesce(op.coste,0) as coste_total,
      (coalesce(kh.km,0) + coalesce(ka.km,0)) as km,
      u.profundidad_mm
    from base b
    left join km_hist kh on kh.neumatico_id = b.id
    left join km_act ka on ka.neumatico_id = b.id
    left join ops op on op.neumatico_id = b.id
    left join ultp u on u.neumatico_id = b.id
  ),
  reps as (
    select n.marca, count(*) as n from operaciones_neumaticos o
    join tc_neumaticos n on n.id = o.neumatico_id
    where o.tipo_operacion = 'reparacion' and (p_empresa is null or n.empresa_id = p_empresa) and n.marca is not null
    group by n.marca
  )
  select t.marca, count(*)::bigint,
    round(avg(t.coste_total)::numeric, 2),
    round(avg(t.profundidad_mm)::numeric, 2),
    coalesce(max(r.n),0)::bigint,
    round(avg(nullif(t.km,0))::numeric, 0),
    round(avg(case when t.km > 0 then t.coste_total / t.km else null end)::numeric, 4)
  from tyre t
  left join reps r on r.marca = t.marca
  group by t.marca
  order by count(*) desc;
$$;

grant execute on function public.tc_informes_coste_km_neumatico(uuid) to authenticated;
grant execute on function public.tc_informes_ranking_marcas(uuid) to authenticated;
