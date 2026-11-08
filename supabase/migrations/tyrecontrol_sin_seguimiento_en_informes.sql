-- ════════════════════════════════════════════════════════════════════════════
-- SEA TyreControl — Los vehículos sin seguimiento dejan de contar
-- ════════════════════════════════════════════════════════════════════════════
--
-- Segunda mitad de `tyrecontrol_vehiculos_en_seguimiento.sql`, que añadió la
-- columna sin tocar ningún informe. Aquí se enchufa: catorce funciones pasan a
-- exigir `en_seguimiento`.
--
-- ── Cómo se ha hecho, que importa más que el qué ───────────────────────────
--
-- Las doce primeras NO están reescritas a mano. Se ha leído su definición VIVA
-- de producción y se ha aplicado una sustitución de texto —`v.activo` pasa a
-- `v.activo and v.en_seguimiento`— comprobando el diff línea a línea: son 13
-- líneas cambiadas en total y ninguna otra. Reescribir a mano un cuerpo de
-- 18 KB como el de `tc_informe_ejecutivo_base` para añadirle cuatro palabras
-- es la forma segura de colar una errata que nadie ve hasta que un informe da
-- un número raro.
--
-- ── Las que SÍ se tocan ────────────────────────────────────────────────────
--
-- Nueve informes: `tc_informes_kpis`, `tc_informes_estado_flota`,
-- `tc_informe_control_revisiones`, `tc_informe_ejecutivo`,
-- `tc_informe_ejecutivo_base`, `tc_informe_flota_detalle`,
-- `tc_informes_alertas`, `tc_informes_economico`,
-- `tc_informes_ranking_vehiculos`.
--
-- Tres de revisión y planificación: `tc_revision_estado`, `tc_plan_estado`
-- —éste por el join, porque su `activo` es el del PLAN y no el del vehículo— y
-- `tc_alta_operativa_recuentos`.
--
-- Y dos de las nuevas: `tc_informes_desgaste` y
-- `tc_informes_sustituciones_previstas`.
--
-- ── Las que NO se tocan, y por qué ─────────────────────────────────────────
--
-- · `tc_informes_km_por_mm` y `tc_mediciones_tramo`. Ese informe no mide
--   nuestra flota, mide MODELOS de neumático: cuántos kilómetros aguanta cada
--   milímetro de un AH51. Una medición de un vehículo fuera del contrato sigue
--   siendo una medición buena de un AH51, y tirarla solo empeora la cifra. Por
--   eso el filtro va en `tc_informes_desgaste` —que sí dice a qué goma hay que
--   ir— y no en la base de mediciones que comparten.
--
-- · Las doce funciones de ACCIÓN sobre un vehículo concreto —montar,
--   inventariar, dar de alta el tipo, aplicar plantilla—. Si alguien decide
--   montarle una goma a un vehículo sin seguimiento, la acción tiene que
--   funcionar: bloquearla sería inventar un modo de fallo nuevo para arreglar
--   un problema de recuentos.
--
-- · `tc_pendientes_identificar`. Parece de vehículos y es de NEUMÁTICOS: lista
--   gomas sin identificar, montadas o en almacén. Una goma nuestra montada en
--   un vehículo fuera del contrato sigue siendo una goma nuestra sin
--   identificar.
--
-- · `tc_base_habitual`, `tc_almacen_usados` y todo lo de telemática y
--   presencia. En la telemática SÍ están, y es donde se quieren ver.
--
-- · `resolverVehiculo` del servidor, el de la asistencia en carretera. Si uno
--   se avería, la grúa tiene que encontrarlo.
--
-- Con `en_seguimiento` en `true` para todos —que es como nacen—, esta
-- migración tampoco cambia ningún número. Los cambia marcar vehículos.

CREATE OR REPLACE FUNCTION public.tc_informes_kpis(p_empresa uuid DEFAULT NULL::uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET jit TO 'off'
AS $function$
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
    'vehiculos_activos', (select count(*) from tc_vehiculos v where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)),
    'vehiculos_revisados', (select count(distinct vehiculo_id) from revs),
    'vehiculos_pendientes', (select count(*) from tc_vehiculos v where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa) and v.id not in (select vehiculo_id from revs)),
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
$function$;

