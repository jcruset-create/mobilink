-- Informe «Kilómetros por milímetro»: por referencia del catálogo y con las
-- gomas en seguimiento desde origen.
--
-- Caso: la Michelin X COACH Z que se sigue en varios autobuses de Plana no salía.
--   1. Cada una tiene, como mucho, UNA medición real, y el informe pedía 3 con
--      10.000 km entre la primera y la última.
--   2. Y aunque las tuviera, salía partida en cuatro filas por cómo se escribió
--      el modelo en cada goma: «X COACH Z», «COACHZ», «COACH», «XCOACH».
--
-- Función NUEVA tc_informes_km_por_mm_referencia (la pantalla pasa a usarla):
--   · Marca y modelo de la referencia del catálogo (tc_referencia_de_neumatico),
--     como el cuadro de Rendimiento; si no la hay, lo escrito en la goma.
--   · Las gomas montadas en vehículos con seguimiento de rendimiento activo
--     llevan como primer punto el de partida del Rendimiento (km de inicio y
--     profundidad de nueva). Con él basta UNA medición real más (2 puntos) para
--     contar el tramo, que queda marcado como estimado (tramos_estimados).
--   · Lo demás, igual que tc_informes_km_por_mm.
--
-- tc_informes_km_por_mm NO se toca: la usa tc_informes_desgaste, que la cruza
-- por el nombre escrito en la goma. Solo se crea una función; no toca tablas.
-- Idempotente: se puede pegar dos veces.

drop function if exists public.tc_informes_km_por_mm_referencia(uuid, numeric, numeric, numeric);

create function public.tc_informes_km_por_mm_referencia(
  p_empresa uuid default null, p_min_km numeric default 10000,
  p_salto numeric default 2.0, p_max_km_por_mm numeric default 50000)
returns table(marca text, modelo text, eje integer, tramos bigint, neumaticos bigint, km_totales numeric,
              mm_totales numeric, km_por_mm numeric, p25 numeric, mediana numeric, p75 numeric,
              mm_nuevo numeric, mm_retirada numeric, neumaticos_modelo bigint, tramos_estimados bigint)
language sql
stable
as $$
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
$$;

revoke all on function public.tc_informes_km_por_mm_referencia(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.tc_informes_km_por_mm_referencia(uuid, numeric, numeric, numeric) to authenticated, service_role;

do $migracion$
begin
  if to_regprocedure('public.tc_informes_km_por_mm_referencia(uuid,numeric,numeric,numeric)') is null then
    raise exception 'No se ha creado tc_informes_km_por_mm_referencia';
  end if;
  perform set_config('mobilink.resultado',
    'OK: informe de km por mm por referencia del catálogo y con las gomas en seguimiento desde origen.', false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
