-- ============================================================
-- Mobilink TyreControl — INFORME EJECUTIVO mensual
--
-- Una sola RPC que devuelve, en un jsonb, todo lo que necesita la pantalla
-- "Ejecutivo" de Informes: cabecera, comparativa con el periodo anterior,
-- distribución del desgaste con estadística, evolución mensual, cortes por
-- base/marca/medida/eje, ficha resumida por vehículo, anomalías detectadas y
-- predicción de sustituciones a 30/60/90/180 días.
--
-- Decisiones que conviene conocer antes de tocar nada:
--
--  · SECURITY INVOKER: se apoya en las RLS existentes. El cliente que la llama
--    desde el panel solo ve su empresa aunque no pase p_empresa.
--
--  · Los umbrales NO se fijan aquí: se resuelven con la misma cascada que el
--    resto de informes (medida → categoría → empresa → 1,6/3,0 legal). Si se
--    cambiara aquí, dos pantallas darían cifras distintas del mismo neumático.
--
--  · "Eje" se agrupa por su NÚMERO, no por función (dirección/tracción/
--    remolque). El modelo de datos guarda tc_posiciones_vehiculo.eje como int
--    y no registra qué eje es el motriz, así que etiquetarlos sería inventar.
--
--  · La predicción es una extrapolación lineal del desgaste medido (mm/día
--    entre la primera y la última medición del neumático). Requiere ≥2
--    revisiones con profundidad; los neumáticos con una sola medición quedan
--    fuera y se informa de cuántos son, para no dar la predicción por completa.
--
-- Idempotente: create or replace.
-- ============================================================