CREATE OR REPLACE FUNCTION public.tc_informes_estado_flota(p_empresa uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET jit TO 'off'
AS $function$
  with veh as (
    select v.id, v.empresa_id from tc_vehiculos v where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)
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
$function$;

CREATE OR REPLACE FUNCTION public.tc_informe_control_revisiones(p_empresa uuid DEFAULT NULL::uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS TABLE(vehiculo_id uuid, matricula text, numero_unidad text, base text, tipo text, ultima_revision date, medido_at timestamp with time zone, origen text, n_neumaticos integer, min_mm numeric, dias_desde integer, intervalo_dias integer, proxima_revision date, dias_vencido integer, estado text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET jit TO 'off'
AS $function$
  with veh as (
    select v.id, v.matricula, v.numero_unidad,
           d.nombre as base,
           coalesce(t.descripcion, t.nombre) as tipo,
           coalesce(v.revision_intervalo_dias, t.revision_intervalo_dias) as intervalo
      from tc_vehiculos v
      left join tc_delegaciones d   on d.id = v.delegacion_id
      left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
     where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  -- La última revisión completada de cada vehículo. distinct on es la forma
  -- de quedarse con la fila entera de ese máximo, no solo con la fecha.
  ult as (
    select distinct on (r.vehiculo_id)
           r.vehiculo_id, r.id as revision_id, r.fecha_revision::date as fecha, r.medido_at
      from revisiones_vehiculo r
     where r.estado_revision = 'completada'
       and (p_empresa is null or r.empresa_id = p_empresa)
     order by r.vehiculo_id, r.fecha_revision desc, r.created_at desc
  ),
  -- De esa revisión: cuántas ruedas se midieron, la peor, y si la hizo el
  -- arco o una persona. El método lo lleva cada rueda, así que se mira si
  -- TODAS son del arco: una revisión mixta no es "del arco".
  detalle as (
    select d.revision_id,
           count(*)::int as n,
           min(d.profundidad_mm) as peor,
           bool_and(d.metodo_profundidad = 'checkpoint'
                 or d.metodo_presion     = 'checkpoint') as todo_arco
      from revisiones_neumaticos_detalle d
      join ult u on u.revision_id = d.revision_id
     group by d.revision_id
  )
  select
    v.id, v.matricula, v.numero_unidad, v.base, v.tipo,
    u.fecha, u.medido_at,
    case when x.todo_arco then 'checkpoint' when u.revision_id is not null then 'tecnico' end,
    coalesce(x.n, 0), x.peor,
    case when u.fecha is not null then (current_date - u.fecha)::int end,
    v.intervalo,
    case when u.fecha is not null and v.intervalo is not null then u.fecha + v.intervalo end,
    case when u.fecha is not null and v.intervalo is not null
         then (current_date - (u.fecha + v.intervalo))::int end,
    case
      when v.intervalo is null then 'sin_intervalo'
      when u.fecha is null     then 'sin_revision'
      when current_date > u.fecha + v.intervalo then 'vencido'
      when (u.fecha + v.intervalo) - current_date <= 15 then 'proximo'
      else 'al_dia'
    end
  from veh v
  left join ult u     on u.vehiculo_id = v.id
  left join detalle x on x.revision_id = u.revision_id
  -- El rango se aplica a la fecha de la última revisión. Un vehículo sin
  -- ninguna no tiene fecha, así que solo aparece cuando no hay rango.
  where (p_desde is null or u.fecha >= p_desde)
    and (p_hasta is null or u.fecha <= p_hasta)
  -- Los que nunca se han revisado, primero: son los que más urge mirar.
  order by u.fecha asc nulls first, v.matricula;
$function$;

CREATE OR REPLACE FUNCTION public.tc_informe_ejecutivo(p_empresa uuid DEFAULT NULL::uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET jit TO 'off'
AS $function$
with veh as (
  select v.id, v.matricula,
         coalesce(v.revision_intervalo_dias, t.revision_intervalo_dias) as intervalo_dias
  from tc_vehiculos v
  left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
  where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)
),
-- La última revisión COMPLETADA de cada vehículo, sin mirar el periodo del
-- informe: para saber si va al día importa cuándo se hizo, no desde dónde
-- se esté mirando.
ultima_rev as (
  select r.vehiculo_id, max(r.fecha_revision)::date as ultima
  from revisiones_vehiculo r
  where (p_empresa is null or r.empresa_id = p_empresa)
    and r.estado_revision = 'completada'
  group by r.vehiculo_id
),
periodicidad as (
  select
    v.id, v.matricula, v.intervalo_dias, u.ultima,
    case
      when v.intervalo_dias is null then 'sin_intervalo'
      when u.ultima is null         then 'sin_revision'
      when current_date > u.ultima + v.intervalo_dias then 'vencido'
      when (u.ultima + v.intervalo_dias) - current_date <= 15 then 'proximo'
      else 'al_dia'
    end as estado
  from veh v
  left join ultima_rev u on u.vehiculo_id = v.id
)
select public.tc_informe_ejecutivo_base(p_empresa, p_desde, p_hasta) || jsonb_build_object(
  'cobertura', jsonb_build_object(
    'total',         (select count(*) from periodicidad),
    'al_dia',        (select count(*) from periodicidad where estado = 'al_dia'),
    'proximos',      (select count(*) from periodicidad where estado = 'proximo'),
    'vencidos',      (select count(*) from periodicidad where estado = 'vencido'),
    'sin_revision',  (select count(*) from periodicidad where estado = 'sin_revision'),
    'sin_intervalo', (select count(*) from periodicidad where estado = 'sin_intervalo'),
    -- El intervalo que rige en la mayor parte de la flota, para poder
    -- escribir "al día (cada 60 días)" sin inventárselo.
    'intervalo_habitual', (
      select intervalo_dias from periodicidad
       where intervalo_dias is not null
       group by intervalo_dias order by count(*) desc, intervalo_dias limit 1),
    -- Por dónde empezar: los más pasados de fecha.
    'mas_vencidos', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'matricula', matricula, 'ultima', ultima, 'dias_vencido', dias)
             order by dias desc), '[]'::jsonb)
      from (
        select matricula, ultima, current_date - (ultima + intervalo_dias) as dias
        from periodicidad where estado = 'vencido'
        order by dias desc limit 10) x)
  )
)
$function$;

