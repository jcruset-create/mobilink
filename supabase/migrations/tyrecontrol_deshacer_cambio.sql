-- ============================================================
-- SEA TyreControl — Deshacer la última acción de cambio de neumático
--
-- Revierte la operación de montaje/desmontaje más reciente del vehículo
-- (desde p_desde, para acotar a la sesión de cambio actual), reponiendo
-- también el stock del almacén afectado.
-- Requiere: tyrecontrol_stock_usado.sql
-- ============================================================

create or replace function tc_deshacer_ultima_operacion(p_vehiculo uuid, p_desde timestamptz)
returns text
language plpgsql security definer set search_path = public as $$
declare o record; neu record; v_cliente uuid;
begin
  select * into o from operaciones_neumaticos
    where vehiculo_id = p_vehiculo and coalesce(is_anulada, false) = false
      and tipo_operacion in ('montaje','desmontaje')
      and created_at >= p_desde
    order by created_at desc
    limit 1;
  if not found then return 'Nada que deshacer'; end if;

  if not (tc_is_superadmin() or (tc_is_admin() and o.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(o.empresa_id)) then
    raise exception 'Sin permiso';
  end if;

  select * into neu from tc_neumaticos where id = o.neumatico_id;
  select cliente_almacen_id into v_cliente from tc_empresas where id = o.empresa_id;

  if o.tipo_operacion = 'montaje' then
    -- Quitar el montaje que se acababa de hacer.
    delete from tc_montajes_actuales where neumatico_id = o.neumatico_id and vehiculo_id = o.vehiculo_id;
    -- Reponer stock: borrar la SALIDA del montaje (si vino de almacén).
    if neu.almacen_producto_id is not null and v_cliente is not null then
      delete from movimientos_stock
        where producto_id = neu.almacen_producto_id and cliente_id = v_cliente
          and origen_movimiento = 'montaje_tyrecontrol'
          and observaciones like '%' || coalesce(neu.numero_interno, '###') || '%';
    end if;
    -- El neumático se creó en el montaje → se da de baja al deshacer.
    update tc_neumaticos set estado = 'descartado', activo = false, vehiculo_id = null, posicion_id = null, updated_at = now()
      where id = o.neumatico_id;
    update operaciones_neumaticos set is_anulada = true, status = 'anulada', updated_at = now() where id = o.id;
    return 'Deshecho: montaje de ' || coalesce(neu.marca, '') || ' ' || coalesce(neu.medida, '');

  else -- desmontaje
    -- Re-montar el neumático en su posición de origen (si sigue libre).
    if o.posicion_origen_id is not null
       and not exists (select 1 from tc_montajes_actuales where vehiculo_id = o.vehiculo_id and posicion_id = o.posicion_origen_id) then
      insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id)
      values (o.empresa_id, o.vehiculo_id, o.neumatico_id, o.posicion_origen_id, current_date, o.km_vehiculo, auth.uid());
      update tc_neumaticos set estado = 'montado', vehiculo_id = o.vehiculo_id, posicion_id = o.posicion_origen_id, activo = true, updated_at = now()
        where id = o.neumatico_id;
    end if;
    -- Si el desmontaje devolvió usado a stock, quitar esa ENTRADA.
    if o.estado_nuevo = 'almacen' and neu.almacen_producto_id is not null and v_cliente is not null then
      delete from movimientos_stock
        where producto_id = neu.almacen_producto_id and cliente_id = v_cliente
          and origen_movimiento = 'desmontaje_tyrecontrol'
          and observaciones like '%' || coalesce(neu.numero_interno, '###') || '%';
    end if;
    -- Borrar el historial de desmontaje generado.
    delete from tc_historial_montajes
      where neumatico_id = o.neumatico_id and vehiculo_id = o.vehiculo_id and fecha_desmontaje = o.fecha_operacion;
    update operaciones_neumaticos set is_anulada = true, status = 'anulada', updated_at = now() where id = o.id;
    return 'Deshecho: desmontaje de ' || coalesce(neu.marca, '') || ' ' || coalesce(neu.medida, '');
  end if;
end $$;
