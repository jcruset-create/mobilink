-- ============================================================
-- SEA TyreControl — Informe 5: Evolución del desgaste y predicción
-- Por neumático con ≥2 mediciones y km: calcula el ritmo de desgaste
-- (mm por 1.000 km), los km restantes hasta el mínimo legal (1,6 mm) y la
-- fecha prevista de sustitución (proyección lineal por tiempo).
-- SECURITY INVOKER → respeta RLS por empresa.
-- ============================================================

create or replace function public.tc_informes_desgaste(
  p_empresa uuid default null
)
returns table(
  neumatico_id uuid, codigo text, marca text, modelo text, medida text,
  ultima_prof numeric, mm_por_1000km numeric, km_restantes numeric,
  fecha_prevista date, n_medidas bigint
)
language sql security invoker stable as $$
  with m as (
    select d.neumatico_id, d.profundidad_mm::numeric as prof,
           coalesce(rv.km_vehiculo,0)::numeric as km, rv.fecha_revision::date as fecha
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    join tc_neumaticos n on n.id = d.neumatico_id
    where d.profundidad_mm is not null and rv.estado_revision <> 'anulada'
      and coalesce(rv.km_vehiculo,0) > 0
      and (p_empresa is null or n.empresa_id = p_empresa)
  ),
  agg as (
    select neumatico_id, count(*) as n,
      (array_agg(prof  order by fecha asc))[1]  as prof_ini,
      (array_agg(prof  order by fecha desc))[1] as prof_fin,
      (array_agg(km    order by fecha asc))[1]  as km_ini,
      (array_agg(km    order by fecha desc))[1] as km_fin,
      (array_agg(fecha order by fecha asc))[1]  as fecha_ini,
      (array_agg(fecha order by fecha desc))[1] as fecha_fin
    from m group by neumatico_id
    having count(*) >= 2
  ),
  calc as (
    select a.neumatico_id, a.n, a.prof_fin,
      (a.prof_ini - a.prof_fin) as dprof,
      (a.km_fin - a.km_ini)     as dkm,
      (a.fecha_fin - a.fecha_ini) as ddias,
      a.fecha_fin
    from agg a
  )
  select c.neumatico_id,
    coalesce(n.codigo_interno, n.numero_serie), n.marca, n.modelo, n.medida,
    c.prof_fin as ultima_prof,
    case when c.dkm > 0 and c.dprof > 0 then round(c.dprof / c.dkm * 1000, 3) else null end as mm_por_1000km,
    case when c.dkm > 0 and c.dprof > 0 then round((c.prof_fin - 1.6) * c.dkm / c.dprof, 0) else null end as km_restantes,
    case when c.dprof > 0 and c.ddias > 0 then c.fecha_fin + round((c.prof_fin - 1.6) * c.ddias / c.dprof)::int else null end as fecha_prevista,
    c.n
  from calc c
  join tc_neumaticos n on n.id = c.neumatico_id
  order by fecha_prevista asc nulls last
  limit 200;
$$;

grant execute on function public.tc_informes_desgaste(uuid) to authenticated;