CREATE OR REPLACE FUNCTION public.tc_informe_ejecutivo_base(p_empresa uuid DEFAULT NULL::uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET jit TO 'off'
AS $function$
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
  where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)
),
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
    -- arrastraría su última medición al vehículo donde estuvo.
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
clas as (
  select t.*,
    case
      when t.profundidad_mm <= t.minmm                  then 'critico'
      when t.profundidad_mm <= t.avisomm                then 'bajo'
      when t.profundidad_mm <= t.avisomm + 2            then 'medio'
      when t.profundidad_mm <= t.avisomm + 5            then 'bueno'
      else 'excelente'
    end as nivel,
    -- Bandas del "banco de goma", CERRADAS por arriba como en el informe:
    -- "mayor de 4 mm y hasta 6 mm" = (4,6], así un 6,0 exacto cae en 4-6.
    case
      when t.profundidad_mm <=  4  then '<=4'
      when t.profundidad_mm <=  6  then '4-6'
      when t.profundidad_mm <=  8  then '6-8'
      when t.profundidad_mm <= 10  then '8-10'
      when t.profundidad_mm <= 12  then '10-12'
      else '>12'
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
-- el neumático o se corrigió una lectura.
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
-- Serie histórica del banco de goma: reparto por banda de cada mes, más
-- reesculturados y recauchutados. Cada mes cuenta SUS mediciones: la
-- columna de marzo es la foto de marzo.
evol_bandas as (
  select m.mes,
    count(d.profundidad_mm) as total,
    count(*) filter (where d.profundidad_mm <=  4) as b1,
    count(*) filter (where d.profundidad_mm >  4 and d.profundidad_mm <=  6) as b2,
    count(*) filter (where d.profundidad_mm >  6 and d.profundidad_mm <=  8) as b3,
    count(*) filter (where d.profundidad_mm >  8 and d.profundidad_mm <= 10) as b4,
    count(*) filter (where d.profundidad_mm > 10 and d.profundidad_mm <= 12) as b5,
    count(*) filter (where d.profundidad_mm > 12) as b6,
    count(*) filter (where n.reesculturado) as rees,
    count(*) filter (where mr.es_recau) as recau,
    count(*) filter (where n.reesculturado and mr.es_recau) as rees_y_recau
  from meses m
  left join revisiones_vehiculo r
    on r.estado_revision <> 'anulada'
   and r.fecha_revision between m.ini and m.fin
   and (p_empresa is null or r.empresa_id = p_empresa)
  left join revisiones_neumaticos_detalle d
    on d.revision_id = r.id and d.profundidad_mm is not null
  left join tc_neumaticos n on n.id = d.neumatico_id
  -- Recauchutado = la marca está marcada como tal en el catálogo (INSA...),
  -- mismo criterio que el informe de montaje y el asistente.
  left join lateral (
    select exists (
      select 1 from tc_cat_marcas_neumatico ma
      where ma.es_recauchutado and coalesce(ma.activo, true)
        and upper(trim(ma.nombre)) = upper(trim(coalesce(n.marca, '')))
    ) as es_recau
  ) mr on true
  group by m.mes
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

  'cabecera', jsonb_build_object(
    'vehiculos_total',     (select count(*) from veh),
    'vehiculos_revisados', (select count(distinct vehiculo_id) from revs),
    'vehiculos_pendientes',(select count(*) from veh where id not in (select vehiculo_id from revs)),
    'neumaticos_medidos',  (select count(*) from clas),
    'revisiones',          (select count(*) from revs)
  ),

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

  'niveles', (
    select coalesce(jsonb_object_agg(nivel, n), '{}'::jsonb)
    from (select nivel, count(*) as n from clas group by nivel) x),
  'bandas', (
    select coalesce(jsonb_agg(jsonb_build_object('banda', banda, 'n', n) order by orden), '[]'::jsonb)
    from (
      select banda, count(*) as n,
        case banda when '<=4' then 1 when '4-6' then 2 when '6-8' then 3
                   when '8-10' then 4 when '10-12' then 5 else 6 end as orden
      from clas group by banda) x),

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

  -- Serie histórica del banco de goma (12 meses)
  'evolucion_bandas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', mes, 'total', total,
      'bandas', jsonb_build_object(
        '<=4', b1, '4-6', b2, '6-8', b3, '8-10', b4, '10-12', b5, '>12', b6),
      'reesculturados', rees,
      'recauchutados', recau,
      'rees_y_recau', rees_y_recau) order by mes), '[]'::jsonb)
    from evol_bandas),

  'evolucion', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', mes, 'revisiones', revisiones,
      'prof_media', prof_media, 'bajo_legal', bajo_legal) order by mes), '[]'::jsonb)
    from evol),

  -- Se agrega primero y se construye el JSON después: agregar dentro de
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
$function$;