create or replace function public.tc_informe_ejecutivo(
  p_empresa uuid default null,
  p_desde   date default null,
  p_hasta   date default null
)
returns jsonb
language sql
security invoker
stable
as $$
with rango as (
  select
    coalesce(p_desde, date_trunc('month', now())::date) as d1,
    coalesce(p_hasta, now()::date)                      as d2
),
-- Periodo anterior de la MISMA duración, para comparar sin sesgo.
rango_prev as (
  select (d1 - (d2 - d1) - 1)::date as p1, (d1 - 1)::date as p2 from rango
),
veh as (
  select v.id, v.matricula, v.delegacion_id, v.km_actual, v.tipo_vehiculo_id
  from tc_vehiculos v
  where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
),
-- Revisiones válidas del periodo y del anterior.
revs as (
  select r.* from revisiones_vehiculo r, rango
  where (p_empresa is null or r.empresa_id = p_empresa)
    and r.estado_revision <> 'anulada'
    and r.fecha_revision between rango.d1 and rango.d2
),
revs_prev as (
  select r.* from revisiones_vehiculo r, rango_prev
  where (p_empresa is null or r.empresa_id = p_empresa)
    and r.estado_revision <> 'anulada'
    and r.fecha_revision between rango_prev.p1 and rango_prev.p2
),
-- Última medición de cada neumático (sin límite de periodo: el estado actual
-- de un neumático es su última lectura, aunque sea de hace dos meses).
ult as (
  select distinct on (d.neumatico_id)
    d.neumatico_id, d.profundidad_mm, d.presion_bar, d.posicion_id,
    d.vehiculo_id, rv.fecha_revision, n.empresa_id, n.medida, n.marca,
    n.modelo, n.reesculturado
  from revisiones_neumaticos_detalle d
  join revisiones_vehiculo rv on rv.id = d.revision_id
  join tc_neumaticos n on n.id = d.neumatico_id
  where d.neumatico_id is not null and d.profundidad_mm is not null
    and rv.estado_revision <> 'anulada'
    -- Solo neumáticos que siguen montados: uno desmontado o descartado
    -- arrastraría su última medición al vehículo donde estuvo, y la ficha de
    -- ese vehículo mostraría una alarma de algo que ya no rueda.
    and n.estado = 'montado' and n.activo
    and (p_empresa is null or n.empresa_id = p_empresa)
  order by d.neumatico_id, rv.fecha_revision desc, rv.created_at desc
),
-- Umbral aplicable a cada neumático: misma cascada que tc_informes_kpis.
ultu as (
  select u.*,
    coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm, 1.6) as minmm,
    coalesce(um.profundidad_aviso_mm,  uc.profundidad_aviso_mm,  ue.profundidad_aviso_mm,  3.0) as avisomm
  from ult u
  left join tc_config_umbrales ue on ue.empresa_id = u.empresa_id
  left join tc_config_umbrales_medida um
    on um.empresa_id = u.empresa_id and tc_norm_medida(um.medida) = tc_norm_medida(u.medida)
  left join tc_cat_medidas_neumatico cm on tc_norm_medida(cm.valor) = tc_norm_medida(u.medida)
  left join tc_config_umbrales_categoria uc
    on uc.empresa_id = u.empresa_id and uc.categoria = cm.categoria
),
-- Clasificación por neumático. Las bandas de nivel son relativas al umbral de
-- aviso, no absolutas: 3 mm no significan lo mismo en un turismo que en un
-- camión, y el umbral ya recoge esa diferencia.
clas as (
  select t.*,
    case
      when t.profundidad_mm <= t.minmm                  then 'critico'
      when t.profundidad_mm <= t.avisomm                then 'bajo'
      when t.profundidad_mm <= t.avisomm + 2            then 'medio'
      when t.profundidad_mm <= t.avisomm + 5            then 'bueno'
      else 'excelente'
    end as nivel,
    -- Bandas absolutas en mm, para el histograma clásico del informe.
    case
      when t.profundidad_mm <  4  then '<4'
      when t.profundidad_mm <  6  then '4-6'
      when t.profundidad_mm <  8  then '6-8'
      when t.profundidad_mm < 10  then '8-10'
      when t.profundidad_mm < 12  then '10-12'
      else '>=12'
    end as banda
  from ultu t
),
-- Estado por vehículo = el de su peor neumático.
veh_estado as (
  select v.id, v.matricula, v.delegacion_id, v.km_actual,
    count(c.neumatico_id)                                  as n_neumaticos,
    min(c.profundidad_mm)                                  as min_mm,
    round(avg(c.profundidad_mm)::numeric, 2)               as media_mm,
    max(c.fecha_revision)                                  as ultima_revision,
    count(*) filter (where c.nivel = 'critico')            as n_criticos,
    count(*) filter (where c.nivel = 'bajo')               as n_bajos
  from veh v
  left join clas c on c.vehiculo_id = v.id
  group by v.id, v.matricula, v.delegacion_id, v.km_actual
),
veh_clasif as (
  select ve.*,
    case
      when ve.n_neumaticos = 0   then 'sin_datos'
      when ve.n_criticos   > 0   then 'intervenir'
      when ve.n_bajos      > 0   then 'revisar'
      when ve.min_mm <= 5        then 'vigilar'
      else 'correcto'
    end as semaforo
  from veh_estado ve
),
-- ── Desgaste medido: mm/día entre primera y última medición ──────────────
serie as (
  select d.neumatico_id, d.profundidad_mm::numeric as prof, rv.fecha_revision::date as fecha
  from revisiones_neumaticos_detalle d
  join revisiones_vehiculo rv on rv.id = d.revision_id
  join tc_neumaticos n on n.id = d.neumatico_id
  where d.profundidad_mm is not null and rv.estado_revision <> 'anulada'
    and (p_empresa is null or n.empresa_id = p_empresa)
),
ritmo as (
  select neumatico_id,
    (array_agg(prof  order by fecha asc ))[1] as prof_ini,
    (array_agg(prof  order by fecha desc))[1] as prof_fin,
    (array_agg(fecha order by fecha desc))[1] as fecha_fin,
    ((array_agg(fecha order by fecha desc))[1] - (array_agg(fecha order by fecha asc))[1]) as ddias
  from serie group by neumatico_id having count(*) >= 2
),
-- Solo cuenta el desgaste positivo: si la profundidad sube es que se cambió
-- el neumático o se corrigió una lectura, no que el dibujo haya crecido.
prediccion as (
  select r.neumatico_id, c.minmm,
    (r.prof_ini - r.prof_fin) / nullif(r.ddias, 0) as mm_dia,
    c.profundidad_mm as prof_actual
  from ritmo r
  join clas c on c.neumatico_id = r.neumatico_id
  where r.ddias > 0 and (r.prof_ini - r.prof_fin) > 0
),
pred_dias as (
  select neumatico_id,
    floor((prof_actual - minmm) / nullif(mm_dia, 0))::int as dias_restantes
  from prediccion
),
-- ── Anomalías ────────────────────────────────────────────────────────────
-- Desgaste descompensado dentro de un mismo eje del mismo vehículo.
eje_dif as (
  select c.vehiculo_id, v.matricula, p.eje,
    round((max(c.profundidad_mm) - min(c.profundidad_mm))::numeric, 1) as dif_mm,
    count(distinct nullif(trim(c.marca), '')) as n_marcas
  from clas c
  join tc_posiciones_vehiculo p on p.id = c.posicion_id
  join veh v on v.id = c.vehiculo_id
  where p.eje is not null
  group by c.vehiculo_id, v.matricula, p.eje
  having count(*) >= 2
),
-- ── Evolución mensual (12 meses) ─────────────────────────────────────────
meses as (
  select to_char(gs, 'YYYY-MM') as mes, gs::date as ini,
         (gs + interval '1 month - 1 day')::date as fin
  from generate_series(date_trunc('month', now()) - interval '11 months',
                       date_trunc('month', now()), interval '1 month') gs
),
evol as (
  select m.mes,
    (select count(*) from revisiones_vehiculo r
      where (p_empresa is null or r.empresa_id = p_empresa)
        and r.estado_revision <> 'anulada'
        and r.fecha_revision between m.ini and m.fin) as revisiones,
    (select round(avg(d.profundidad_mm)::numeric, 2)
       from revisiones_neumaticos_detalle d
       join revisiones_vehiculo r on r.id = d.revision_id
      where (p_empresa is null or r.empresa_id = p_empresa)
        and r.estado_revision <> 'anulada' and d.profundidad_mm is not null
        and r.fecha_revision between m.ini and m.fin) as prof_media,
    (select count(*)
       from revisiones_neumaticos_detalle d
       join revisiones_vehiculo r on r.id = d.revision_id
      where (p_empresa is null or r.empresa_id = p_empresa)
        and r.estado_revision <> 'anulada' and d.profundidad_mm is not null
        and d.profundidad_mm <= 1.6
        and r.fecha_revision between m.ini and m.fin) as bajo_legal
  from meses m
)
select jsonb_build_object(
  'periodo', (select jsonb_build_object('desde', d1, 'hasta', d2) from rango),
  'periodo_anterior', (select jsonb_build_object('desde', p1, 'hasta', p2) from rango_prev),
  'generado', now(),

  -- 1. Portada
  'cabecera', jsonb_build_object(
    'vehiculos_total',     (select count(*) from veh),
    'vehiculos_revisados', (select count(distinct vehiculo_id) from revs),
    'vehiculos_pendientes',(select count(*) from veh where id not in (select vehiculo_id from revs)),
    'neumaticos_medidos',  (select count(*) from clas),
    'revisiones',          (select count(*) from revs)
  ),

  -- 2. Comparativa con el periodo anterior (tendencia)
  'comparativa', jsonb_build_object(
    'revisiones_actual',   (select count(*) from revs),
    'revisiones_previo',   (select count(*) from revs_prev),
    'vehiculos_revisados_actual', (select count(distinct vehiculo_id) from revs),
    'vehiculos_revisados_previo', (select count(distinct vehiculo_id) from revs_prev),
    'prof_media_actual', (
      select round(avg(d.profundidad_mm)::numeric, 2)
      from revisiones_neumaticos_detalle d join revs r on r.id = d.revision_id
      where d.profundidad_mm is not null),
    'prof_media_previo', (
      select round(avg(d.profundidad_mm)::numeric, 2)
      from revisiones_neumaticos_detalle d join revs_prev r on r.id = d.revision_id
      where d.profundidad_mm is not null),
    'criticos_actual', (
      select count(*) from revisiones_neumaticos_detalle d join revs r on r.id = d.revision_id
      where d.profundidad_mm is not null and d.profundidad_mm <= 1.6),
    'criticos_previo', (
      select count(*) from revisiones_neumaticos_detalle d join revs_prev r on r.id = d.revision_id
      where d.profundidad_mm is not null and d.profundidad_mm <= 1.6)
  ),

  -- 3-4. Banco de neumáticos por nivel y por banda de mm
  'niveles', (
    select coalesce(jsonb_object_agg(nivel, n), '{}'::jsonb)
    from (select nivel, count(*) as n from clas group by nivel) x),
  'bandas', (
    select coalesce(jsonb_agg(jsonb_build_object('banda', banda, 'n', n) order by orden), '[]'::jsonb)
    from (
      select banda, count(*) as n,
        case banda when '<4' then 1 when '4-6' then 2 when '6-8' then 3
                   when '8-10' then 4 when '10-12' then 5 else 6 end as orden
      from clas group by banda) x),

  -- 5. Estadística de la distribución
  'estadistica', (
    select jsonb_build_object(
      'n', count(*),
      'media',   round(avg(profundidad_mm)::numeric, 2),
      'mediana', round((percentile_cont(0.5) within group (order by profundidad_mm))::numeric, 2),
      'p10',     round((percentile_cont(0.1) within group (order by profundidad_mm))::numeric, 2),
      'p25',     round((percentile_cont(0.25) within group (order by profundidad_mm))::numeric, 2),
      'p75',     round((percentile_cont(0.75) within group (order by profundidad_mm))::numeric, 2),
      'p90',     round((percentile_cont(0.9) within group (order by profundidad_mm))::numeric, 2),
      'minimo',  round(min(profundidad_mm)::numeric, 2),
      'maximo',  round(max(profundidad_mm)::numeric, 2),
      'desviacion', round(coalesce(stddev_samp(profundidad_mm), 0)::numeric, 2),
      'coef_variacion', case when avg(profundidad_mm) > 0
        then round((coalesce(stddev_samp(profundidad_mm), 0) / avg(profundidad_mm) * 100)::numeric, 1) end
    ) from clas),

  -- 6. Evolución mensual
  'evolucion', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', mes, 'revisiones', revisiones,
      'prof_media', prof_media, 'bajo_legal', bajo_legal) order by mes), '[]'::jsonb)
    from evol),

  -- 7-8. Cortes por medida y por marca
  -- Ojo: se agrega primero y se construye el JSON después. Agregar dentro de
  -- jsonb_build_object obliga a un GROUP BY imposible, y ordenar por
  -- (x->>'unidades') compararía TEXTO (el 9 iría antes que el 10).
  'por_medida', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'medida', medida, 'unidades', unidades,
      'prof_media', prof_media, 'criticos', criticos) order by unidades desc), '[]'::jsonb)
    from (
      select coalesce(nullif(trim(medida), ''), 'Sin registrar') as medida,
             count(*) as unidades,
             round(avg(profundidad_mm)::numeric, 2) as prof_media,
             count(*) filter (where nivel = 'critico') as criticos
      from clas group by coalesce(nullif(trim(medida), ''), 'Sin registrar')) y),
  'por_marca', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'marca', marca, 'unidades', unidades, 'prof_media', prof_media,
      'criticos', criticos, 'reesculturados', reesculturados) order by unidades desc), '[]'::jsonb)
    from (
      select coalesce(nullif(trim(marca), ''), 'Sin registrar') as marca,
             count(*) as unidades,
             round(avg(profundidad_mm)::numeric, 2) as prof_media,
             count(*) filter (where nivel = 'critico') as criticos,
             count(*) filter (where reesculturado) as reesculturados
      from clas group by coalesce(nullif(trim(marca), ''), 'Sin registrar')) y),

  -- 9. Por base (delegación)
  'por_base', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'base', base, 'vehiculos', vehiculos, 'intervenir', intervenir,
      'revisar', revisar, 'sin_datos', sin_datos,
      'min_mm', min_mm, 'media_mm', media_mm) order by vehiculos desc), '[]'::jsonb)
    from (
      select coalesce(dl.nombre, 'Sin delegación') as base,
             count(*) as vehiculos,
             count(*) filter (where vc.semaforo = 'intervenir') as intervenir,
             count(*) filter (where vc.semaforo = 'revisar')    as revisar,
             count(*) filter (where vc.semaforo = 'sin_datos')  as sin_datos,
             round(min(vc.min_mm)::numeric, 1)   as min_mm,
             round(avg(vc.media_mm)::numeric, 2) as media_mm
      from veh_clasif vc
      left join tc_delegaciones dl on dl.id = vc.delegacion_id
      group by coalesce(dl.nombre, 'Sin delegación')) y),

  -- Por número de eje (sin etiquetar función: el dato no existe)
  'por_eje', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'eje', eje, 'unidades', unidades,
      'prof_media', prof_media, 'criticos', criticos) order by eje), '[]'::jsonb)
    from (
      select p.eje as eje, count(*) as unidades,
             round(avg(c.profundidad_mm)::numeric, 2) as prof_media,
             count(*) filter (where c.nivel = 'critico') as criticos
      from clas c join tc_posiciones_vehiculo p on p.id = c.posicion_id
      where p.eje is not null
      group by p.eje) y),

  -- 10. Ficha por vehículo
  'vehiculos', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'matricula', matricula,
      'base', (select dl.nombre from tc_delegaciones dl where dl.id = vc.delegacion_id),
      'semaforo', semaforo,
      'n_neumaticos', n_neumaticos,
      'min_mm', min_mm,
      'media_mm', media_mm,
      'criticos', n_criticos,
      'bajos', n_bajos,
      'km', km_actual,
      'ultima_revision', ultima_revision
    ) order by
      case semaforo when 'intervenir' then 1 when 'revisar' then 2
                    when 'vigilar' then 3 when 'correcto' then 4 else 5 end,
      min_mm asc nulls last), '[]'::jsonb)
    from veh_clasif vc),

  -- 11. Anomalías detectadas
  'anomalias', jsonb_build_object(
    'ejes_descompensados', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'matricula', matricula, 'eje', eje, 'dif_mm', dif_mm) order by dif_mm desc), '[]'::jsonb)
      from eje_dif where dif_mm >= 2),
    'ejes_marcas_mezcladas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'matricula', matricula, 'eje', eje, 'marcas', n_marcas) order by n_marcas desc), '[]'::jsonb)
      from eje_dif where n_marcas > 1),
    'sin_marca', (select count(*) from clas where nullif(trim(marca), '') is null),
    'sin_medida', (select count(*) from clas where nullif(trim(medida), '') is null)
  ),

  -- 12. Predicción de sustituciones
  'prediccion', jsonb_build_object(
    'con_ritmo_medido', (select count(*) from pred_dias),
    'sin_historico',    (select count(*) from clas c
                          where c.neumatico_id not in (select neumatico_id from pred_dias)),
    'vencidos',   (select count(*) from pred_dias where dias_restantes <= 0),
    'dias_30',    (select count(*) from pred_dias where dias_restantes >   0 and dias_restantes <=  30),
    'dias_60',    (select count(*) from pred_dias where dias_restantes >  30 and dias_restantes <=  60),
    'dias_90',    (select count(*) from pred_dias where dias_restantes >  60 and dias_restantes <=  90),
    'dias_180',   (select count(*) from pred_dias where dias_restantes >  90 and dias_restantes <= 180)
  )
);
$$;

grant execute on function public.tc_informe_ejecutivo(uuid, date, date) to authenticated;
