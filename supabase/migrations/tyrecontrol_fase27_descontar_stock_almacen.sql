-- ============================================================
-- SEA TyreControl — Fase 27: al montar un neumático "desde almacén"
-- (tc_montar_desde_almacen, usada también por tc_sustituir_neumatico),
-- se descuenta de verdad 1 unidad del stock real del almacén
-- (movimientos_stock), igual que hace la pantalla Salidas/Montajes.
-- Si no hay stock disponible para ese producto en el cliente de
-- almacén enlazado, se bloquea el montaje (no se permite "vender"
-- stock fantasma).
-- ============================================================

create or replace function tc_montar_desde_almacen(
  p_vehiculo uuid, p_posicion uuid, p_producto_almacen uuid, p_control_individual boolean,
  p_datos jsonb default '{}'::jsonb, p_km numeric default null, p_fecha date default current_date, p_obs text default null,
  p_forzar_medida boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_veh record; v_prod record; v_empresa uuid; v_neumatico uuid; v_montaje uuid; v_numero text;
  v_compatible boolean; v_op_id uuid;
  v_cliente_almacen uuid; v_ubicacion text; v_disponible numeric;
begin
  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  v_empresa := v_veh.empresa_id;

  if not (tc_is_superadmin() or (tc_is_admin() and v_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_empresa)) then
    raise exception 'Sin permiso para montar en esta empresa';
  end if;

  select * into v_prod from productos_neumaticos where id = p_producto_almacen and activo = true;
  if not found then raise exception 'Producto de almacén no encontrado'; end if;

  if v_veh.tipo_vehiculo_id is null or not exists (
     select 1 from tc_posiciones_vehiculo where id = p_posicion and tipo_vehiculo_id = v_veh.tipo_vehiculo_id) then
     raise exception 'La posición no corresponde al tipo del vehículo';
  end if;
  if exists (select 1 from tc_montajes_actuales where vehiculo_id = p_vehiculo and posicion_id = p_posicion) then
    raise exception 'La posición ya tiene un neumático montado';
  end if;

  v_compatible := tc_medida_compatible(v_veh.tipo_vehiculo_id, v_prod.medida);
  if not v_compatible then
    if not p_forzar_medida then
      raise exception 'MEDIDA_INCOMPATIBLE: % no está homologada para este tipo de vehículo', v_prod.medida;
    end if;
    if not (tc_is_superadmin() or tc_is_admin()) then
      raise exception 'Solo un administrador puede forzar el montaje de una medida no homologada';
    end if;
  end if;

  -- ── Stock real del almacén: la empresa debe estar enlazada con un ─
  -- cliente de almacén, y ese cliente debe tener stock del producto.
  -- Se descuenta de la ubicación con más unidades disponibles.
  select cliente_almacen_id into v_cliente_almacen from tc_empresas where id = v_empresa;
  if v_cliente_almacen is null then
    raise exception 'Esta empresa no está enlazada con ningún cliente de almacén (ver TyreControl -> Enlace con almacén); no se puede descontar stock.';
  end if;

  select t.ubicacion, t.disponible into v_ubicacion, v_disponible
  from (
    select ubicacion, sum(case when tipo = 'SALIDA' then -cantidad else cantidad end) as disponible
    from movimientos_stock
    where producto_id = p_producto_almacen and cliente_id = v_cliente_almacen
    group by ubicacion
  ) t
  where t.disponible > 0
  order by t.disponible desc
  limit 1;

  if v_ubicacion is null then
    raise exception 'No hay stock disponible en almacén para % % % (cliente enlazado)', v_prod.marca, v_prod.modelo, v_prod.medida;
  end if;

  v_numero := tc_generar_numero_interno();

  insert into tc_neumaticos (
    empresa_id, numero_interno, codigo_interno, almacen_producto_id,
    control_individual, creado_automaticamente, origen,
    marca, modelo, medida, indice_carga, indice_velocidad,
    dot, numero_serie, rfid_epc, proveedor,
    estado, vehiculo_id, posicion_id, activo
  ) values (
    v_empresa, v_numero, v_numero, p_producto_almacen,
    p_control_individual, not p_control_individual, 'almacen_generico',
    v_prod.marca, v_prod.modelo, v_prod.medida,
    case when p_control_individual then p_datos->>'indice_carga' else null end,
    case when p_control_individual then p_datos->>'indice_velocidad' else null end,
    coalesce(case when p_control_individual then p_datos->>'dot' else null end, v_prod.dot),
    case when p_control_individual then p_datos->>'numero_serie' else null end,
    case when p_control_individual then p_datos->>'rfid_epc' else null end,
    case when p_control_individual then p_datos->>'proveedor' else null end,
    'montado', p_vehiculo, p_posicion, true
  ) returning id into v_neumatico;

  insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, p_posicion, coalesce(p_fecha, current_date), p_km, auth.uid(), p_obs)
  returning id into v_montaje;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_destino_id, km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, 'montaje', p_posicion, v_montaje, p_km, coalesce(p_fecha, current_date),
    'almacen', 'montado', 'vehiculo', auth.uid(), p_obs)
  returning id into v_op_id;

  if not v_compatible then
    insert into autorizaciones_operaciones (empresa_id, operacion_id, tipo_autorizacion, solicitado_por, autorizado_por, motivo, estado, fecha_autorizacion)
    values (v_empresa, v_op_id, 'medida_incompatible', auth.uid(), auth.uid(),
      format('Medida %s forzada fuera de homologación para el tipo de vehículo', v_prod.medida), 'aprobada', now());
  end if;

  insert into movimientos_stock (empresa_id, cliente_id, producto_id, tipo, cantidad, ubicacion, origen_movimiento, observaciones)
  values (v_prod.empresa_id, v_cliente_almacen, p_producto_almacen, 'SALIDA', 1, v_ubicacion, 'montaje_tyrecontrol',
    'Montaje TyreControl - neumático ' || v_numero);

  return v_neumatico;
end $$;