CREATE OR REPLACE FUNCTION public.tc_informe_flota_detalle(p_empresa uuid DEFAULT NULL::uuid)
 RETURNS TABLE(cliente text, matricula text, unidad text, base text, tipo text, config text, medida text, estado text, ultima_revision text, dias_desde integer, ruedas_plano bigint, ruedas_montadas bigint, ruedas_medidas bigint, profundidad_minima numeric, bajo_minimo bigint, en_aviso bigint, km_actual numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with veh as (
  select v.id, v.empresa_id, v.matricula, v.numero_unidad, v.km_actual,
         v.delegacion_id, v.tipo_vehiculo_id, v.medida_id, v.medidas_por_eje, v.config_ejes_id
    from tc_vehiculos v
   where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)
),
ultrev as (
  select distinct on (rv.vehiculo_id) rv.vehiculo_id, rv.id revision_id,
         rv.fecha_revision, rv.estado_revision
    from revisiones_vehiculo rv
   where rv.estado_revision <> 'anulada'
     and (p_empresa is null or rv.empresa_id = p_empresa)
   order by rv.vehiculo_id, rv.fecha_revision desc, rv.created_at desc
),
tyre as (
  select ur.vehiculo_id, d.profundidad_mm,
         coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm, 1.6) minmm,
         coalesce(um.profundidad_aviso_mm,  uc.profundidad_aviso_mm,  ue.profundidad_aviso_mm,  3.0) avisomm
    from ultrev ur
    join revisiones_neumaticos_detalle d on d.revision_id = ur.revision_id and d.profundidad_mm is not null
    join tc_neumaticos n on n.id = d.neumatico_id
    left join tc_config_umbrales ue on ue.empresa_id = n.empresa_id
    left join tc_cat_medidas_neumatico cm on lower(cm.valor) = lower(n.medida)
    left join tc_config_umbrales_medida um on um.empresa_id = n.empresa_id
      and regexp_replace(upper(um.medida),'\s','','g') = regexp_replace(upper(coalesce(n.medida,'')),'\s','','g')
    left join tc_config_umbrales_categoria uc on uc.empresa_id = n.empresa_id and uc.categoria = cm.categoria
),
agg as (
  select vehiculo_id, count(*) medidas, min(profundidad_mm) minimo,
         count(*) filter (where profundidad_mm <= minmm) bajo_minimo,
         count(*) filter (where profundidad_mm > minmm and profundidad_mm <= avisomm) en_aviso,
         max(case when profundidad_mm <= minmm then 3 when profundidad_mm <= avisomm then 2 else 1 end) sev
    from tyre group by vehiculo_id
)
select e.nombre cliente, v.matricula, v.numero_unidad unidad,
       del.nombre base, tv.nombre tipo, ce.nombre config,
       case when v.medidas_por_eje then 'por eje' else mn.valor end medida,
       case when ur.vehiculo_id is null then 'pendiente'
            when a.sev is null then 'revisar'
            when a.sev = 3 then 'urgente'
            when a.sev = 2 then 'revisar'
            else 'correcto' end estado,
       ur.fecha_revision::text ultima_revision,
       case when ur.fecha_revision is null then null
            else (current_date - ur.fecha_revision) end dias_desde,
       (select count(*) from tc_posiciones_vehiculo p where p.tipo_vehiculo_id = v.tipo_vehiculo_id and p.activo) ruedas_plano,
       (select count(*) from tc_montajes_actuales m where m.vehiculo_id = v.id) ruedas_montadas,
       coalesce(a.medidas,0) ruedas_medidas, a.minimo profundidad_minima,
       coalesce(a.bajo_minimo,0) bajo_minimo, coalesce(a.en_aviso,0) en_aviso,
       v.km_actual
  from veh v
  join tc_empresas e on e.id = v.empresa_id
  left join ultrev ur on ur.vehiculo_id = v.id
  left join agg a on a.vehiculo_id = v.id
  left join tc_delegaciones del on del.id = v.delegacion_id
  left join tc_tipos_vehiculo tv on tv.id = v.tipo_vehiculo_id
  left join tc_config_ejes ce on ce.id = v.config_ejes_id
  left join tc_cat_medidas_neumatico mn on mn.id = v.medida_id
 order by e.nombre, v.matricula;
