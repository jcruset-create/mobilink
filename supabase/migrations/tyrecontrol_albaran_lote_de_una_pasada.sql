-- Aplicar los albaranes de un lote entero de una vez, no vehículo a vehículo.
--
-- ── Qué se arregla ──────────────────────────────────────────────────────────
--
-- `tyrecontrol_albaran_manda_en_montajes.sql` enganchó al final del importador
-- un bucle que llamaba a `tc_aplicar_albaranes_a_montajes` UNA VEZ POR
-- VEHÍCULO del lote. Funciona, pero sale caro y se notó: la importación de
-- octubre se quedó sin tiempo.
--
-- Medido contra producción:
--
--   una llamada por vehículo   →   17 ms cada una · ~120 por lote · ~2 s
--   una sola pasada            →  411 ms para los 463 vehículos de la empresa
--
-- Cinco veces menos, y por un motivo simple: la consulta que busca el último
-- montaje importado de cada posición es la misma; lo que cambia es cuántas
-- veces se planifica y se recorre el índice.
--
-- ── Cómo ────────────────────────────────────────────────────────────────────
--
-- El cuerpo se mueve tal cual a `tc_aplicar_albaranes_a_lote`, que recibe un
-- `uuid[]` en vez de un `uuid`. La única diferencia en sesenta líneas de
-- plpgsql es el filtro:
--
--     and (p_vehiculo  is null or o.vehiculo_id = p_vehiculo)      -- antes
--     and (p_vehiculos is null or o.vehiculo_id = any(p_vehiculos)) -- ahora
--
-- `tc_aplicar_albaranes_a_montajes` se queda como envoltorio de una línea.
-- No se borra ni se le cambia la firma a propósito: la usa el script
-- `scripts/produccion/albaran-manda-aplicar.sql`, que es el registro de la
-- pasada inicial y tiene que poder volver a lanzarse tal como está escrito.
--
-- Y el nombre es NUEVO en vez de una sobrecarga con `uuid[]`: una sobrecarga
-- haría ambigua la llamada `(uuid, null, boolean)` que hace ese script, y
-- Postgres la rechazaría. Más vale un nombre más que un script que deja de
-- funcionar el día que alguien lo necesita.

create or replace function tc_aplicar_albaranes_a_lote(
  p_empresa   uuid,
  -- Los vehículos del lote. `null` = todos los de la empresa, que es lo
  -- que hace la pasada inicial desde el editor SQL.
  p_vehiculos uuid[]  default null,
  p_simular   boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fila      record;
  v_cambiadas int := 0;
  v_creadas   int := 0;
  v_iguales   int := 0;
begin
  /*
   * Sin sesión se está ejecutando desde el editor SQL con la clave de
   * servicio, que ya tiene acceso total: el guarda sobra y además impediría
   * la pasada inicial. Con sesión —la llamada desde el importador, con un
   * usuario detrás— sí se comprueba.
   */
  if auth.uid() is not null
     and not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id())) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;

  for v_fila in
    with alb as (
      -- El ÚLTIMO montaje importado de cada posición. `distinct on` con el
      -- mismo orden que el `order by`, que es como se pide el más reciente.
      select distinct on (o.vehiculo_id, o.posicion_destino_id)
             o.vehiculo_id,
             o.posicion_destino_id as posicion_id,
             o.neumatico_id,
             o.fecha_operacion::date as fecha,
             o.km_vehiculo
        from operaciones_neumaticos o
       where o.empresa_id = p_empresa
         and o.importacion_lote_id is not null
         and o.tipo_operacion = 'montaje'
         -- Sin posición no se sabe dónde iba, y sin neumático no hay qué
         -- montar: los albaranes antiguos traen montajes así y se dejan estar.
         and o.posicion_destino_id is not null
         and o.neumatico_id is not null
         and (p_vehiculos is null or o.vehiculo_id = any(p_vehiculos))
       order by o.vehiculo_id, o.posicion_destino_id,
                o.fecha_operacion desc, o.created_at desc
    )
    select a.vehiculo_id, a.posicion_id, a.neumatico_id, a.fecha, a.km_vehiculo,
           m.id           as montaje_id,
           m.neumatico_id as neu_actual
      from alb a
      left join tc_montajes_actuales m
             on m.vehiculo_id = a.vehiculo_id
            and m.posicion_id = a.posicion_id
  loop
    -- Ya está puesto lo que dice el albarán: nada que hacer.
    if v_fila.neu_actual is not distinct from v_fila.neumatico_id then
      v_iguales := v_iguales + 1;
      continue;
    end if;

    if not p_simular then
      -- 1. Lo que había, fuera. `pendiente_clasificacion` es el estado de la
      --    goma que sale y de la que nadie ha dicho todavía dónde acaba; es el
      --    que ya usan las 1.419 que están así.
      if v_fila.montaje_id is not null then
        delete from tc_montajes_actuales where id = v_fila.montaje_id;
        update tc_neumaticos
           set estado      = case when estado = 'montado'
                                  then 'pendiente_clasificacion' else estado end,
               vehiculo_id = null,
               posicion_id = null,
               updated_at  = now()
         where id = v_fila.neu_actual;
      end if;

      -- 2. Si la goma del albarán constaba montada en otro sitio, se suelta
      --    antes: una misma goma en dos posiciones es peor que un hueco.
      delete from tc_montajes_actuales where neumatico_id = v_fila.neumatico_id;

      -- 3. Y se monta, con la fecha y los km del albarán, no los de hoy.
      insert into tc_montajes_actuales
        (empresa_id, vehiculo_id, neumatico_id, posicion_id,
         fecha_montaje, km_montaje, observaciones)
      values
        (p_empresa, v_fila.vehiculo_id, v_fila.neumatico_id, v_fila.posicion_id,
         v_fila.fecha, v_fila.km_vehiculo, 'Aplicado desde albarán importado');

      update tc_neumaticos
         set estado      = 'montado',
             vehiculo_id = v_fila.vehiculo_id,
             posicion_id = v_fila.posicion_id,
             updated_at  = now()
       where id = v_fila.neumatico_id;
    end if;

    if v_fila.montaje_id is null then
      v_creadas := v_creadas + 1;
    else
      v_cambiadas := v_cambiadas + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'simulado',   p_simular,
    'cambiadas',  v_cambiadas,
    'creadas',    v_creadas,
    'ya_estaban', v_iguales);
