-- ============================================================
-- SEA TyreControl — Umbrales de profundidad por MEDIDA (además de por empresa)
-- El límite de desgaste depende de la medida del neumático (no es lo mismo
-- 4 mm en un 295/80R22.5 de camión que en un 195/75R16 de furgoneta).
-- Cascada de resolución por neumático:
--   umbral (empresa + medida)  →  umbral por defecto de la empresa  →  1,6/3,0
-- La medida se casa normalizada (sin espacios, mayúsculas) para tolerar
-- diferencias de formato entre el catálogo y el texto del neumático.
-- ============================================================

create table if not exists public.tc_config_umbrales_medida (
  empresa_id uuid not null references tc_empresas(id) on delete cascade,
  medida text not null,
  profundidad_minima_mm numeric not null default 1.6,
  profundidad_aviso_mm numeric not null default 3.0,
  updated_at timestamptz not null default now(),
  primary key (empresa_id, medida)
);

alter table public.tc_config_umbrales_medida enable row level security;

drop policy if exists tc_config_umbrales_medida_select on public.tc_config_umbrales_medida;
create policy tc_config_umbrales_medida_select on public.tc_config_umbrales_medida
  for select using ( tc_puede_ver_empresa(empresa_id) );

drop policy if exists tc_config_umbrales_medida_write on public.tc_config_umbrales_medida;
create policy tc_config_umbrales_medida_write on public.tc_config_umbrales_medida
  for all using ( tc_is_superadmin() or tc_is_admin() )
  with check ( tc_is_superadmin() or tc_is_admin() );

-- Expresión de normalización de medida reutilizada en los joins.
-- (regexp_replace elimina espacios; upper unifica mayúsculas.)

-- ── KPIs (cascada medida → empresa → global) ─────────────────
create or replace function public.tc_informes_kpis(
  p_empresa uuid default null,
  p_desde date default null,
  p_hasta date default null
)
returns json
language sql
security invoker
stable
as $$
  with rango as (
    select coalesce(p_desde, date_trunc('month', now())::date) as d1,
           coalesce(p_hasta, now()::date) as d2
  ),
  revs as (
    select r.* from revisiones_vehiculo r, rango
    where (p_empresa is null or r.empresa_id = p_empresa)
      and r.estado_revision <> 'anulada'
      and r.fecha_revision between rango.d1 and rango.d2
  ),
  ops as (
    select o.* from operaciones_neumaticos o, rango
    where (p_empresa is null or o.empresa_id = p_empresa)
      and o.fecha_operacion between rango.d1 and rango.d2
  ),
  ult as (
    select distinct on (d.neumatico_id)
      d.neumatico_id, d.profundidad_mm, n.empresa_id, n.medida
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    join tc_neumaticos n on n.id = d.neumatico_id
    where d.neumatico_id is not null and d.profundidad_mm is not null
      and rv.estado_revision <> 'anulada'
      and (p_empresa is null or n.empresa_id = p_empresa)
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
  ),
  ultu as (
    select u.neumatico_id, u.profundidad_mm,
      coalesce(um.profundidad_minima_mm, ue.profundidad_minima_mm, 1.6) as minmm,
      coalesce(um.profundidad_aviso_mm,  ue.profundidad_aviso_mm,  3.0) as avisomm
    from ult u
    left join tc_config_umbrales ue on ue.empresa_id = u.empresa_id
    left join tc_config_umbrales_medida um
      on um.empresa_id = u.empresa_id
      and regexp_replace(upper(um.medida), '\s', '', 'g') = regexp_replace(upper(coalesce(u.medida, '')), '\s', '', 'g')
  )
  select json_build_object(
    'vehiculos_activos', (select count(*) from tc_vehiculos v where v.activo and (p_empresa is null or v.empresa_id = p_empresa)),
    'vehiculos_revisados', (select count(distinct vehiculo_id) from revs),
    'vehiculos_pendientes', (
      select count(*) from tc_vehiculos v
      where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
        and v.id not in (select vehiculo_id from revs)
    ),
    'revisiones_total', (select count(*) from revs),
    'tecnicos_activos', (select count(*) from tc_usuarios u where u.activo and coalesce(u.acceso_apk, false)),
    'neumaticos_total', (select count(*) from tc_neumaticos n where (p_empresa is null or n.empresa_id = p_empresa)),
    'neumaticos_montados', (select count(*) from tc_neumaticos n where n.estado = 'montado' and (p_empresa is null or n.empresa_id = p_empresa)),
    'neumaticos_almacen', (select count(*) from tc_neumaticos n where n.estado = 'almacen' and (p_empresa is null or n.empresa_id = p_empresa)),
    'neumaticos_reparacion', (select count(*) from tc_neumaticos n where n.estado = 'reparacion' and (p_empresa is null or n.empresa_id = p_empresa)),
    'neumaticos_descartados', (select count(*) from tc_neumaticos n where n.estado = 'descartado' and (p_empresa is null or n.empresa_id = p_empresa)),
    'neumaticos_bajo_minimo', (select count(*) from ultu where profundidad_mm <= minmm),
    'neumaticos_proximos', (select count(*) from ultu where profundidad_mm > minmm and profundidad_mm <= avisomm),
    'op_montajes', (select count(*) from ops where tipo_operacion = 'montaje'),
    'op_rotaciones', (select count(*) from ops where tipo_operacion = 'rotacion'),
    'op_reparaciones', (select count(*) from ops where tipo_operacion = 'reparacion'),
    'op_sustituciones', (select count(*) from ops where tipo_operacion = 'sustitucion'),
    'op_descartes', (select count(*) from ops where tipo_operacion = 'descarte')
  );
