-- Seguimiento de rendimiento: poder dejar una rueda «sin seguimiento».
--
-- Hay gomas de las que no tenemos datos fiables (0039LXV: el eje 3, sin km
-- de montaje ni origen conocido). Se marcan en «✎ Inicio del seguimiento» y
-- dejan de contar en el bloque de la ficha, en el informe de Rendimiento y en
-- los puntos «estimados desde origen» de Km por mm. Se pueden volver a
-- activar desde la misma ventana.
--
--   1. Columna excluido en tc_rendimiento_neumatico_inicio (por defecto false).
--   2. tc_rendimiento_ajustar_inicio acepta "excluido" en cada rueda.
--   3. tc_rendimiento_datos devuelve 'excluido' (la definición es la de
--      producción del 27/11/2026 con esa línea añadida).
--   4. tc_informes_km_por_mm_referencia no toma origen de las excluidas
--      (definición de producción del 27/11/2026 con un filtro añadido).
--
-- No toca tc_neumaticos, tc_montajes_actuales (solo se lee), tc_vehiculo_ejes,
-- config_ejes_id ni km_actual. Idempotente: se puede pegar dos veces.

alter table tc_rendimiento_neumatico_inicio add column if not exists excluido boolean not null default false;

create or replace function public.tc_rendimiento_ajustar_inicio(p_vehiculo uuid, p_inicios jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_emp uuid; e jsonb; v_neu uuid; v_km numeric; v_prof numeric; v_excl boolean; v_n int := 0;
begin
  select empresa_id into v_emp from tc_vehiculos where id = p_vehiculo;
  if v_emp is null then raise exception 'Vehículo no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and v_emp = tc_auth_empresa_id())) then
    raise exception 'Solo un administrador puede cambiar el inicio del seguimiento';
  end if;
  if not exists (select 1 from tc_seguimiento_rendimiento where vehiculo_id = p_vehiculo) then
    raise exception 'Este vehículo no está en seguimiento de rendimiento';
  end if;
  if jsonb_typeof(p_inicios) is distinct from 'array' then raise exception 'Formato de inicios no válido'; end if;

  for e in select * from jsonb_array_elements(p_inicios) loop
    v_neu := (e->>'neumatico_id')::uuid;
    v_km := (e->>'km')::numeric;
    v_prof := (e->>'profundidad_mm')::numeric;
    v_excl := coalesce((e->>'excluido')::boolean, false);
    if not exists (select 1 from tc_montajes_actuales where vehiculo_id = p_vehiculo and neumatico_id = v_neu) then
      raise exception 'El neumático % no está montado en este vehículo', v_neu;
    end if;
    if v_km is null or v_km < 0 or v_km > 5000000 then raise exception 'Km de inicio imposibles: %', v_km; end if;
    if v_prof is null or v_prof <= 0 or v_prof > 30 then raise exception 'Profundidad de inicio imposible: % mm', v_prof; end if;
    insert into tc_rendimiento_neumatico_inicio (neumatico_id, vehiculo_id, empresa_id, km_vehiculo_inicio, profundidad_inicial_mm, fuente, excluido)
    values (v_neu, p_vehiculo, v_emp, v_km, v_prof, 'manual', v_excl)
    on conflict (neumatico_id, vehiculo_id) do update set
      km_vehiculo_inicio = excluded.km_vehiculo_inicio,
      profundidad_inicial_mm = excluded.profundidad_inicial_mm,
      fuente = 'manual',
      excluido = excluded.excluido;
    v_n := v_n + 1;
  end loop;

  -- «Desde origen» solo si todas las gomas montadas siguen empezando en 0.
  update tc_seguimiento_rendimiento s set
    desde_origen = not exists (
      select 1 from tc_montajes_actuales ma
        join tc_rendimiento_neumatico_inicio i on i.neumatico_id = ma.neumatico_id and i.vehiculo_id = ma.vehiculo_id
       where ma.vehiculo_id = p_vehiculo and i.km_vehiculo_inicio > 0 and not i.excluido),
    km_inicio = coalesce((
      select min(i.km_vehiculo_inicio) from tc_montajes_actuales ma
        join tc_rendimiento_neumatico_inicio i on i.neumatico_id = ma.neumatico_id and i.vehiculo_id = ma.vehiculo_id
       where ma.vehiculo_id = p_vehiculo and not i.excluido), s.km_inicio),
    updated_at = now()
  where s.vehiculo_id = p_vehiculo;

  return jsonb_build_object('vehiculo_id', p_vehiculo, 'gomas', v_n);
end $function$;
revoke all on function public.tc_rendimiento_ajustar_inicio(uuid, jsonb) from public, anon;
grant execute on function public.tc_rendimiento_ajustar_inicio(uuid, jsonb) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tc_rendimiento_datos(p_vehiculo uuid DEFAULT NULL::uuid, p_empresa uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'vehiculo_id', v.id, 'matricula', v.matricula, 'numero_unidad', v.numero_unidad,
    -- El km del vehículo HOY: el mayor entre su km_actual, el de su última
    -- revisión con km y el último odómetro mensual de la telemática. Hay
    -- vehículos cargados del Excel con km_actual = 0 cuya revisión de hoy
    -- marca 17.343 km; con el km_actual solo, sus gomas «no habían recorrido».
    'km_actual_vehiculo', nullif(greatest(
      coalesce(v.km_actual, 0),
      coalesce((select max(r2.km_vehiculo) from revisiones_vehiculo r2
                 where r2.vehiculo_id = v.id and r2.estado_revision is distinct from 'anulada'), 0),
      coalesce((select max(mm.final_odometer_km) from integration_vehicle_monthly_mileage mm
                 where mm.mobilink_id = v.id::text and mm.sync_status = 'ok'), 0)
    ), 0),
    'desde_origen', s.desde_origen, 'fecha_inicio', s.fecha_inicio, 'minimo_mm', s.minimo_retirada_mm,
    'posicion_id', p.id, 'posicion', coalesce(p.nombre, p.codigo_posicion), 'eje', p.eje, 'orden', p.orden_visual,
    'neumatico_id', n.id, 'numero_interno', n.numero_interno,
    'marca', n.marca, 'modelo', n.modelo, 'medida', n.medida,
    -- La referencia del catálogo (por equivalencia o por texto): para agrupar
    -- «COACHZ», «XCOACH» y «X COACH Z» como el mismo neumático.
    'ref_marca', rc.marca, 'ref_modelo', rc.modelo, 'ref_medida', rc.medida,
    'recauchutado', n.recauchutado, 'reesculturado', n.reesculturado,
    -- La profundidad de HOY: la de la ficha o la de la última revisión
    -- completada, la que sea MÁS RECIENTE (la misma regla que el plano,
    -- `profundidadVigente`). Una revisión no toca la ficha del neumático, así
    -- que con la ficha sola el rendimiento seguía enseñando lo de antes de la
    -- revisión (5871NMK: 8 mm del inventario en vez de los 10,5 medidos).
    'profundidad_actual_mm', coalesce((
      select d.profundidad_mm
        from revisiones_neumaticos_detalle d
        join revisiones_vehiculo r on r.id = d.revision_id
       where d.neumatico_id = n.id
         and r.estado_revision like 'completada%'
         and d.profundidad_mm is not null
         and coalesce(r.medido_at, r.created_at) > coalesce(n.profundidad_actualizada_en, '-infinity'::timestamptz)
       order by coalesce(r.medido_at, r.created_at) desc
       limit 1
    ), n.profundidad_actual_mm),
    'km_vehiculo_inicio', coalesce(i.km_vehiculo_inicio, case when s.desde_origen then 0 else ma.km_montaje end),
    'profundidad_inicial_mm', coalesce(i.profundidad_inicial_mm, tc_profundidad_origen_neumatico(n.id)),
    'fuente_inicio', coalesce(i.fuente, 'catalogo'),
    -- Marcada «sin seguimiento» (sin datos fiables): se devuelve para poder
    -- volver a activarla, pero las pantallas no la cuentan.
    'excluido', coalesce(i.excluido, false),
    'puntos', coalesce((
      select jsonb_agg(jsonb_build_object('km_vehiculo', r.km_vehiculo, 'mm', d.profundidad_mm, 'fecha', r.fecha_revision)
                       order by r.km_vehiculo, r.fecha_revision)
        from revisiones_neumaticos_detalle d
        join revisiones_vehiculo r on r.id = d.revision_id
       where d.neumatico_id = n.id and r.vehiculo_id = v.id
         and r.estado_revision <> 'anulada'
         and d.profundidad_mm is not null and r.km_vehiculo is not null and r.km_vehiculo > 0
    ), '[]'::jsonb)
  ) order by v.matricula, p.orden_visual), '[]'::jsonb)
  from tc_seguimiento_rendimiento s
  join tc_vehiculos v on v.id = s.vehiculo_id
  join tc_montajes_actuales ma on ma.vehiculo_id = v.id
  join tc_neumaticos n on n.id = ma.neumatico_id
  join tc_posiciones_vehiculo p on p.id = ma.posicion_id
  left join tc_rendimiento_neumatico_inicio i on i.neumatico_id = n.id and i.vehiculo_id = v.id
  left join lateral (
    select ma3.nombre as marca, mo3.nombre as modelo, ts3.medida as medida
      from tc_referencias_neumatico r3
      join tc_cat_modelos_neumatico mo3 on mo3.id = r3.modelo_id
      join tc_cat_marcas_neumatico ma3 on ma3.id = mo3.marca_id
      left join tyre_sizes ts3 on ts3.id = r3.tyre_size_id
     where r3.id = tc_referencia_de_neumatico(n.id)
  ) rc on true
  where s.activo
    and (p_vehiculo is null or v.id = p_vehiculo)
    and (p_empresa is null or v.empresa_id = p_empresa)
    and (tc_is_superadmin() or v.empresa_id = tc_auth_empresa_id() or tc_operador_ve_empresa(v.empresa_id))