$function$;

CREATE OR REPLACE FUNCTION public.tc_informes_alertas(p_empresa uuid DEFAULT NULL::uuid)
 RETURNS TABLE(tipo text, severidad text, vehiculo_id uuid, matricula text, neumatico_id uuid, codigo text, posicion text, detalle text, valor numeric)
 LANGUAGE sql
 STABLE
 SET jit TO 'off'
AS $function$
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
  where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)
    and not exists (select 1 from revisiones_vehiculo rv where rv.vehiculo_id = v.id and rv.estado_revision <> 'anulada')
  order by 2, 1;
$function$;

CREATE OR REPLACE FUNCTION public.tc_informes_economico(p_empresa uuid DEFAULT NULL::uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET jit TO 'off'
AS $function$
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
    'n_vehiculos', (select count(*) from tc_vehiculos v where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)),
    'km_flota', (select coalesce(sum(km_actual),0) from tc_vehiculos v where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)),
    'ahorro_reparaciones', (select coalesce(sum(precio_nuevo - coste),0) from reps where precio_nuevo is not null and precio_nuevo > coste)
  );
$function$;

CREATE OR REPLACE FUNCTION public.tc_informes_ranking_vehiculos(p_empresa uuid DEFAULT NULL::uuid, p_orden text DEFAULT 'coste_km'::text)
 RETURNS TABLE(vehiculo_id uuid, matricula text, km numeric, coste_total numeric, coste_km numeric, n_pinchazos bigint, n_reparaciones bigint)
 LANGUAGE sql
 STABLE
 SET jit TO 'off'
AS $function$
  with veh as (
    select v.id, v.matricula, v.km_actual from tc_vehiculos v where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)
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
$function$;

