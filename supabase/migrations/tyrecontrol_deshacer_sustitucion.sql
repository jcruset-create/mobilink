-- ============================================================
-- Mobilink TyreControl — Deshacer una sustitución (y no mentir con el resto)
--
-- EL FALLO (visto en taller el 14-08-2026, vehículo 2222ABC)
--
-- El técnico monta ruedas nuevas sobre posiciones ocupadas, se equivoca, pulsa
-- DESHACER y la app responde «Nada que deshacer» — con el trabajo recién hecho
-- delante.
--
-- Montar sobre una posición ocupada NO es un montaje: es una sustitución.
-- tc_sustituir_neumatico escribe DOS filas y las dos acaban con
-- tipo_operacion='sustitucion' (la del retirado directamente, y la del montado
-- reetiquetada desde 'montaje', tyrecontrol_stock_usado.sql:239). Y
-- 'sustitucion' no estaba en la lista de tipos que el deshacer mira. Tampoco
-- 'descarte' ni 'reparacion', que son otros dos botones de esa pantalla.
--
-- Lo peligroso no era el mensaje. Era que el filtro se saltaba esas filas y
-- seguía buscando hacia atrás: si en la misma sesión había un montaje anterior,
-- DESHACER revertía ESE, sin avisar de que no era el que el técnico pedía.
--
-- QUÉ HACE AHORA
--
--   · Sustitución: se deshace ENTERA, las dos mitades, en el orden correcto —
--     primero se quita la rueda nueva (libera la posición) y después se vuelve
--     a montar la retirada. Al revés chocaría con unique(vehiculo, posicion).
--
--   · Al quitar la rueda nueva se distingue de dónde vino:
--       - creada por ese montaje (genérica de almacén, catálogo) → se da de
--         baja, como ya hacía el deshacer de un montaje suelto;
--       - ficha que YA existía en el almacén (usado con identidad, Decisión 1)
--         → vuelve al almacén con su profundidad y su historia.
--     Darlas de baja a todas borraría del inventario una goma real. La señal es
--     si la ficha nació con la operación: se compara created_at.
--
--   · descarte y reparacion siguen sin poder deshacerse, pero ahora se DICE:
--     «La última acción fue un descarte y no se puede deshacer desde aquí».
--     Un mensaje honesto vale más que uno tranquilizador que además revierte
--     otra cosa a tus espaldas.
--
-- Requiere: tyrecontrol_deshacer_cambio.sql (esta lo reemplaza entero).
-- Idempotente: create or replace.
-- ============================================================

create or replace function tc_deshacer_ultima_operacion(p_vehiculo uuid, p_desde timestamptz)
returns text
language plpgsql security definer set search_path = public as $func$
declare
  o record; neu record; v_cliente uuid; ma record; mb record; v_pa uuid; v_pb uuid;
  ultima record; par record; quitada record; puesta record; nueva record;
  v_creada_aqui boolean;
