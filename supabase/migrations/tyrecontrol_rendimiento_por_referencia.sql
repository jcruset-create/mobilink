-- Rendimiento de neumáticos: agrupar por la referencia del catálogo.
--
-- El informe agrupaba por el texto de la goma, y «Michelin COACHZ» salía aparte
-- de «Michelin X COACH Z» aunque Depurar catálogo ya los tiene como el mismo
-- (equivalencia COACHZ / COACH / XCOACH → X COACH Z 295/80R22.5).
-- tc_rendimiento_datos() devuelve además ref_marca, ref_modelo y ref_medida de la
-- referencia (tc_referencia_de_neumatico: equivalencia o texto); la web agrupa
-- por ella cuando la hay. Incluye el km del vehículo de
-- tyrecontrol_rendimiento_km_vehiculo.sql. Resto, igual. Solo lee. Idempotente.

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

do $migracion$
begin
  if (select prosrc from pg_proc where proname = 'tc_rendimiento_datos') not like '%ref_modelo%' then
    raise exception 'tc_rendimiento_datos no se ha actualizado';
  end if;
  perform set_config('mobilink.resultado', 'OK: rendimiento agrupado por referencia del catálogo', false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