end
$function$;

-- ── El de siempre, ahora de una línea ──────────────────────────────────────
--
-- Mismo nombre, misma firma y mismo comportamiento para quien ya lo llamaba.

create or replace function tc_aplicar_albaranes_a_montajes(
  p_empresa  uuid,
  p_vehiculo uuid    default null,
  p_simular  boolean default true
) returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select tc_aplicar_albaranes_a_lote(
           p_empresa,
           case when p_vehiculo is null then null else array[p_vehiculo] end,
           p_simular);
$function$;

comment on function tc_aplicar_albaranes_a_lote(uuid, uuid[], boolean) is
  'Pone en tc_montajes_actuales lo que diga el último montaje importado de cada posición, para una lista de vehículos o para toda la empresa. No escribe operaciones: el asiento ya es la operación del albarán. p_simular=true cuenta sin tocar nada.';
comment on function tc_aplicar_albaranes_a_montajes(uuid, uuid, boolean) is
  'Envoltorio de un solo vehículo sobre tc_aplicar_albaranes_a_lote. Se conserva porque lo usa scripts/produccion/albaran-manda-aplicar.sql.';

revoke all on function tc_aplicar_albaranes_a_lote(uuid, uuid[], boolean) from public;
grant execute on function tc_aplicar_albaranes_a_lote(uuid, uuid[], boolean) to authenticated;

-- ── Y el importador llama una vez, no una por vehículo ─────────────────────
--
-- Mismo método que la vez anterior: se lee la definición viva, se comprueba
-- que el anclaje aparece EXACTAMENTE una vez y se sustituye. Si no aparece
-- una sola vez, la migración falla y no toca nada.

do $migracion$
declare
  v_def   text;
  v_veces int;
  v_ancla constant text :=
    '      for v_id in select unnest(v_vehs) loop' || chr(10) ||
    '        perform tc_aplicar_albaranes_a_montajes(p_empresa, v_id, false);' || chr(10) ||
    '      end loop;';
  v_nuevo constant text :=
    '      -- De una vez para todo el lote: una llamada por vehículo costaba' || chr(10) ||
    '      -- 17 ms cada una y dejaba sin tiempo a la importación mensual.' || chr(10) ||
    '      perform tc_aplicar_albaranes_a_lote(p_empresa, v_vehs, false);';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tc_importar_historico';
  if v_def is null then
    raise exception 'No existe tc_importar_historico';
  end if;

  if position('tc_aplicar_albaranes_a_lote' in v_def) > 0 then
    raise notice 'tc_importar_historico ya llama al de lote, se deja';
    return;
  end if;

  v_veces := (select count(*) from regexp_matches(v_def, replace(replace(
                v_ancla, '(', '\('), ')', '\)'), 'g'));
  if v_veces <> 1 then
    raise exception 'Esperaba 1 bucle de albaranes en tc_importar_historico y hay %', v_veces;
  end if;

  execute replace(v_def, v_ancla, v_nuevo);
  raise notice 'tc_importar_historico aplica los albaranes de una sola pasada';
end
$migracion$;

-- ── Comprobación ───────────────────────────────────────────────────────────
--
-- `importador_de_lote` tiene que salir true y `importador_bucle_viejo` false.
-- La simulación tiene que devolver `ya_estaban` alto y `cambiadas`/`creadas` a
-- cero: la pasada inicial ya se aplicó, así que no debería quedar nada que
-- cambiar. Si saliera algo, es que hay albaranes importados después sin
-- aplicar, y entonces hay que mirarlo antes de lanzar nada.

select
  (select position('tc_aplicar_albaranes_a_lote' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tc_importar_historico') as importador_de_lote,
  (select position('perform tc_aplicar_albaranes_a_montajes' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tc_importar_historico') as importador_bucle_viejo,
  tc_aplicar_albaranes_a_lote(
    'a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid, null, true)           as simulacion_toda_la_empresa;
