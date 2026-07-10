-- ============================================================
-- SEA TyreControl — Módulo Informes (Fase 1): capa de agregación
-- Toda la agregación se hace en Postgres (no en el navegador) para
-- que escale a miles de vehículos y decenas de miles de neumáticos.
-- Las funciones son SECURITY INVOKER: la RLS de cada tabla se aplica
-- al usuario que llama, así un cliente solo agrega SU empresa.
-- El parámetro p_empresa permite a admin/super-admin acotar por empresa.
-- ============================================================

-- ── KPIs del Dashboard ejecutivo ─────────────────────────────
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
    select
      coalesce(p_desde, date_trunc('month', now())::date) as d1,
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
    select distinct on (d.neumatico_id) d.neumatico_id, d.profundidad_mm
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where d.neumatico_id is not null and d.profundidad_mm is not null
      and rv.estado_revision <> 'anulada'
      and (p_empresa is null or d.empresa_id = p_empresa)
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
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
    'neumaticos_bajo_minimo', (select count(*) from ult where profundidad_mm <= 1.6),
    'neumaticos_proximos', (select count(*) from ult where profundidad_mm > 1.6 and profundidad_mm <= 3.0),
    'op_montajes', (select count(*) from ops where tipo_operacion = 'montaje'),
    'op_rotaciones', (select count(*) from ops where tipo_operacion = 'rotacion'),
    'op_reparaciones', (select count(*) from ops where tipo_operacion = 'reparacion'),
    'op_sustituciones', (select count(*) from ops where tipo_operacion = 'sustitucion'),
    'op_descartes', (select count(*) from ops where tipo_operacion = 'descarte')
  );
$$;

-- ── Inventario por dimensión (marca / modelo / medida / estado) ──
create or replace function public.tc_informes_inventario_por(
  p_empresa uuid default null,
  p_dim text default 'marca'
)
returns table(etiqueta text, total bigint)
language sql
security invoker
stable
as $$
  select coalesce(
    case p_dim
      when 'marca'  then n.marca
      when 'modelo' then n.modelo
      when 'medida' then n.medida
      when 'estado' then n.estado
      else n.marca
    end, '—') as etiqueta,
    count(*)::bigint as total
  from tc_neumaticos n
  where (p_empresa is null or n.empresa_id = p_empresa)
  group by 1
  order by 2 desc, 1;
$$;

-- ── Inventario cruzado marca + medida ────────────────────────
create or replace function public.tc_informes_inventario_marca_medida(
  p_empresa uuid default null
)
returns table(marca text, medida text, total bigint)
language sql
security invoker
stable
as $$
  select coalesce(n.marca, '—'), coalesce(n.medida, '—'), count(*)::bigint
  from tc_neumaticos n
  where (p_empresa is null or n.empresa_id = p_empresa)
  group by 1, 2
  order by 3 desc, 1, 2;
$$;

-- ── Distribución por rangos de profundidad (por marca) ───────
-- Usa la última medición de cada neumático. Rangos fijos en esta fase
-- (0-2 / 2-4 / 4-6 / 6-8 / 8-10 / +10 mm); configurables más adelante.
create or replace function public.tc_informes_profundidad_distribucion(
  p_empresa uuid default null
)
returns table(marca text, r0_2 bigint, r2_4 bigint, r4_6 bigint, r6_8 bigint, r8_10 bigint, r10 bigint, total bigint)
language sql
security invoker
stable
as $$
  with ult as (
    select distinct on (d.neumatico_id) d.neumatico_id, d.profundidad_mm, n.marca
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    join tc_neumaticos n on n.id = d.neumatico_id
    where d.profundidad_mm is not null and rv.estado_revision <> 'anulada'
      and (p_empresa is null or n.empresa_id = p_empresa)
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
  )
  select
    coalesce(marca, '—'),
    count(*) filter (where profundidad_mm <= 2)::bigint,
    count(*) filter (where profundidad_mm > 2 and profundidad_mm <= 4)::bigint,
    count(*) filter (where profundidad_mm > 4 and profundidad_mm <= 6)::bigint,
    count(*) filter (where profundidad_mm > 6 and profundidad_mm <= 8)::bigint,
    count(*) filter (where profundidad_mm > 8 and profundidad_mm <= 10)::bigint,
    count(*) filter (where profundidad_mm > 10)::bigint,
    count(*)::bigint
  from ult
  group by 1
  order by 8 desc, 1;
$$;

-- ── Estado general de la flota (semáforo + evolución mensual) ──
create or replace function public.tc_informes_estado_flota(
  p_empresa uuid default null
)
returns json
language sql
security invoker
stable
as $$
  with veh as (
    select v.id from tc_vehiculos v
    where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  ultrev as (
    select distinct on (rv.vehiculo_id) rv.vehiculo_id, rv.id as revision_id
    from revisiones_vehiculo rv
    where rv.estado_revision <> 'anulada' and (p_empresa is null or rv.empresa_id = p_empresa)
    order by rv.vehiculo_id, rv.fecha_revision desc, rv.created_at desc
  ),
  minprof as (
    select ur.vehiculo_id, min(d.profundidad_mm) as minmm
    from ultrev ur
    join revisiones_neumaticos_detalle d on d.revision_id = ur.revision_id
    where d.profundidad_mm is not null
    group by ur.vehiculo_id
  ),
  clasif as (
    select v.id,
      case
        when ur.vehiculo_id is null then 'pendiente'
        when mp.minmm is null then 'revisar'
        when mp.minmm <= 1.6 then 'urgente'
        when mp.minmm <= 3.0 then 'revisar'
        else 'correcto'
      end as estado
    from veh v
    left join ultrev ur on ur.vehiculo_id = v.id
    left join minprof mp on mp.vehiculo_id = v.id
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

grant execute on function public.tc_informes_kpis(uuid, date, date) to authenticated;
grant execute on function public.tc_informes_inventario_por(uuid, text) to authenticated;
grant execute on function public.tc_informes_inventario_marca_medida(uuid) to authenticated;
grant execute on function public.tc_informes_profundidad_distribucion(uuid) to authenticated;
grant execute on function public.tc_informes_estado_flota(uuid) to authenticated;
