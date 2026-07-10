-- ============================================================
-- SEA TyreControl — Informe 6 (Presiones) + Informe 11 (Productividad)
-- SECURITY INVOKER → respeta RLS por empresa. Usa tc_norm_medida().
-- ============================================================

-- ── Informe 6: Presiones (medida vs recomendada) ─────────────
-- Presión recomendada = catálogo de referencias por marca+modelo+medida.
-- Estado según la tolerancia por empresa (tc_config_umbrales, def. 0,5 bar).
create or replace function public.tc_informes_presiones(
  p_empresa uuid default null
)
returns table(
  neumatico_id uuid, codigo text, matricula text, posicion text,
  presion_medida numeric, presion_recomendada numeric, diferencia numeric, estado text
)
language sql security invoker stable as $$
  with precat as (
    select tc_norm_medida(coalesce(ma.nombre,'') || '|' || coalesce(mo.nombre,'') || '|' || coalesce(ts.medida,'')) as clave,
           max(r.presion_maxima_bar) as presion
    from tc_referencias_neumatico r
    join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
    left join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
    left join tyre_sizes ts on ts.id = r.tyre_size_id
    where r.presion_maxima_bar is not null
    group by 1
  ),
  ultp as (
    select distinct on (d.neumatico_id) d.neumatico_id, d.presion_bar
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where d.presion_bar is not null and rv.estado_revision <> 'anulada'
      and (p_empresa is null or d.empresa_id = p_empresa)
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
  ),
  mont as (
    select m.neumatico_id, v.matricula, v.empresa_id, p.codigo_posicion as posicion,
           coalesce(n.codigo_interno, n.numero_serie) as codigo,
           tc_norm_medida(coalesce(n.marca,'') || '|' || coalesce(n.modelo,'') || '|' || coalesce(n.medida,'')) as clave
    from tc_montajes_actuales m
    join tc_neumaticos n on n.id = m.neumatico_id
    join tc_vehiculos v on v.id = m.vehiculo_id
    left join tc_posiciones_vehiculo p on p.id = m.posicion_id
    where (p_empresa is null or v.empresa_id = p_empresa)
  )
  select mo.neumatico_id, mo.codigo, mo.matricula, mo.posicion,
    up.presion_bar as presion_medida,
    pc.presion as presion_recomendada,
    case when pc.presion is not null then round(up.presion_bar - pc.presion, 2) else null end as diferencia,
    case
      when pc.presion is null then 'sin_referencia'
      when up.presion_bar < pc.presion - coalesce(ue.presion_tolerancia_bar, 0.5) then 'baja'
      when up.presion_bar > pc.presion + coalesce(ue.presion_tolerancia_bar, 0.5) then 'alta'
      else 'ok'
    end as estado
  from mont mo
  join ultp up on up.neumatico_id = mo.neumatico_id
  left join precat pc on pc.clave = mo.clave
  left join tc_config_umbrales ue on ue.empresa_id = mo.empresa_id
  order by
    case
      when pc.presion is null then 3
      when up.presion_bar < pc.presion - coalesce(ue.presion_tolerancia_bar, 0.5) then 0
      when up.presion_bar > pc.presion + coalesce(ue.presion_tolerancia_bar, 0.5) then 0
      else 2
    end,
    abs(up.presion_bar - coalesce(pc.presion, up.presion_bar)) desc
  limit 300;
$$;

-- ── Informe 11: Productividad por técnico ────────────────────
create or replace function public.tc_informes_productividad(
  p_empresa uuid default null, p_desde date default null, p_hasta date default null
)
returns table(
  tecnico_id uuid, tecnico text, revisiones bigint, neumaticos_revisados bigint, operaciones bigint
)
language sql security invoker stable as $$
  with rango as (
    select coalesce(p_desde, date_trunc('month', now())::date) as d1, coalesce(p_hasta, now()::date) as d2
  ),
  revs as (
    select rv.id, rv.tecnico_id from revisiones_vehiculo rv, rango
    where rv.estado_revision <> 'anulada' and (p_empresa is null or rv.empresa_id = p_empresa)
      and rv.fecha_revision between rango.d1 and rango.d2 and rv.tecnico_id is not null
  ),
  det as (
    select rv.tecnico_id, count(*) as n
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    cross join rango
    where d.profundidad_mm is not null and rv.estado_revision <> 'anulada'
      and (p_empresa is null or rv.empresa_id = p_empresa)
      and rv.fecha_revision between rango.d1 and rango.d2 and rv.tecnico_id is not null
    group by rv.tecnico_id
  ),
  ops as (
    select o.tecnico_id, count(*) as n from operaciones_neumaticos o, rango
    where o.tecnico_id is not null and (p_empresa is null or o.empresa_id = p_empresa)
      and o.fecha_operacion between rango.d1 and rango.d2
    group by o.tecnico_id
  ),
  tec as (
    select tecnico_id from revs where tecnico_id is not null
    union select tecnico_id from ops where tecnico_id is not null
  )
  select t.tecnico_id, coalesce(u.nombre, '—'),
    (select count(*) from revs r where r.tecnico_id = t.tecnico_id)::bigint,
    coalesce((select n from det where det.tecnico_id = t.tecnico_id), 0)::bigint,
    coalesce((select n from ops where ops.tecnico_id = t.tecnico_id), 0)::bigint
  from tec t
  left join tc_usuarios u on u.id = t.tecnico_id
  order by 3 desc;
$$;

grant execute on function public.tc_informes_presiones(uuid) to authenticated;
grant execute on function public.tc_informes_productividad(uuid, date, date) to authenticated;
