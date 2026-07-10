-- ============================================================
-- SEA TyreControl — Informes: TODAS las migraciones en orden
-- Ejecutar entero de una vez en el SQL Editor. Idempotente.
-- ============================================================


-- ##################################################################
-- tyrecontrol_informes_kpis.sql
-- ##################################################################
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


-- ##################################################################
-- tyrecontrol_informes_umbrales_categoria.sql
-- ##################################################################
-- ============================================================
-- SEA TyreControl — Umbrales por CATEGORÍA de neumático
-- (turismo / 4x4 / furgoneta / camión / otros). La categoría se asigna a
-- cada medida del catálogo (tc_cat_medidas_neumatico.categoria).
-- Cascada de resolución por neumático (de más específico a más general):
--   medida (empresa)  →  categoría (empresa)  →  defecto de empresa  →  1,6/3,0
-- Autocontenida: crea las 3 tablas de umbrales si no existen y re-crea las
-- funciones de KPIs, estado de flota y alertas. Requiere haber ejecutado
-- antes tyrecontrol_informes_kpis.sql (funciones de inventario/profundidad).
-- ============================================================

-- Normalización de medida (sin espacios, mayúsculas) para casar textos.
create or replace function public.tc_norm_medida(t text)
returns text language sql immutable as $$
  select regexp_replace(upper(coalesce(t, '')), '\s', '', 'g')
$$;

-- Categoría en el catálogo de medidas.
alter table public.tc_cat_medidas_neumatico
  add column if not exists categoria text;

-- ── Tablas de umbrales (idempotentes) ────────────────────────
create table if not exists public.tc_config_umbrales (
  empresa_id uuid primary key references tc_empresas(id) on delete cascade,
  profundidad_minima_mm numeric not null default 1.6,
  profundidad_aviso_mm numeric not null default 3.0,
  presion_tolerancia_bar numeric not null default 0.5,
  updated_at timestamptz not null default now()
);
create table if not exists public.tc_config_umbrales_medida (
  empresa_id uuid not null references tc_empresas(id) on delete cascade,
  medida text not null,
  profundidad_minima_mm numeric not null default 1.6,
  profundidad_aviso_mm numeric not null default 3.0,
  updated_at timestamptz not null default now(),
  primary key (empresa_id, medida)
);
create table if not exists public.tc_config_umbrales_categoria (
  empresa_id uuid not null references tc_empresas(id) on delete cascade,
  categoria text not null,
  profundidad_minima_mm numeric not null default 1.6,
  profundidad_aviso_mm numeric not null default 3.0,
  updated_at timestamptz not null default now(),
  primary key (empresa_id, categoria)
);

alter table public.tc_config_umbrales enable row level security;
alter table public.tc_config_umbrales_medida enable row level security;
alter table public.tc_config_umbrales_categoria enable row level security;

drop policy if exists tc_config_umbrales_select on public.tc_config_umbrales;
create policy tc_config_umbrales_select on public.tc_config_umbrales for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_config_umbrales_write on public.tc_config_umbrales;
create policy tc_config_umbrales_write on public.tc_config_umbrales for all using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

drop policy if exists tc_config_umbrales_medida_select on public.tc_config_umbrales_medida;
create policy tc_config_umbrales_medida_select on public.tc_config_umbrales_medida for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_config_umbrales_medida_write on public.tc_config_umbrales_medida;
create policy tc_config_umbrales_medida_write on public.tc_config_umbrales_medida for all using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

drop policy if exists tc_config_umbrales_categoria_select on public.tc_config_umbrales_categoria;
create policy tc_config_umbrales_categoria_select on public.tc_config_umbrales_categoria for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_config_umbrales_categoria_write on public.tc_config_umbrales_categoria;
create policy tc_config_umbrales_categoria_write on public.tc_config_umbrales_categoria for all using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