CREATE OR REPLACE FUNCTION public.tc_revision_estado()
 RETURNS TABLE(vehiculo_id uuid, ultima_revision date, intervalo_dias integer, proxima_revision date, dias_vencido integer, estado text, ultima_revision_por text, ultima_revision_origen text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with ult as (
    select distinct on (r.vehiculo_id)
           r.vehiculo_id,
           r.fecha_revision::date as ultima,
           r.tecnico_id,
           r.medido_at
      from revisiones_vehiculo r
     where r.estado_revision = 'completada'
     order by r.vehiculo_id, r.fecha_revision desc, r.created_at desc
  ),
  base as (
    select v.id as vehiculo_id,
           u.ultima,
           u.tecnico_id,
           u.medido_at,
           coalesce(v.revision_intervalo_dias, t.revision_intervalo_dias) as intervalo
    from tc_vehiculos v
    left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
    left join ult u on u.vehiculo_id = v.id
    where v.activo and v.en_seguimiento
  )
  select
    b.vehiculo_id,
    b.ultima,
    b.intervalo,
    case when b.ultima is not null and b.intervalo is not null then b.ultima + b.intervalo end,
    case when b.ultima is not null and b.intervalo is not null then current_date - (b.ultima + b.intervalo) end,
    case
      when b.ultima is null then 'sin_revision'
      when b.intervalo is null then 'al_dia'
      when current_date > b.ultima + b.intervalo then 'vencida'
      when (b.ultima + b.intervalo) - current_date <= 15 then 'proxima'
      else 'al_dia'
    end,
    us.nombre,
    case
      when b.tecnico_id is not null then 'tecnico'
      when b.medido_at is not null then 'checkpoint'
    end
  from base b
  left join tc_usuarios us on us.id = b.tecnico_id;
$function$;

CREATE OR REPLACE FUNCTION public.tc_alta_operativa_recuentos(p_empresa uuid)
 RETURNS TABLE(vehiculo_id uuid, matricula text, numero_unidad text, tipo_id uuid, tipo_nombre text, posiciones_del_tipo integer, posiciones_con_neumatico integer, posiciones_con_profundidad integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    v.id,
    v.matricula,
    v.numero_unidad,
    v.tipo_vehiculo_id,
    coalesce(t.descripcion, t.nombre),
    -- Las posiciones son del TIPO y las comparten todos sus vehículos.
    (select count(*)::int from tc_posiciones_vehiculo p
      where p.tipo_vehiculo_id = v.tipo_vehiculo_id and p.activo),
    -- Montajes VIGENTES.
    (select count(*)::int from tc_montajes_actuales m
      where m.vehiculo_id = v.id),
    -- Posiciones DISTINTAS con al menos una profundidad medida alguna vez.
    (select count(distinct d.posicion_id)::int
       from revisiones_neumaticos_detalle d
       join revisiones_vehiculo r on r.id = d.revision_id
      where d.vehiculo_id = v.id
        and d.profundidad_mm is not null
        and r.estado_revision <> 'anulada')
  from tc_vehiculos v
  left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
  where v.empresa_id = p_empresa
    and v.activo and v.en_seguimiento
    -- El permiso se comprueba aquí ADEMÁS de en el servidor: el servidor habla
    -- con service_role y no pasa por RLS.
    and tc_puede_ver_empresa(p_empresa);
$function$;

CREATE OR REPLACE FUNCTION public.tc_plan_estado()
 RETURNS TABLE(plan_id uuid, vehiculo_id uuid, empresa_id uuid, operacion_id uuid, proxima_fecha_efec date, proxima_km_efec numeric, dias_restantes integer, km_restantes numeric, estado text, prioridad text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as (
    select
      p.id, p.vehiculo_id, p.empresa_id, p.operacion_id, p.activo,
      p.margen_aviso_dias, p.prioridad_manual, p.estado_manual, p.ajuste_manual,
      v.km_actual,
      -- próxima fecha efectiva
      case
        when p.ajuste_manual then p.proxima_fecha
        when p.fecha_fija is not null then p.fecha_fija
        when p.ultima_fecha is not null and p.frecuencia_meses is not null then (p.ultima_fecha + (p.frecuencia_meses || ' months')::interval)::date
        when p.ultima_fecha is not null and p.frecuencia_dias  is not null then p.ultima_fecha + p.frecuencia_dias
        else null
      end as prox_fecha,
      -- próxima km efectiva
      case
        when p.ajuste_manual then p.proxima_km
        when p.ultima_km is not null and p.frecuencia_km is not null then p.ultima_km + p.frecuencia_km
        else null
      end as prox_km
    from tc_planes_mantenimiento p
    join tc_vehiculos v on v.id = p.vehiculo_id and v.en_seguimiento
  ),
  calc as (
    select b.*,
      case when b.prox_fecha is not null then (b.prox_fecha - current_date) end as dias_rest,
      case when b.prox_km is not null then (b.prox_km - b.km_actual) end as km_rest
    from base b
  )
  select
    c.id, c.vehiculo_id, c.empresa_id, c.operacion_id,
    c.prox_fecha, c.prox_km, c.dias_rest, c.km_rest,
    -- estado
    case
      when not c.activo then 'no_aplicable'
      when c.estado_manual is not null then c.estado_manual
      when (c.dias_rest is not null and c.dias_rest < 0) or (c.km_rest is not null and c.km_rest < 0) then 'atrasada'
      when c.dias_rest = 0 then 'vence_hoy'
      when (c.dias_rest is not null and c.dias_rest <= c.margen_aviso_dias)
           or (c.km_rest is not null and c.km_rest <= 1000) then 'proxima'
      when c.prox_fecha is null and c.prox_km is null then 'correcta'
      else 'correcta'
    end as estado,
    -- prioridad (manual > calculada)
    coalesce(c.prioridad_manual,
      case
        when not c.activo or c.estado_manual in ('cancelada','no_aplicable') then 'sin'
        when (c.dias_rest is not null and c.dias_rest < -30) then 'critica'
        when (c.dias_rest is not null and c.dias_rest < 0) then 'alta'
        when (c.dias_rest is not null and c.dias_rest <= 7) or (c.km_rest is not null and c.km_rest <= 1000) then 'media'
        else 'baja'
      end
    ) as prioridad
  from calc c;
$function$;

-- ════════════════════════════════════════════════════════════════════════
-- Y los dos informes nuevos. Éstos sí están escritos a mano porque son del
-- repositorio y el cambio es un join, no una palabra suelta.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.tc_informes_desgaste(
  p_empresa       uuid    default null,
  p_limite_mm     numeric default 1.6,     -- el mínimo legal
  p_min_km        numeric default 10000,   -- para fiarse del ritmo propio de la goma
  p_salto         numeric default 2.0,
  p_max_km_por_mm numeric default 50000
)
returns table(
  neumatico_id uuid, codigo text, marca text, modelo text, medida text,
  matricula text,
  ultima_prof numeric, ultima_fecha date,
  mm_por_1000km numeric,
  /** «neumatico» si el ritmo es suyo medido; «modelo» si es prestado. */
  origen_ritmo text,
  km_restantes numeric, fecha_prevista date,
  n_medidas bigint
)
language sql security invoker stable as $$
  with m as (
    select t.neumatico_id as nid, t.marca, t.modelo, t.medida,
           t.eje, t.fecha, t.km, t.mm, t.tramo
      from public.tc_mediciones_tramo(p_empresa, p_salto) t
     -- Montada, y en un vehículo que esté en el mantenimiento integral: a la
     -- goma de un vehículo sin seguimiento no va a ir nadie a cambiarla.
     where exists (select 1 from tc_montajes_actuales ma
                     join tc_vehiculos veh on veh.id = ma.vehiculo_id
                    where ma.neumatico_id = t.neumatico_id
                      and veh.en_seguimiento)
  ),
  -- El último tramo de cada goma es la vida que está viviendo ahora mismo.
  con_final as (
    select m.*, max(tramo) over (partition by nid) as tramo_final from m
  ),
  actual as (
    select nid, marca, modelo, medida,
           mode() within group (order by eje)                  as eje,
           count(*)                                            as n,
           max(km) - min(km)                                   as span_km,
           (max(fecha) - min(fecha))                           as dias,
           (array_agg(mm order by fecha, km))[1]               as mm_ini,
           (array_agg(mm order by fecha desc, km desc))[1]     as mm_fin,
           max(fecha)                                          as ultima_fecha,
           -- ¿Se le puede medir el ritmo a ella misma, o hay que prestárselo?
           -- Mismo criterio que el informe de km/mm, tope incluido.
           count(*) >= 3
             and max(km) - min(km) >= p_min_km
             and (array_agg(mm order by fecha, km))[1]
                 - (array_agg(mm order by fecha desc, km desc))[1] > 0
             and (max(km) - min(km))
                 / nullif((array_agg(mm order by fecha, km))[1]
                          - (array_agg(mm order by fecha desc, km desc))[1], 0)
                 <= p_max_km_por_mm                            as propio
      from con_final
     where tramo = tramo_final
     group by nid, marca, modelo, medida
  ),
  -- El ritmo de cada modelo y eje, de la misma fuente que el informe de km/mm.
  ritmo_modelo as (
    select marca, modelo, eje, sum(mm_totales) / sum(km_totales) as mm_por_km
      from public.tc_informes_km_por_mm(p_empresa, p_min_km, p_salto, p_max_km_por_mm)
     group by marca, modelo, eje
  ),
  calc as (
    select a.*,
           case when a.propio then (a.mm_ini - a.mm_fin) / a.span_km else rm.mm_por_km end as mm_por_km,
           case when a.propio then 'neumatico' else 'modelo' end                          as origen,
           case when a.dias > 0 and a.span_km > 0 then a.span_km / a.dias end as km_dia
      from actual a
      left join ritmo_modelo rm
             on rm.marca = a.marca and rm.modelo = a.modelo
            and rm.eje is not distinct from a.eje
  )
  select c.nid,
         coalesce(n.codigo_interno, n.numero_serie),
         c.marca, c.modelo, c.medida,
         v.matricula,
         c.mm_fin        as ultima_prof,
         c.ultima_fecha,
         case when c.mm_por_km > 0 then round(c.mm_por_km * 1000, 3) end as mm_por_1000km,
         case when c.mm_por_km > 0 then c.origen end                     as origen_ritmo,
         case when c.mm_por_km > 0
              then round(greatest(c.mm_fin - p_limite_mm, 0) / c.mm_por_km, 0) end as km_restantes,
         case when c.mm_por_km > 0 and c.km_dia > 0
              then c.ultima_fecha
                   + round(greatest(c.mm_fin - p_limite_mm, 0) / c.mm_por_km / c.km_dia)::int end as fecha_prevista,
         c.n
    from calc c
    join tc_neumaticos n on n.id = c.nid
    -- Una goma no debería estar montada en dos sitios; si lo estuviera, el
    -- informe no puede sacar la misma fila dos veces.
    left join lateral (
      select v.matricula from tc_montajes_actuales ma
        join tc_vehiculos v on v.id = ma.vehiculo_id
       where ma.neumatico_id = c.nid limit 1
    ) v on true
   order by 12 asc nulls last, 11 asc nulls last;
$$;

grant execute on function public.tc_informes_desgaste(uuid, numeric, numeric, numeric, numeric) to authenticated;

create or replace function public.tc_informes_sustituciones_previstas(
  p_empresa       uuid    default null,
  p_tramos        int[]   default array[30, 60, 90, 120, 180, 365],
  p_desde         date    default null,
  p_limite_mm     numeric default 1.6,
  p_min_km        numeric default 10000,
  p_salto         numeric default 2.0,
  p_max_km_por_mm numeric default 50000
)
returns table(
  medida text,
  montados bigint,
  sin_datos bigint,
  sin_fecha bigint,
  vencidos bigint,
  dias int,
  en_el_tramo bigint,
  acumulado bigint
)
language sql security invoker stable as $$
  with hoy as (select coalesce(p_desde, current_date) as d),
  -- Lo que hay montado AHORA, que es la lista de medidas de verdad.
  -- `distinct on` porque una goma en dos montajes no puede contar dos veces.
  montadas as (
    select distinct on (ma.neumatico_id)
           ma.neumatico_id as nid,
           coalesce(
             nullif(substring(upper(replace(coalesce(n.medida, ''), ' ', ''))
                              from '([0-9]{3}/[0-9]{2,3}R[0-9]{2}(\.[0-9])?)'), ''),
             '(sin medida)') as med
      from tc_montajes_actuales ma
      join tc_neumaticos n on n.id = ma.neumatico_id
      -- Mismo criterio que el informe de desgaste del que salen las fechas: si
      -- una medida solo la llevan vehículos fuera del contrato, no hay que
      -- comprarla.
      join tc_vehiculos veh on veh.id = ma.vehiculo_id and veh.en_seguimiento
     where (p_empresa is null or n.empresa_id = p_empresa)
     order by ma.neumatico_id, ma.fecha_montaje desc nulls last
  ),
  predichas as (
    select x.neumatico_id as nid, x.fecha_prevista
      from public.tc_informes_desgaste(p_empresa, p_limite_mm, p_min_km,
                                       p_salto, p_max_km_por_mm) x
  ),
  base as (
    select m.med, p.nid is not null as con_datos, p.fecha_prevista
      from montadas m
      left join predichas p on p.nid = m.nid
  ),
  por_medida as (
    select med,
           count(*)                                                      as montados,
           count(*) filter (where not con_datos)                         as sin_datos,
           count(*) filter (where con_datos and fecha_prevista is null)  as sin_fecha,
           count(*) filter (where fecha_prevista <= (select hoy.d from hoy)) as vencidos
      from base group by med
  ),
  tramos as (select unnest(p_tramos) as dias),
  hasta as (
    select p.med, t.dias,
           count(*) filter (
             where b.fecha_prevista >  (select hoy.d from hoy)
               and b.fecha_prevista <= (select hoy.d from hoy) + t.dias
           ) as acumulado_futuro
      from por_medida p
      cross join tramos t
      left join base b on b.med = p.med
     group by p.med, t.dias
  )
  select p.med, p.montados, p.sin_datos, p.sin_fecha, p.vencidos, h.dias,
         (h.acumulado_futuro
            - coalesce(lag(h.acumulado_futuro) over (partition by h.med order by h.dias), 0))::bigint
           as en_el_tramo,
         (p.vencidos + h.acumulado_futuro)::bigint as acumulado
    from hasta h
    join por_medida p on p.med = h.med
   order by p.montados desc, p.med, h.dias;
$$;

grant execute on function public.tc_informes_sustituciones_previstas(uuid, int[], date, numeric, numeric, numeric, numeric) to authenticated;