$function$;

CREATE OR REPLACE FUNCTION public.tc_informes_km_por_mm_referencia(p_empresa uuid DEFAULT NULL::uuid, p_min_km numeric DEFAULT 10000, p_salto numeric DEFAULT 2.0, p_max_km_por_mm numeric DEFAULT 50000)
 RETURNS TABLE(marca text, modelo text, eje integer, tramos bigint, neumaticos bigint, km_totales numeric, mm_totales numeric, km_por_mm numeric, p25 numeric, mediana numeric, p75 numeric, mm_nuevo numeric, mm_retirada numeric, neumaticos_modelo bigint, tramos_estimados bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with t as (
    select t.* from public.tc_mediciones_tramo(p_empresa, p_salto) t
  ),
  -- El nombre del catálogo: «COACHZ», «XCOACH» y «X COACH Z» son la misma goma.
  m as (
    select t.neumatico_id as nid,
           coalesce(rc.marca, t.marca) as marca, coalesce(rc.modelo, t.modelo) as modelo,
           t.vehiculo_id as vid, t.eje, t.fecha, t.km, t.mm, t.tramo, false as estimado
      from t
      left join lateral (
        select ma3.nombre as marca, mo3.nombre as modelo
          from tc_referencias_neumatico r3
          join tc_cat_modelos_neumatico mo3 on mo3.id = r3.modelo_id
          join tc_cat_marcas_neumatico ma3 on ma3.id = mo3.marca_id
         where r3.id = tc_referencia_de_neumatico(t.neumatico_id)
      ) rc on true
     where coalesce(rc.marca, t.marca) is not null and coalesce(rc.modelo, t.modelo) is not null
  ),
  -- Gomas en seguimiento de rendimiento: su punto de partida (km de inicio y
  -- profundidad de nueva), el mismo que usa el cuadro de Rendimiento.
  origen as (
    select ma.neumatico_id as nid, ma.vehiculo_id as vid,
           coalesce(i.km_vehiculo_inicio, case when s.desde_origen then 0 else ma.km_montaje end)::numeric as km,
           coalesce(i.profundidad_inicial_mm, tc_profundidad_origen_neumatico(ma.neumatico_id))::numeric as mm,
           coalesce(s.fecha_inicio, ma.fecha_montaje)::date as fecha
      from tc_seguimiento_rendimiento s
      join tc_vehiculos v on v.id = s.vehiculo_id
      join tc_montajes_actuales ma on ma.vehiculo_id = s.vehiculo_id
      left join tc_rendimiento_neumatico_inicio i on i.neumatico_id = ma.neumatico_id and i.vehiculo_id = ma.vehiculo_id
     where s.activo and (p_empresa is null or v.empresa_id = p_empresa)
       and not coalesce(i.excluido, false)
  ),
  -- Se cuelga del primer tramo de esa goma en ese vehículo después del inicio.
  punto_origen as (
    select distinct on (o.nid) o.nid, m.marca, m.modelo, o.vid, m.eje, o.fecha, o.km, o.mm, m.tramo, true as estimado
      from origen o
      join m on m.nid = o.nid and m.vid = o.vid and m.km > o.km
     where o.km is not null and o.mm is not null
     order by o.nid, m.tramo, m.fecha, m.km
  ),
  todo as (
    select nid, marca, modelo, eje, fecha, km, mm, tramo, estimado from m
    union all
    select nid, marca, modelo, eje, fecha, km, mm, tramo, estimado from punto_origen
  ),
  tramo as (
    select nid, marca, modelo, tramo,
           count(*)                                          as n,
           bool_or(estimado)                                 as estimado,
           max(km) - min(km)                                 as span_km,
           mode() within group (order by eje)                as eje,
           (array_agg(mm order by fecha, km))[1]
             - (array_agg(mm order by fecha desc, km desc))[1] as desgaste
      from todo
     group by nid, marca, modelo, tramo
  ),
  buenos as (
    select * from tramo
     where (n >= 3 or (estimado and n >= 2))
       and span_km >= p_min_km and desgaste > 0
       and span_km / desgaste <= p_max_km_por_mm
  ),
  extremos as (
    select marca, modelo,
           round(percentile_cont(0.99) within group (order by mm)::numeric, 1) as mm_nuevo,
           round(percentile_cont(0.01) within group (order by mm)::numeric, 1) as mm_retirada
      from m group by marca, modelo
  ),
  del_modelo as (
    select marca, modelo, count(distinct nid) as neumaticos_modelo
      from buenos group by marca, modelo
  )
  select b.marca, b.modelo, b.eje,
         count(*)                                                   as tramos,
         count(distinct b.nid)                                      as neumaticos,
         round(sum(b.span_km), 0)                                   as km_totales,
         round(sum(b.desgaste), 1)                                  as mm_totales,
         round(sum(b.span_km) / sum(b.desgaste), 0)                 as km_por_mm,
         round(percentile_cont(0.25) within group (order by b.span_km / b.desgaste)::numeric, 0) as p25,
         round(percentile_cont(0.50) within group (order by b.span_km / b.desgaste)::numeric, 0) as mediana,
         round(percentile_cont(0.75) within group (order by b.span_km / b.desgaste)::numeric, 0) as p75,
         e.mm_nuevo, e.mm_retirada, dm.neumaticos_modelo,
         count(*) filter (where b.estimado)                         as tramos_estimados
    from buenos b
    join extremos   e  on e.marca  = b.marca and e.modelo  = b.modelo
    join del_modelo dm on dm.marca = b.marca and dm.modelo = b.modelo
   group by b.marca, b.modelo, b.eje, e.mm_nuevo, e.mm_retirada, dm.neumaticos_modelo
  having count(*) >= 3 and sum(b.desgaste) >= 5
   order by sum(b.span_km) desc
   limit 500;
$function$;

do $migracion$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'tc_rendimiento_neumatico_inicio' and column_name = 'excluido') then
    raise exception 'No se ha creado la columna excluido';
  end if;
  if position('excluido' in pg_get_functiondef('public.tc_rendimiento_datos(uuid,uuid)'::regprocedure)) = 0 then
    raise exception 'tc_rendimiento_datos no devuelve excluido';
  end if;
  perform set_config('mobilink.resultado', 'OK: ya se puede dejar una rueda sin seguimiento de rendimiento.', false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