-- ── KPIs (cascada medida → categoría → empresa → legal) ──────
create or replace function public.tc_informes_kpis(
  p_empresa uuid default null, p_desde date default null, p_hasta date default null
)
returns json language sql security invoker stable as $$
  with rango as (
    select coalesce(p_desde, date_trunc('month', now())::date) as d1, coalesce(p_hasta, now()::date) as d2
  ),
  revs as (
    select r.* from revisiones_vehiculo r, rango
    where (p_empresa is null or r.empresa_id = p_empresa)
      and r.estado_revision <> 'anulada' and r.fecha_revision between rango.d1 and rango.d2
  ),
  ops as (
    select o.* from operaciones_neumaticos o, rango
    where (p_empresa is null or o.empresa_id = p_empresa) and o.fecha_operacion between rango.d1 and rango.d2
  ),
  ult as (
    select distinct on (d.neumatico_id) d.neumatico_id, d.profundidad_mm, n.empresa_id, n.medida
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    join tc_neumaticos n on n.id = d.neumatico_id
    where d.neumatico_id is not null and d.profundidad_mm is not null
      and rv.estado_revision <> 'anulada' and (p_empresa is null or n.empresa_id = p_empresa)
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
  ),
  ultu as (
    select u.neumatico_id, u.profundidad_mm,
      coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm, 1.6) as minmm,
      coalesce(um.profundidad_aviso_mm,  uc.profundidad_aviso_mm,  ue.profundidad_aviso_mm,  3.0) as avisomm
    from ult u
    left join tc_config_umbrales ue on ue.empresa_id = u.empresa_id
    left join tc_config_umbrales_medida um on um.empresa_id = u.empresa_id and tc_norm_medida(um.medida) = tc_norm_medida(u.medida)
    left join tc_cat_medidas_neumatico cm on tc_norm_medida(cm.valor) = tc_norm_medida(u.medida)
    left join tc_config_umbrales_categoria uc on uc.empresa_id = u.empresa_id and uc.categoria = cm.categoria
  )
  select json_build_object(
    'vehiculos_activos', (select count(*) from tc_vehiculos v where v.activo and (p_empresa is null or v.empresa_id = p_empresa)),
    'vehiculos_revisados', (select count(distinct vehiculo_id) from revs),
    'vehiculos_pendientes', (select count(*) from tc_vehiculos v where v.activo and (p_empresa is null or v.empresa_id = p_empresa) and v.id not in (select vehiculo_id from revs)),
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
create or replace function public.tc_informes_estado_flota(p_empresa uuid default null)
returns json language sql security invoker stable as $$
  with veh as (
    select v.id, v.empresa_id from tc_vehiculos v where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
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
        when d.profundidad_mm <= coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm, 1.6) then 3
        when d.profundidad_mm <= coalesce(um.profundidad_aviso_mm,  uc.profundidad_aviso_mm,  ue.profundidad_aviso_mm,  3.0) then 2
        else 1
      end as sev
    from ultrev ur
    join revisiones_neumaticos_detalle d on d.revision_id = ur.revision_id and d.profundidad_mm is not null
    join tc_neumaticos n on n.id = d.neumatico_id
    left join tc_config_umbrales ue on ue.empresa_id = n.empresa_id
    left join tc_config_umbrales_medida um on um.empresa_id = n.empresa_id and tc_norm_medida(um.medida) = tc_norm_medida(n.medida)
    left join tc_cat_medidas_neumatico cm on tc_norm_medida(cm.valor) = tc_norm_medida(n.medida)
    left join tc_config_umbrales_categoria uc on uc.empresa_id = n.empresa_id and uc.categoria = cm.categoria
  ),
  veh_sev as (select vehiculo_id, max(sev) as sev from tyre_sev group by vehiculo_id),
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

-- ── Alertas (cascada medida → categoría → empresa → legal) ───
create or replace function public.tc_informes_alertas(p_empresa uuid default null)
returns table(
  tipo text, severidad text, vehiculo_id uuid, matricula text,
  neumatico_id uuid, codigo text, posicion text, detalle text, valor numeric
) language sql security invoker stable as $$
  with ult as (
    select distinct on (d.neumatico_id) d.neumatico_id, d.profundidad_mm
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where d.neumatico_id is not null and d.profundidad_mm is not null
      and rv.estado_revision <> 'anulada' and (p_empresa is null or d.empresa_id = p_empresa)
    order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
  ),
  montados as (
    select m.neumatico_id, m.vehiculo_id, v.matricula,
           coalesce(n.codigo_interno, n.numero_serie) as codigo, p.codigo_posicion, u.profundidad_mm,
           coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm, 1.6) as minmm,
           coalesce(um.profundidad_aviso_mm,  uc.profundidad_aviso_mm,  ue.profundidad_aviso_mm,  3.0) as avisomm
    from tc_montajes_actuales m
    join tc_neumaticos n on n.id = m.neumatico_id
    join tc_vehiculos v on v.id = m.vehiculo_id
    left join tc_posiciones_vehiculo p on p.id = m.posicion_id
    join ult u on u.neumatico_id = m.neumatico_id
    left join tc_config_umbrales ue on ue.empresa_id = v.empresa_id
    left join tc_config_umbrales_medida um on um.empresa_id = v.empresa_id and tc_norm_medida(um.medida) = tc_norm_medida(n.medida)
    left join tc_cat_medidas_neumatico cm on tc_norm_medida(cm.valor) = tc_norm_medida(n.medida)
    left join tc_config_umbrales_categoria uc on uc.empresa_id = v.empresa_id and uc.categoria = cm.categoria
    where (p_empresa is null or v.empresa_id = p_empresa)
  )
  select 'bajo_minimo'::text, 'alta'::text, mo.vehiculo_id, mo.matricula, mo.neumatico_id, mo.codigo, mo.codigo_posicion,
         'Profundidad ' || mo.profundidad_mm || ' mm (≤ ' || mo.minmm || ' mínimo)', mo.profundidad_mm
  from montados mo where mo.profundidad_mm <= mo.minmm
  union all
  select 'proximo_sustitucion', 'media', mo.vehiculo_id, mo.matricula, mo.neumatico_id, mo.codigo, mo.codigo_posicion,
         'Profundidad ' || mo.profundidad_mm || ' mm (≤ ' || mo.avisomm || ')', mo.profundidad_mm
  from montados mo where mo.profundidad_mm > mo.minmm and mo.profundidad_mm <= mo.avisomm
  union all
  select 'vehiculo_sin_revisar', 'media', v.id, v.matricula, null::uuid, null::text, null::text,
         'Vehículo activo sin ninguna revisión registrada', null::numeric
  from tc_vehiculos v
  where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
    and not exists (select 1 from revisiones_vehiculo rv where rv.vehiculo_id = v.id and rv.estado_revision <> 'anulada')
  order by 2, 1;
$$;

grant execute on function public.tc_norm_medida(text) to authenticated;
grant execute on function public.tc_informes_kpis(uuid, date, date) to authenticated;
grant execute on function public.tc_informes_estado_flota(uuid) to authenticated;
grant execute on function public.tc_informes_alertas(uuid) to authenticated;


-- ##################################################################
-- tyrecontrol_informes_economico.sql
-- ##################################################################
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


-- ##################################################################
-- tyrecontrol_informes_coste_km.sql
-- ##################################################################
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
drop function if exists public.tc_informes_ranking_marcas(uuid);
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

