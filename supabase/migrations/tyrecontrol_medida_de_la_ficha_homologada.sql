-- La medida que la ficha del vehículo pone en un eje cuenta como homologada
-- para las posiciones de ese eje.
--
-- Hasta ahora el montaje solo miraba la lista de medidas del TIPO de vehículo
-- (tc_medidas_tipo_vehiculo). El 5751GHW (camion_2_ejes) lleva 385/65R22.5 en
-- el eje 1 según su ficha, pero el tipo no tiene esa medida: al informar las
-- gomas que ya llevaba, el eje 1 se rechazaba con «MEDIDA_INCOMPATIBLE». Lo
-- mismo pasó con el 7764KMB (315/70R22.5 en autobus), que se arregló a mano
-- añadiendo la medida al tipo.
--
-- Ahora: si la medida coincide (sin índices) con la del eje de esa posición en
-- tc_vehiculo_ejes, vale. Si no, se sigue mirando la lista del tipo como antes.
--
-- 1. Función nueva tc_medida_compatible_en(vehículo, posición, medida).
-- 2. tc_montar_neumatico, tc_montar_desde_almacen y tc_montar_desde_catalogo
--    cambian SOLO la llamada a tc_medida_compatible por la nueva. Se reescriben
--    desde su definición actual (pg_get_functiondef), así que no se pisa nada
--    más de su cuerpo.
--
-- No toca tc_vehiculo_ejes, config_ejes_id, tc_montajes_actuales,
-- tc_neumaticos ni km_actual: solo funciones. Idempotente.

create or replace function public.tc_medida_compatible_en(p_vehiculo uuid, p_posicion uuid, p_medida text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    p_medida is null
    or exists (
      select 1
        from tc_posiciones_vehiculo p
        join tc_vehiculo_ejes e on e.vehiculo_id = p_vehiculo and e.eje = p.eje
        join tc_cat_medidas_neumatico m on m.id = e.medida_id
       where p.id = p_posicion
         and tc_medida_base(m.valor) = tc_medida_base(p_medida)
    )
    or tc_medida_compatible((select tipo_vehiculo_id from tc_vehiculos where id = p_vehiculo), p_medida)
$$;

revoke all on function public.tc_medida_compatible_en(uuid, uuid, text) from public, anon;
grant execute on function public.tc_medida_compatible_en(uuid, uuid, text) to authenticated, service_role;

do $migracion$
declare
  r record;
  v_def text;
  v_nueva text;
  v_cambiadas int := 0;
  v_ya int := 0;
begin
  for r in
    select * from (values
      ('tc_montar_neumatico(uuid,uuid,uuid,numeric,date,text,boolean)',
       'tc_medida_compatible(v_veh.tipo_vehiculo_id, v_neu.medida)',
       'tc_medida_compatible_en(p_vehiculo, p_posicion, v_neu.medida)'),
      ('tc_montar_desde_almacen(uuid,uuid,uuid,boolean,jsonb,numeric,date,text,boolean,text)',
       'tc_medida_compatible(v_veh.tipo_vehiculo_id, v_prod.medida)',
       'tc_medida_compatible_en(p_vehiculo, p_posicion, v_prod.medida)'),
      ('tc_montar_desde_catalogo(uuid,uuid,uuid,boolean,jsonb,numeric,date,text,boolean,text,uuid,text,text)',
       'tc_medida_compatible(v_veh.tipo_vehiculo_id, v_ref.medida)',
       'tc_medida_compatible_en(p_vehiculo, p_posicion, v_ref.medida)')
    ) as t(firma, antes, despues)
  loop
    if to_regprocedure(r.firma) is null then
      raise exception 'No existe la función %', r.firma;
    end if;
    v_def := pg_get_functiondef(to_regprocedure(r.firma));
    if position(r.despues in v_def) > 0 and position(r.antes in v_def) = 0 then
      v_ya := v_ya + 1;
      continue;
    end if;
    if (length(v_def) - length(replace(v_def, r.antes, ''))) / length(r.antes) <> 1 then
      raise exception 'En % la comprobación de medida no está como se esperaba: no se cambia nada', r.firma;
    end if;
    v_nueva := replace(v_def, r.antes, r.despues);
    execute v_nueva;
    v_cambiadas := v_cambiadas + 1;
  end loop;

  -- Autocomprobación: ninguna de las tres sigue llamando a la versión por tipo.
  if exists (
    select 1 from pg_proc
     where oid in (
       to_regprocedure('tc_montar_neumatico(uuid,uuid,uuid,numeric,date,text,boolean)'),
       to_regprocedure('tc_montar_desde_almacen(uuid,uuid,uuid,boolean,jsonb,numeric,date,text,boolean,text)'),
       to_regprocedure('tc_montar_desde_catalogo(uuid,uuid,uuid,boolean,jsonb,numeric,date,text,boolean,text,uuid,text,text)'))
       and (prosrc like '%tc_medida_compatible(v_veh.%' or prosrc not like '%tc_medida_compatible_en(p_vehiculo, p_posicion,%')
  ) then
    raise exception 'Alguna función de montaje no ha quedado con la comprobación nueva';
  end if;

  perform set_config('mobilink.resultado',
    format('OK: %s funciones de montaje cambiadas, %s ya lo estaban. La medida del eje en la ficha del vehículo cuenta como homologada.',
           v_cambiadas, v_ya), false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
