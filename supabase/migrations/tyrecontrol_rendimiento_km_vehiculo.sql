-- Rendimiento de neumáticos: el km del vehículo no es solo su km_actual.
--
-- En 5159NCK y 3915NBG (cargados del Excel) km_actual = 0, pero sus
-- revisiones marcan 17.343 y 34.157 km y Movertis da el odómetro de cada mes.
-- tc_rendimiento_datos() devolvía km_actual a secas y el seguimiento decía
-- «Aún no ha recorrido kilómetros» para gomas de origen con 17.000 km.
--
-- Único cambio: 'km_actual_vehiculo' = el mayor entre km_actual, la última
-- revisión con km y el último odómetro mensual sincronizado. El resto de la
-- función, igual. No toca tc_vehiculos.km_actual (ni nada más). Idempotente.

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
    'recauchutado', n.recauchutado, 'reesculturado', n.reesculturado,
    'profundidad_actual_mm', n.profundidad_actual_mm,
    'km_vehiculo_inicio', coalesce(i.km_vehiculo_inicio, case when s.desde_origen then 0 else ma.km_montaje end),
    'profundidad_inicial_mm', coalesce(i.profundidad_inicial_mm, tc_profundidad_origen_neumatico(n.id)),
    'fuente_inicio', coalesce(i.fuente, 'catalogo'),
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
  where s.activo
    and (p_vehiculo is null or v.id = p_vehiculo)
    and (p_empresa is null or v.empresa_id = p_empresa)
    and (tc_is_superadmin() or v.empresa_id = tc_auth_empresa_id() or tc_operador_ve_empresa(v.empresa_id))
$function$;

do $migracion$
begin
  if (select prosrc from pg_proc where proname = 'tc_rendimiento_datos') not like '%final_odometer_km%' then
    raise exception 'tc_rendimiento_datos no se ha actualizado';
  end if;
  perform set_config('mobilink.resultado', 'OK: rendimiento con el km real del vehículo', false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
