-- ============================================================
-- SEA TyreControl — Informe 10: Operaciones (agregado)
-- Conteos por tipo de operación, por motivo y evolución mensual en el
-- rango de fechas. (Los tiempos medios no se calculan: no se captura la
-- duración de la operación.) SECURITY INVOKER → RLS por empresa.
-- ============================================================

create or replace function public.tc_informes_operaciones(
  p_empresa uuid default null, p_desde date default null, p_hasta date default null
)
returns json language sql security invoker stable as $$
  with rango as (
    select coalesce(p_desde, date_trunc('month', now())::date) as d1, coalesce(p_hasta, now()::date) as d2
  ),
  ops as (
    select o.tipo_operacion, o.motivo, o.fecha_operacion
    from operaciones_neumaticos o, rango
    where (p_empresa is null or o.empresa_id = p_empresa)
      and o.fecha_operacion between rango.d1 and rango.d2
  )
  select json_build_object(
    'total', (select count(*) from ops),
    'por_tipo', (select coalesce(json_agg(row_to_json(t) order by t.n desc), '[]'::json)
                 from (select tipo_operacion as tipo, count(*)::int as n from ops group by 1) t),
    'por_motivo', (select coalesce(json_agg(row_to_json(m) order by m.n desc), '[]'::json)
                   from (select coalesce(motivo, '—') as motivo, count(*)::int as n from ops group by 1) m),
    'evolucion', (select coalesce(json_agg(row_to_json(e) order by e.mes), '[]'::json)
                  from (select to_char(date_trunc('month', fecha_operacion), 'YYYY-MM') as mes, count(*)::int as n from ops group by 1) e)
  );
$$;

grant execute on function public.tc_informes_operaciones(uuid, date, date) to authenticated;
