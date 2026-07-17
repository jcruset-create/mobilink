-- ============================================================
-- SEA TyreControl — Operaciones · Fase 3
-- Cambio de posición, intercambio y correcciones (posición / montado).
-- Requiere: tyrecontrol_fase8_operaciones.sql + tyrecontrol_operaciones_fase1.sql
--
-- Diferencia clave frente a tc_rotar_neumatico:
--   · tc_cambiar_posicion  → sólo mover a posición LIBRE (tipo 'cambio_posicion')
--   · tc_intercambiar_posiciones → swap explícito de dos montajes (tipo 'intercambio')
--   · tc_corregir_posicion → corrección de dato (is_correccion=true, sin historial)
--   · tc_corregir_montado  → sustituye el neumático mal registrado por el correcto
-- Todas registran operación en operaciones_neumaticos + movimientos en
-- tc_operacion_movimientos para trazabilidad completa.
-- ============================================================

-- ── 1. Cambio de posición: mover a una posición LIBRE del mismo vehículo ─
create or replace function tc_cambiar_posicion(
  p_montaje uuid, p_posicion_destino uuid, p_km numeric default null, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare m record; v_veh record; v_origen uuid; v_op uuid;
begin
  select * into m from tc_montajes_actuales where id = p_montaje;
  if not found then raise exception 'Montaje no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and m.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(m.empresa_id)) then
    raise exception 'Sin permiso para cambiar de posición en esta empresa';
  end if;

  select * into v_veh from tc_vehiculos where id = m.vehiculo_id;
  if not exists (select 1 from tc_posiciones_vehiculo where id = p_posicion_destino and tipo_vehiculo_id = v_veh.tipo_vehiculo_id) then
    raise exception 'La posición destino no corresponde al tipo del vehículo';
  end if;
  if p_posicion_destino = m.posicion_id then raise exception 'El neumático ya está en esa posición'; end if;
  if exists (select 1 from tc_montajes_actuales where vehiculo_id = m.vehiculo_id and posicion_id = p_posicion_destino) then
    raise exception 'La posición destino está ocupada; usa Intercambio';
  end if;

  v_origen := m.posicion_id;
  update tc_montajes_actuales set posicion_id = p_posicion_destino where id = m.id;
  update tc_neumaticos set posicion_id = p_posicion_destino, updated_at = now() where id = m.neumatico_id;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_origen_id,
    posicion_destino_id, montaje_origen_id, km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (m.empresa_id, m.vehiculo_id, m.neumatico_id, 'cambio_posicion', v_origen, p_posicion_destino, m.id,
    p_km, current_date, 'montado', 'montado', 'vehiculo', auth.uid(), p_obs)
  returning id into v_op;

  insert into tc_operacion_movimientos (operacion_id, neumatico_id, movimiento_tipo, origen_vehiculo_id, origen_posicion_id,
    destino_vehiculo_id, destino_posicion_id, estado_anterior, estado_nuevo, orden)
  values (v_op, m.neumatico_id, 'cambio_posicion', m.vehiculo_id, v_origen, m.vehiculo_id, p_posicion_destino, 'montado', 'montado', 1);

  return v_op;
end $$;

-- ── 2. Intercambio: swap de dos montajes (mismo vehículo o entre vehículos) ─
create or replace function tc_intercambiar_posiciones(
  p_montaje_a uuid, p_montaje_b uuid, p_km numeric default null, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare a record; b record; v_op uuid;
begin
  if p_montaje_a = p_montaje_b then raise exception 'Selecciona dos neumáticos distintos'; end if;
  select * into a from tc_montajes_actuales where id = p_montaje_a;
  if not found then raise exception 'Montaje A no encontrado'; end if;
  select * into b from tc_montajes_actuales where id = p_montaje_b;
  if not found then raise exception 'Montaje B no encontrado'; end if;
  if a.empresa_id <> b.empresa_id then raise exception 'Los neumáticos son de empresas distintas'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and a.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(a.empresa_id)) then
    raise exception 'Sin permiso para intercambiar en esta empresa';
  end if;
  -- la posición de cada uno debe ser válida para el vehículo destino del otro
  if not exists (select 1 from tc_posiciones_vehiculo p join tc_vehiculos v on v.id = b.vehiculo_id where p.id = a.posicion_id and p.tipo_vehiculo_id = v.tipo_vehiculo_id)
     or not exists (select 1 from tc_posiciones_vehiculo p join tc_vehiculos v on v.id = a.vehiculo_id where p.id = b.posicion_id and p.tipo_vehiculo_id = v.tipo_vehiculo_id) then
    raise exception 'Las posiciones no son compatibles entre ambos vehículos';
  end if;

  -- swap con posición temporal null para no chocar con unique(vehiculo_id, posicion_id)
  update tc_montajes_actuales set posicion_id = null where id = a.id;
  update tc_montajes_actuales set vehiculo_id = a.vehiculo_id, posicion_id = a.posicion_id where id = b.id;
  update tc_montajes_actuales set vehiculo_id = b.vehiculo_id, posicion_id = b.posicion_id where id = a.id;
  update tc_neumaticos set vehiculo_id = b.vehiculo_id, posicion_id = b.posicion_id, updated_at = now() where id = a.neumatico_id;
  update tc_neumaticos set vehiculo_id = a.vehiculo_id, posicion_id = a.posicion_id, updated_at = now() where id = b.neumatico_id;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_origen_id,
    posicion_destino_id, montaje_origen_id, montaje_destino_id, km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (a.empresa_id, a.vehiculo_id, a.neumatico_id, 'intercambio', a.posicion_id, b.posicion_id, a.id, b.id,
    p_km, current_date, 'montado', 'montado', 'vehiculo', auth.uid(), p_obs)
  returning id into v_op;

  insert into tc_operacion_movimientos (operacion_id, neumatico_id, movimiento_tipo, origen_vehiculo_id, origen_posicion_id,
    destino_vehiculo_id, destino_posicion_id, estado_anterior, estado_nuevo, orden) values
    (v_op, a.neumatico_id, 'cambio_posicion', a.vehiculo_id, a.posicion_id, b.vehiculo_id, b.posicion_id, 'montado', 'montado', 1),
    (v_op, b.neumatico_id, 'cambio_posicion', b.vehiculo_id, b.posicion_id, a.vehiculo_id, a.posicion_id, 'montado', 'montado', 2);

  return v_op;
end $$;

-- ── 3. Corrección de posición (dato mal registrado, sin movimiento físico) ─
-- Sólo admin/superadmin. Mueve o intercambia in situ, marcando is_correccion.
create or replace function tc_corregir_posicion(
  p_montaje uuid, p_posicion_correcta uuid, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare m record; md record; v_veh record; v_origen uuid; v_op uuid;
begin
  select * into m from tc_montajes_actuales where id = p_montaje;
  if not found then raise exception 'Montaje no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and m.empresa_id = tc_auth_empresa_id())) then
    raise exception 'Sólo un administrador puede corregir posiciones';
  end if;

  select * into v_veh from tc_vehiculos where id = m.vehiculo_id;
  if not exists (select 1 from tc_posiciones_vehiculo where id = p_posicion_correcta and tipo_vehiculo_id = v_veh.tipo_vehiculo_id) then
    raise exception 'La posición no corresponde al tipo del vehículo';
  end if;
  if p_posicion_correcta = m.posicion_id then raise exception 'La posición ya es la indicada'; end if;
  v_origen := m.posicion_id;

  select * into md from tc_montajes_actuales where vehiculo_id = m.vehiculo_id and posicion_id = p_posicion_correcta;
  if not found then
    update tc_montajes_actuales set posicion_id = p_posicion_correcta where id = m.id;
    update tc_neumaticos set posicion_id = p_posicion_correcta, updated_at = now() where id = m.neumatico_id;
  else
    -- posición ocupada: se intercambian (corrección de un cruce de datos)
    update tc_montajes_actuales set posicion_id = null where id = m.id;
    update tc_montajes_actuales set posicion_id = v_origen where id = md.id;
    update tc_montajes_actuales set posicion_id = p_posicion_correcta where id = m.id;
    update tc_neumaticos set posicion_id = v_origen, updated_at = now() where id = md.neumatico_id;
    update tc_neumaticos set posicion_id = p_posicion_correcta, updated_at = now() where id = m.neumatico_id;
  end if;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_origen_id,
    posicion_destino_id, montaje_origen_id, km_vehiculo, fecha_operacion, motivo, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones, is_correccion)
  values (m.empresa_id, m.vehiculo_id, m.neumatico_id, 'correccion_posicion', v_origen, p_posicion_correcta, m.id,
    null, current_date, 'error_montaje', 'montado', 'montado', 'vehiculo', auth.uid(),
    coalesce(p_obs, '') || ' [CORRECCIÓN DE POSICIÓN]', true)
  returning id into v_op;

  insert into tc_operacion_movimientos (operacion_id, neumatico_id, movimiento_tipo, origen_vehiculo_id, origen_posicion_id,
    destino_vehiculo_id, destino_posicion_id, estado_anterior, estado_nuevo, orden)
  values (v_op, m.neumatico_id, 'correccion', m.vehiculo_id, v_origen, m.vehiculo_id, p_posicion_correcta, 'montado', 'montado', 1);

  return v_op;
end $$;

-- ── 4. Corrección de montado: el neumático registrado es el equivocado ──
-- Sustituye, sin desmontaje físico, el neumático del montaje por el correcto.
-- El neumático mal registrado vuelve a almacén; el correcto pasa a montado.
create or replace function tc_corregir_montado(
  p_montaje uuid, p_neumatico_correcto uuid, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare m record; v_wrong record; v_ok record; v_op uuid;
begin
  select * into m from tc_montajes_actuales where id = p_montaje;
  if not found then raise exception 'Montaje no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and m.empresa_id = tc_auth_empresa_id())) then
    raise exception 'Sólo un administrador puede corregir el neumático montado';
  end if;
  if p_neumatico_correcto = m.neumatico_id then raise exception 'El neumático indicado ya es el registrado'; end if;

  select * into v_wrong from tc_neumaticos where id = m.neumatico_id;
  select * into v_ok from tc_neumaticos where id = p_neumatico_correcto;
  if not found then raise exception 'Neumático correcto no encontrado'; end if;
  if v_ok.empresa_id <> m.empresa_id then raise exception 'El neumático correcto es de otra empresa'; end if;
  if v_ok.estado = 'montado' or exists (select 1 from tc_montajes_actuales where neumatico_id = p_neumatico_correcto) then
    raise exception 'El neumático correcto ya figura montado en otra posición';
  end if;
  if v_ok.estado = 'descartado' then raise exception 'El neumático correcto está descartado'; end if;

  -- el mal registrado vuelve a almacén (nunca estuvo realmente montado)
  update tc_neumaticos set estado = 'almacen', vehiculo_id = null, posicion_id = null, updated_at = now() where id = v_wrong.id;
  -- el correcto pasa a montado en la posición del montaje
  update tc_neumaticos set estado = 'montado', vehiculo_id = m.vehiculo_id, posicion_id = m.posicion_id, updated_at = now() where id = v_ok.id;
  update tc_montajes_actuales set neumatico_id = p_neumatico_correcto where id = m.id;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_origen_id, km_vehiculo, fecha_operacion, motivo, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones, is_correccion)
  values (m.empresa_id, m.vehiculo_id, p_neumatico_correcto, 'correccion_montado', m.posicion_id, m.id,
    null, current_date, 'error_montaje', coalesce(v_ok.estado,'almacen'), 'montado', 'vehiculo', auth.uid(),
    coalesce(p_obs, '') || ' [CORRECCIÓN DE MONTADO · sale nº ' || coalesce(v_wrong.numero_interno,'?') || ']', true)
  returning id into v_op;

  insert into tc_operacion_movimientos (operacion_id, neumatico_id, movimiento_tipo, destino_vehiculo_id, destino_posicion_id, estado_anterior, estado_nuevo, orden) values
    (v_op, v_wrong.id, 'correccion', null, null, 'montado', 'almacen', 1),
    (v_op, v_ok.id, 'correccion', m.vehiculo_id, m.posicion_id, coalesce(v_ok.estado,'almacen'), 'montado', 2);

  return v_op;
end $$;