$$;

-- ── Estado de flota (clasifica por neumático; vehículo = el peor) ──
create or replace function public.tc_informes_estado_flota(
  p_empresa uuid default null
)
returns json
language sql
security invoker
stable
as $$
  with veh as (
    select v.id, v.empresa_id from tc_vehiculos v
    where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  ultrev as (
    select distinct on (rv.vehiculo_id) rv.vehiculo_id, rv.id as revision_id
    from revisiones_vehiculo rv
    where rv.estado_revision <> 'anulada' and (p_empresa is null or rv.empresa_id = p_empresa)
    order by rv.vehiculo_id, rv.fecha_revision desc, rv.created_at desc
  ),
  tyre_sev as (
    select ur.vehiculo_id,
      case
        when d.profundidad_mm <= coalesce(um.profundidad_minima_mm, ue.profundidad_minima_mm, 1.6) then 3
        when d.profundidad_mm <= coalesce(um.profundidad_aviso_mm,  ue.profundidad_aviso_mm,  3.0) then 2
        else 1
      end as sev
    from ultrev ur
    join revisiones_neumaticos_detalle d on d.revision_id = ur.revision_id and d.profundidad_mm is not null
    join tc_neumaticos n on n.id = d.neumatico_id
    left join tc_config_umbrales ue on ue.empresa_id = n.empresa_id
    left join tc_config_umbrales_medida um
      on um.empresa_id = n.empresa_id
      and regexp_replace(upper(um.medida), '\s', '', 'g') = regexp_replace(upper(coalesce(n.medida, '')), '\s', '', 'g')
  ),
  veh_sev as (
    select vehiculo_id, max(sev) as sev from tyre_sev group by vehiculo_id
  ),
  clasif as (
    select v.id,
      case
        when ur.vehiculo_id is null then 'pendiente'
        when vs.sev is null then 'revisar'
        when vs.sev = 3 then 'urgente'
        when vs.sev = 2 then 'revisar'
        else 'correcto'
      end as estado
    from veh v
    left join ultrev ur on ur.vehiculo_id = v.id
    left join veh_sev vs on vs.vehiculo_id = v.id
  )
  select json_build_object(
    'total', (select count(*) from veh),
    'correcto', (select count(*) from clasif where estado = 'correcto'),
    'revisar', (select count(*) from clasif where estado = 'revisar'),
    'urgente', (select count(*) from clasif where estado = 'urgente'),
    'pendiente', (select count(*) from clasif where estado = 'pendiente'),
    'evolucion', (
      select coalesce(json_agg(row_to_json(e) order by e.mes), '[]'::json) from (
        select to_char(date_trunc('month', rv.fecha_revision), 'YYYY-MM') as mes, count(*)::int as revisiones
        from revisiones_vehiculo rv
        where rv.estado_revision <> 'anulada' and (p_empresa is null or rv.empresa_id = p_empresa)
          and rv.fecha_revision >= (date_trunc('month', now()) - interval '5 months')::date
        group by 1
      ) e
    )
  );
$$;

-- ── Alertas (cascada medida → empresa → global) ──────────────
create or replace function public.tc_informes_alertas(
  p_empresa uuid default null
)
returns table(
  tipo text, severidad text, vehiculo_id uuid, matricula text,
  neumatico_id uuid, codigo text, posicion text, detalle text, valor numeric
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
           p.codigo_posicion, u.profundidad_mm,
           coalesce(um.profundidad_minima_mm, ue.profundidad_minima_mm, 1.6) as minmm,
           coalesce(um.profundidad_aviso_mm,  ue.profundidad_aviso_mm,  3.0) as avisomm
    from tc_montajes_actuales m
    join tc_neumaticos n on n.id = m.neumatico_id
    join tc_vehiculos v on v.id = m.vehiculo_id
    left join tc_posiciones_vehiculo p on p.id = m.posicion_id
    join ult u on u.neumatico_id = m.neumatico_id
    left join tc_config_umbrales ue on ue.empresa_id = v.empresa_id
    left join tc_config_umbrales_medida um
      on um.empresa_id = v.empresa_id
      and regexp_replace(upper(um.medida), '\s', '', 'g') = regexp_replace(upper(coalesce(n.medida, '')), '\s', '', 'g')
    where (p_empresa is null or v.empresa_id = p_empresa)
  )
  select 'bajo_minimo'::text, 'alta'::text, mo.vehiculo_id, mo.matricula, mo.neumatico_id,
         mo.codigo, mo.codigo_posicion,
         'Profundidad ' || mo.profundidad_mm || ' mm (≤ ' || mo.minmm || ' mínimo)', mo.profundidad_mm
  from montados mo where mo.profundidad_mm <= mo.minmm
  union all
  select 'proximo_sustitucion', 'media', mo.vehiculo_id, mo.matricula, mo.neumatico_id,
         mo.codigo, mo.codigo_posicion,
         'Profundidad ' || mo.profundidad_mm || ' mm (≤ ' || mo.avisomm || ')', mo.profundidad_mm
  from montados mo where mo.profundidad_mm > mo.minmm and mo.profundidad_mm <= mo.avisomm
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

grant execute on function public.tc_informes_kpis(uuid, date, date) to authenticated;
grant execute on function public.tc_informes_estado_flota(uuid) to authenticated;
grant execute on function public.tc_informes_alertas(uuid) to authenticated;
