-- ============================================================
-- SEA TyreControl — Informes: Alertas inteligentes (motor de reglas)
-- Reglas deterministas sobre datos ya existentes (sin IA, sin coste):
--   · Neumático montado bajo mínimo legal (≤ 1,6 mm)
--   · Neumático montado próximo a sustitución (≤ 3,0 mm)
--   · Vehículo activo sin ninguna revisión
-- SECURITY INVOKER → respeta la RLS por empresa. Umbrales fijos por ahora;
-- serán configurables por empresa en una fase posterior.
-- ============================================================

create or replace function public.tc_informes_alertas(
  p_empresa uuid default null
)
returns table(
  tipo text,
  severidad text,
  vehiculo_id uuid,
  matricula text,
  neumatico_id uuid,
  codigo text,
  posicion text,
  detalle text,
  valor numeric
)
language sql
security invoker
stable
as $$
  with ult as (
    select distinct on (d.neumatico_id) d.neumatico_id, d.profundidad_mm
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where d.neumatico_id is not null and d.profundidad_mm is not null
      and rv.estado_revision <> 'anulada'
      and (p_empresa is null or d.empresa_id = p_empresa)
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
  ),
  montados as (
    select m.neumatico_id, m.vehiculo_id, v.matricula,
           coalesce(n.codigo_interno, n.numero_serie) as codigo,
           p.codigo_posicion, u.profundidad_mm
    from tc_montajes_actuales m
    join tc_neumaticos n on n.id = m.neumatico_id
    join tc_vehiculos v on v.id = m.vehiculo_id
    left join tc_posiciones_vehiculo p on p.id = m.posicion_id
    join ult u on u.neumatico_id = m.neumatico_id
    where (p_empresa is null or v.empresa_id = p_empresa)
  )
  select 'bajo_minimo'::text, 'alta'::text, mo.vehiculo_id, mo.matricula, mo.neumatico_id,
         mo.codigo, mo.codigo_posicion,
         'Profundidad ' || mo.profundidad_mm || ' mm (≤ 1,6 mínimo legal)', mo.profundidad_mm
  from montados mo where mo.profundidad_mm <= 1.6
  union all
  select 'proximo_sustitucion', 'media', mo.vehiculo_id, mo.matricula, mo.neumatico_id,
         mo.codigo, mo.codigo_posicion,
         'Profundidad ' || mo.profundidad_mm || ' mm (≤ 3,0)', mo.profundidad_mm
  from montados mo where mo.profundidad_mm > 1.6 and mo.profundidad_mm <= 3.0
  union all
  select 'vehiculo_sin_revisar', 'media', v.id, v.matricula, null::uuid, null::text, null::text,
         'Vehículo activo sin ninguna revisión registrada', null::numeric
  from tc_vehiculos v
  where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
    and not exists (
      select 1 from revisiones_vehiculo rv
      where rv.vehiculo_id = v.id and rv.estado_revision <> 'anulada'
    )
  order by 2, 1;
$$;

grant execute on function public.tc_informes_alertas(uuid) to authenticated;
