-- ============================================================
-- SEA TyreControl — Fase 12: eliminar la duplicación entre
-- "ficha genérica" (tc_fichas_genericas_neumaticos, Fase 8) y el
-- catálogo real de productos del almacén (productos_neumaticos).
--
-- Antes: había que "sincronizar" productos del almacén hacia una
-- tabla copia (tc_fichas_genericas_neumaticos) para poder montarlos.
-- Ahora: se monta directamente desde productos_neumaticos (via la
-- vista tc_productos_almacen ya creada en la Fase 5b). Una sola
-- fuente de verdad para marca/modelo/medida de producto.
--
-- tc_fichas_genericas_neumaticos se deja en BD sin usar (por si hay
-- datos ya creados a mano) pero las RPC dejan de depender de ella.
-- ============================================================

create or replace function tc_montar_desde_almacen(
  p_vehiculo uuid, p_posicion uuid, p_producto_almacen uuid, p_control_individual boolean,
  p_datos jsonb default '{}'::jsonb, p_km numeric default null, p_fecha date default current_date, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_veh record; v_prod record; v_empresa uuid; v_neumatico uuid; v_montaje uuid; v_numero text;
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
    'almacen', 'montado', 'vehiculo', auth.uid(), p_obs);

  -- NOTA: descuento real de stock (movimientos_stock, salida_montaje) sigue
  -- pendiente de activar (falta resolver vehiculo_id del almacen y
  -- cliente_almacen_id por defecto — ver notas Fase 4/5a).
  return v_neumatico;
end $$;

create or replace function tc_sustituir_neumatico(
  p_montaje_actual uuid, p_producto_almacen uuid, p_control_individual boolean, p_datos jsonb default '{}'::jsonb,
  p_motivo_desmontaje text default 'desgaste', p_destino_retirado text default 'almacen',
  p_km numeric default null, p_fecha date default current_date, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m record; v_neumatico_nuevo uuid;
begin
  select * into m from tc_montajes_actuales where id = p_montaje_actual;
  if not found then raise exception 'Montaje actual no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and m.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(m.empresa_id)) then
    raise exception 'Sin permiso';
  end if;

  insert into tc_historial_montajes (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje,
    fecha_desmontaje, km_desmontaje, motivo_desmontaje, tecnico_montaje_id, tecnico_desmontaje_id, observaciones)
  values (m.empresa_id, m.vehiculo_id, m.neumatico_id, m.posicion_id, m.fecha_montaje, m.km_montaje,
    coalesce(p_fecha, current_date), p_km, p_motivo_desmontaje, m.tecnico_id, auth.uid(), coalesce(p_obs, m.observaciones));

  update tc_neumaticos set estado = p_destino_retirado, vehiculo_id = null, posicion_id = null, updated_at = now() where id = m.neumatico_id;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_origen_id,
    montaje_origen_id, km_vehiculo, fecha_operacion, motivo, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (m.empresa_id, m.vehiculo_id, m.neumatico_id, 'sustitucion', m.posicion_id, m.id, p_km, coalesce(p_fecha, current_date),
    p_motivo_desmontaje, 'montado', p_destino_retirado, p_destino_retirado, auth.uid(), p_obs);

  delete from tc_montajes_actuales where id = p_montaje_actual;

  v_neumatico_nuevo := tc_montar_desde_almacen(m.vehiculo_id, m.posicion_id, p_producto_almacen, p_control_individual, p_datos, p_km, p_fecha, p_obs);

  update operaciones_neumaticos set tipo_operacion = 'sustitucion'
    where neumatico_id = v_neumatico_nuevo and tipo_operacion = 'montaje' and vehiculo_id = m.vehiculo_id
      and created_at >= now() - interval '5 seconds';

  return v_neumatico_nuevo;
end $$;
