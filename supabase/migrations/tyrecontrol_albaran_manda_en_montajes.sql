-- El albarán manda: lo que diga el último montaje importado es lo que lleva
-- puesto el vehículo.
--
-- ── El agujero ──────────────────────────────────────────────────────────────
--
-- `tc_importar_historico` crea los neumáticos del albarán y sus operaciones,
-- pero NUNCA toca `tc_montajes_actuales`. Comprobado: su definición no
-- menciona esa tabla ni una vez. Así que la ficha del vehículo sigue
-- enseñando lo que hubiera antes —casi siempre el inventario inicial— mientras
-- el histórico dice otra cosa.
--
-- En esta instalación, de 325 vehículos con albaranes importados:
--
--   191  todo cuadra
--    31  el albarán es POSTERIOR al montaje de la ficha  (77 posiciones)
--   102  el albarán es anterior                          (329 posiciones)
--    11  el albarán nombra una posición sin montaje       (45 posiciones)
--
-- ── La regla elegida, y lo que cuesta ───────────────────────────────────────
--
-- El albarán manda SIEMPRE, sin mirar fechas. Es una decisión del cliente,
-- tomada con los números delante.
--
-- Conviene dejar escrito lo que implica, porque no es gratis: en 328 de las
-- 329 posiciones donde el albarán es ANTERIOR, lo que hay hoy en la ficha lo
-- puso el inventario inicial, es decir una persona que fue al vehículo y miró
-- la rueda. Y 175 de ellas llevan más de tres meses de diferencia, que se
-- explican solas: entre el albarán y el inventario se cambió la goma otra vez,
-- con un albarán que no se importó o sin él.
--
-- Con esta regla, esas 175 pasan a decir lo que decía un papel viejo en vez de
-- lo que vio una persona. Se asume a conciencia.
--
-- ── Qué NO hace ────────────────────────────────────────────────────────────
--
-- **No escribe operaciones.** El asiento ya existe: es la propia operación
-- importada del albarán. Montar con `tc_montar_neumatico` habría creado un
-- segundo «montaje» encima del que ya estaba, y el histórico del neumático
-- pasaría a contar dos veces lo que ocurrió una.
--
-- Por eso esto NO llama a los RPC de montaje normales y hace el cambio de
-- estado a mano. Es la única vez que se justifica.

create or replace function tc_aplicar_albaranes_a_montajes(
  p_empresa  uuid,
  p_vehiculo uuid    default null,
  p_simular  boolean default true
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
         and (p_vehiculo is null or o.vehiculo_id = p_vehiculo)
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

comment on function tc_aplicar_albaranes_a_montajes(uuid, uuid, boolean) is
  'Pone en tc_montajes_actuales lo que diga el último montaje importado de cada posición. No escribe operaciones: el asiento ya es la operación del albarán. p_simular=true cuenta sin tocar nada.';

revoke all on function tc_aplicar_albaranes_a_montajes(uuid, uuid, boolean) from public;
grant execute on function tc_aplicar_albaranes_a_montajes(uuid, uuid, boolean) to authenticated;

-- ── Y que las importaciones futuras lo hagan solas ──────────────────────────
--
-- Se engancha al final de `tc_importar_historico`, en la rama que aplica de
-- verdad (la de simular no toca nada), justo detrás de la reconstrucción de la
-- cronología y sobre la misma lista de vehículos del lote.
--
-- No se reescribe la función —17 KB de plpgsql— sino que se lee su definición
-- viva, se comprueba que el anclaje aparece EXACTAMENTE una vez y se sustituye.
-- Si no aparece una sola vez, la migración falla y no toca nada.

do $migracion$
declare
  v_def   text;
  v_veces int;
  v_ancla constant text :=
    'for v_id in select unnest(v_vehs) loop perform tc_imp_reconstruir_vehiculo(v_id); end loop;';
  v_nuevo constant text :=
    'for v_id in select unnest(v_vehs) loop perform tc_imp_reconstruir_vehiculo(v_id); end loop;'
    || chr(10) ||
    '      -- Y el albarán manda: el último montaje importado de cada posición' || chr(10) ||
    '      -- pasa a ser lo que el vehículo lleva puesto.' || chr(10) ||
    '      for v_id in select unnest(v_vehs) loop' || chr(10) ||
    '        perform tc_aplicar_albaranes_a_montajes(p_empresa, v_id, false);' || chr(10) ||
    '      end loop;';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tc_importar_historico';
  if v_def is null then
    raise exception 'No existe tc_importar_historico';
  end if;

  if position('tc_aplicar_albaranes_a_montajes' in v_def) > 0 then
    raise notice 'tc_importar_historico ya estaba enganchada, se deja';
    return;
  end if;

  v_veces := (select count(*) from regexp_matches(v_def, replace(replace(replace(
                v_ancla, '(', '\('), ')', '\)'), '.', '\.'), 'g'));
  if v_veces <> 1 then
    raise exception 'Esperaba 1 anclaje en tc_importar_historico y hay %', v_veces;
  end if;

  execute replace(v_def, v_ancla, v_nuevo);
  raise notice 'tc_importar_historico ahora aplica los albaranes a los montajes';
end
$migracion$;

-- ── Comprobación ────────────────────────────────────────────────────────────

select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tc_aplicar_albaranes_a_montajes') as funcion_creada,
  (select position('tc_aplicar_albaranes_a_montajes' in pg_get_functiondef(p.oid)) > 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tc_importar_historico') as importador_enganchado;