begin
  -- La ÚLTIMA de la sesión, sin filtrar por tipo. Antes el filtro iba dentro de
  -- la búsqueda y por eso se saltaba silenciosamente lo que no sabía deshacer.
  -- Ahora se mira primero qué fue lo último y se decide después: así nunca se
  -- revierte una operación distinta de la que el técnico acaba de hacer.
  select * into ultima from operaciones_neumaticos
    where vehiculo_id = p_vehiculo and coalesce(is_anulada, false) = false
      and created_at >= p_desde
    order by created_at desc
    limit 1;
  if not found then return 'Nada que deshacer'; end if;

  if not (tc_is_superadmin() or (tc_is_admin() and ultima.empresa_id = tc_auth_empresa_id())
          or tc_operador_ve_empresa(ultima.empresa_id)) then
    raise exception 'Sin permiso';
  end if;

  if ultima.tipo_operacion not in
     ('montaje','desmontaje','intercambio','cambio_posicion','permutacion','plan_trabajo','sustitucion') then
    return 'La última acción fue '
        || coalesce((select nombre from tc_cat_tipos_operacion where codigo = ultima.tipo_operacion),
                    ultima.tipo_operacion)
        || ' y no se puede deshacer desde aquí. Corrígelo a mano o anúlalo desde el panel.';
  end if;

  o := ultima;
  select cliente_almacen_id into v_cliente from tc_empresas where id = o.empresa_id;

  -- ── SUSTITUCIÓN: dos filas, una sola acción ────────────────────────────────
  if o.tipo_operacion = 'sustitucion' then
    -- Emparejar las dos mitades por la posición y la cercanía en el tiempo:
    -- la retirada tiene posicion_origen_id y el montaje posicion_destino_id,
    -- y son la MISMA posición. Ventana amplia (2 min) porque la escribe una
    -- sola llamada: si alguien sustituye dos veces la misma rueda en dos
    -- minutos, la más reciente es la que se deshace, que es lo que se pide.
    if o.posicion_destino_id is not null then
      puesta := o;
      select * into quitada from operaciones_neumaticos
        where vehiculo_id = o.vehiculo_id and tipo_operacion = 'sustitucion'
          and coalesce(is_anulada, false) = false
          and posicion_origen_id = o.posicion_destino_id
          and created_at between o.created_at - interval '2 minutes' and o.created_at
        order by created_at desc limit 1;
    else
      quitada := o;
      select * into puesta from operaciones_neumaticos
        where vehiculo_id = o.vehiculo_id and tipo_operacion = 'sustitucion'
          and coalesce(is_anulada, false) = false
          and posicion_destino_id = o.posicion_origen_id
          and created_at between o.created_at and o.created_at + interval '2 minutes'
        order by created_at asc limit 1;
    end if;

    -- 1) Quitar la rueda nueva. Primero, para dejar la posición libre.
    if puesta.id is not null then
      select * into nueva from tc_neumaticos where id = puesta.neumatico_id;
      delete from tc_montajes_actuales
        where neumatico_id = puesta.neumatico_id and vehiculo_id = puesta.vehiculo_id;

      -- Reponer el stock: borrar la SALIDA que generó el montaje.
      if nueva.almacen_producto_id is not null and v_cliente is not null then
        delete from movimientos_stock
          where producto_id = nueva.almacen_producto_id and cliente_id = v_cliente
            and origen_movimiento = 'montaje_tyrecontrol'
            and observaciones like '%' || coalesce(nueva.numero_interno, '###') || '%';
      end if;

      -- ¿La ficha nació con este montaje o ya estaba en el almacén?
      v_creada_aqui := nueva.created_at >= puesta.created_at - interval '1 minute';
      if v_creada_aqui then
        update tc_neumaticos
           set estado = 'descartado', activo = false, vehiculo_id = null, posicion_id = null, updated_at = now()
         where id = puesta.neumatico_id;
      else
        -- Usado con identidad: vuelve al almacén tal y como estaba.
        update tc_neumaticos
           set estado = 'almacen', vehiculo_id = null, posicion_id = null, activo = true, updated_at = now()
         where id = puesta.neumatico_id;
      end if;

      delete from tc_historial_montajes
        where neumatico_id = puesta.neumatico_id and vehiculo_id = puesta.vehiculo_id
          and fecha_desmontaje is null;
      update operaciones_neumaticos set is_anulada = true, status = 'anulada', updated_at = now()
       where id = puesta.id;
    end if;

    -- 2) Volver a montar la retirada en su posición.
    if quitada.id is not null then
      if quitada.posicion_origen_id is not null
         and not exists (select 1 from tc_montajes_actuales
                          where vehiculo_id = quitada.vehiculo_id and posicion_id = quitada.posicion_origen_id) then
        insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id)
        values (quitada.empresa_id, quitada.vehiculo_id, quitada.neumatico_id, quitada.posicion_origen_id,
                current_date, quitada.km_vehiculo, auth.uid());
        update tc_neumaticos
           set estado = 'montado', vehiculo_id = quitada.vehiculo_id, posicion_id = quitada.posicion_origen_id,
               activo = true, updated_at = now()
         where id = quitada.neumatico_id;
        -- El cierre del historial que escribió la sustitución sobra.
        delete from tc_historial_montajes
          where neumatico_id = quitada.neumatico_id and vehiculo_id = quitada.vehiculo_id
            and fecha_desmontaje is not null
            and id = (select id from tc_historial_montajes
                       where neumatico_id = quitada.neumatico_id and vehiculo_id = quitada.vehiculo_id
                         and fecha_desmontaje is not null
                       order by id desc limit 1);
      else
        return 'La rueda nueva se ha quitado, pero la posición está ocupada y no se ha podido devolver la anterior. Revísalo a mano.';
      end if;
      update operaciones_neumaticos set is_anulada = true, status = 'anulada', updated_at = now()
       where id = quitada.id;
    end if;

    select * into neu from tc_neumaticos where id = coalesce(quitada.neumatico_id, puesta.neumatico_id);
    return 'Deshecha: sustitución. Vuelve a estar montada la ' ||
           coalesce(neu.marca, '') || ' ' || coalesce(neu.medida, '');
  end if;

  -- ── Resto de tipos: igual que antes ────────────────────────────────────────
  select * into neu from tc_neumaticos where id = o.neumatico_id;

  -- Plan de trabajo: se revierte el parte ENTERO. Cada movimiento guardó su
  -- estado previo en estado_anterior ('mm:...' o 'girado:...').
  if o.tipo_operacion = 'plan_trabajo' then
    update tc_montajes_actuales set posicion_id = null
     where vehiculo_id = o.vehiculo_id
       and neumatico_id in (select mv.neumatico_id from tc_operacion_movimientos mv
                             where mv.operacion_id = o.id and mv.movimiento_tipo = 'cambio_posicion');
    update tc_montajes_actuales m set posicion_id = mv.origen_posicion_id
      from tc_operacion_movimientos mv
     where mv.operacion_id = o.id and mv.movimiento_tipo = 'cambio_posicion'
       and m.neumatico_id = mv.neumatico_id and m.vehiculo_id = o.vehiculo_id;
    update tc_neumaticos n set posicion_id = mv.origen_posicion_id, updated_at = now()
      from tc_operacion_movimientos mv
     where mv.operacion_id = o.id and mv.movimiento_tipo = 'cambio_posicion' and n.id = mv.neumatico_id;

    update tc_neumaticos n
       set profundidad_actual_mm = nullif(replace(mv.estado_anterior, 'mm:', ''), '')::numeric,
           reesculturado = false, updated_at = now()
      from tc_operacion_movimientos mv
     where mv.operacion_id = o.id and mv.movimiento_tipo = 'reescultura' and n.id = mv.neumatico_id;

    update tc_neumaticos n
       set girado_en_llanta = (replace(mv.estado_anterior, 'girado:', '') = 'true'), updated_at = now()
      from tc_operacion_movimientos mv
     where mv.operacion_id = o.id and mv.movimiento_tipo = 'giro' and n.id = mv.neumatico_id;

    update operaciones_neumaticos set is_anulada = true, status = 'anulada', updated_at = now() where id = o.id;
    return 'Deshecho: plan de trabajo de '
        || (select count(*) from tc_operacion_movimientos where operacion_id = o.id) || ' accion(es)';

  elsif o.tipo_operacion = 'permutacion' then
    update tc_montajes_actuales set posicion_id = null
     where vehiculo_id = o.vehiculo_id
       and neumatico_id in (select mv.neumatico_id from tc_operacion_movimientos mv where mv.operacion_id = o.id);
    update tc_montajes_actuales m set posicion_id = mv.origen_posicion_id
      from tc_operacion_movimientos mv
     where mv.operacion_id = o.id and m.neumatico_id = mv.neumatico_id and m.vehiculo_id = o.vehiculo_id;
    update tc_neumaticos n set posicion_id = mv.origen_posicion_id, updated_at = now()
      from tc_operacion_movimientos mv
     where mv.operacion_id = o.id and n.id = mv.neumatico_id;
    update operaciones_neumaticos set is_anulada = true, status = 'anulada', updated_at = now() where id = o.id;
    return 'Deshecha: permutacion de '
        || (select count(*) from tc_operacion_movimientos where operacion_id = o.id) || ' ruedas';

  elsif o.tipo_operacion = 'intercambio' then
    select * into ma from tc_montajes_actuales where id = o.montaje_origen_id;
    if not found then return 'No se puede deshacer: el montaje ya no existe'; end if;
    select * into mb from tc_montajes_actuales where id = o.montaje_destino_id;
    if not found then return 'No se puede deshacer: el montaje ya no existe'; end if;
    v_pa := ma.posicion_id; v_pb := mb.posicion_id;
    update tc_montajes_actuales set posicion_id = null where id = ma.id;
    update tc_montajes_actuales set posicion_id = v_pa where id = mb.id;
    update tc_montajes_actuales set posicion_id = v_pb where id = ma.id;
    update tc_neumaticos set posicion_id = v_pb, updated_at = now() where id = ma.neumatico_id;
    update tc_neumaticos set posicion_id = v_pa, updated_at = now() where id = mb.neumatico_id;
    update operaciones_neumaticos set is_anulada = true, status = 'anulada', updated_at = now() where id = o.id;
    return 'Deshecha: permuta de neumáticos';

  elsif o.tipo_operacion = 'cambio_posicion' then
    select * into ma from tc_montajes_actuales where id = o.montaje_origen_id;
    if not found then return 'No se puede deshacer: el montaje ya no existe'; end if;
    if o.posicion_origen_id is null then return 'No se puede deshacer: falta la posición de origen'; end if;
    if exists (select 1 from tc_montajes_actuales
                 where vehiculo_id = o.vehiculo_id and posicion_id = o.posicion_origen_id) then
      raise exception 'La posición de origen ya está ocupada: deshaz antes el último movimiento';
    end if;
    update tc_montajes_actuales set posicion_id = o.posicion_origen_id where id = ma.id;
    update tc_neumaticos set posicion_id = o.posicion_origen_id, updated_at = now() where id = ma.neumatico_id;
    update operaciones_neumaticos set is_anulada = true, status = 'anulada', updated_at = now() where id = o.id;
    return 'Deshecho: cambio de posición';

  elsif o.tipo_operacion = 'montaje' then
    delete from tc_montajes_actuales where neumatico_id = o.neumatico_id and vehiculo_id = o.vehiculo_id;
    if neu.almacen_producto_id is not null and v_cliente is not null then
      delete from movimientos_stock
        where producto_id = neu.almacen_producto_id and cliente_id = v_cliente
          and origen_movimiento = 'montaje_tyrecontrol'
          and observaciones like '%' || coalesce(neu.numero_interno, '###') || '%';
    end if;
    -- Misma distinción que en la sustitución: una ficha que ya estaba en el
    -- almacén no se da de baja, vuelve al almacén.
    if neu.created_at >= o.created_at - interval '1 minute' then
      update tc_neumaticos set estado = 'descartado', activo = false, vehiculo_id = null, posicion_id = null, updated_at = now()
        where id = o.neumatico_id;
    else
      update tc_neumaticos set estado = 'almacen', vehiculo_id = null, posicion_id = null, activo = true, updated_at = now()
        where id = o.neumatico_id;
    end if;
    update operaciones_neumaticos set is_anulada = true, status = 'anulada', updated_at = now() where id = o.id;
    return 'Deshecho: montaje de ' || coalesce(neu.marca, '') || ' ' || coalesce(neu.medida, '');

  else -- desmontaje
    if o.posicion_origen_id is not null
       and not exists (select 1 from tc_montajes_actuales where vehiculo_id = o.vehiculo_id and posicion_id = o.posicion_origen_id) then
      insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id)
      values (o.empresa_id, o.vehiculo_id, o.neumatico_id, o.posicion_origen_id, current_date, o.km_vehiculo, auth.uid());
      update tc_neumaticos set estado = 'montado', vehiculo_id = o.vehiculo_id, posicion_id = o.posicion_origen_id, activo = true, updated_at = now()
        where id = o.neumatico_id;
    end if;
    if neu.almacen_producto_id is not null and v_cliente is not null then
      delete from movimientos_stock
        where producto_id = neu.almacen_producto_id and cliente_id = v_cliente
          and origen_movimiento = 'desmontaje_tyrecontrol'
          and observaciones like '%' || coalesce(neu.numero_interno, '###') || '%';
    end if;
    update operaciones_neumaticos set is_anulada = true, status = 'anulada', updated_at = now() where id = o.id;
    return 'Deshecho: desmontaje de ' || coalesce(neu.marca, '') || ' ' || coalesce(neu.medida, '');
  end if;
end $func$;

comment on function tc_deshacer_ultima_operacion(uuid, timestamptz) is
  'Revierte la última acción de la sesión sobre el vehículo. La sustitución se '
  'deshace entera (las dos filas). Lo que no se sabe deshacer se dice, en vez '
  'de revertir en silencio una operación anterior.';

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where proname = 'tc_deshacer_ultima_operacion';

  -- La sustitución tiene que estar contemplada: es el fallo que cierra esto.
  if v_src not like '%sustitucion%' then
    raise exception 'El deshacer sigue sin contemplar la sustitución';
  end if;

  -- Y la búsqueda NO puede volver a filtrar por tipo: ahí estaba el peligro de
  -- revertir en silencio una operación que no era la última.
  if v_src like '%and tipo_operacion in (%order by created_at desc%' then
    raise exception 'La búsqueda vuelve a filtrar por tipo: podría deshacer una operación anterior sin avisar';
  end if;

  raise notice 'OK: el deshacer cubre la sustitución y avisa de lo que no puede deshacer';
end $$;
