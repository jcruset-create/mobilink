-- ============================================================
-- SEA TyreControl — Stock nuevo vs usado + devolución al desmontar
--
-- 1) movimientos_stock.condicion ('nuevo' | 'usado') → el stock usado
--    NO se mezcla con el nuevo; cada uno se cuenta por separado.
-- 2) Al montar desde almacén se puede elegir consumir stock nuevo o usado.
-- 3) Al desmontar (o sustituir) devolviendo el neumático a almacén, si
--    procede de almacén, entra +1 al stock como USADO (ubicación 'USADOS').
-- 4) RPC tc_stock_almacen_empresa: stock disponible por producto (nuevo/usado)
--    del cliente de almacén enlazado, para la ficha de empresa.
-- ============================================================

-- ── 1. Columna condición (todo lo existente queda como 'nuevo') ─────────────
alter table movimientos_stock add column if not exists condicion text not null default 'nuevo';
alter table movimientos_stock drop constraint if exists ck_mov_condicion;
alter table movimientos_stock add constraint ck_mov_condicion check (condicion in ('nuevo','usado'));

-- Permitir el origen 'almacen_usado' en los neumáticos técnicos.
alter table tc_neumaticos drop constraint if exists chk_tc_neu_origen;
alter table tc_neumaticos add constraint chk_tc_neu_origen check (
  origen is null or origen in ('almacen_generico','almacen_usado','alta_individual','carga_inicial','montaje_directo_cliente','importacion_excel','manual')
);

-- ── 2. Montar desde almacén: consume la CONDICIÓN elegida (nuevo/usado) ──────
create or replace function tc_montar_desde_almacen(
  p_vehiculo uuid, p_posicion uuid, p_producto_almacen uuid, p_control_individual boolean,
  p_datos jsonb default '{}'::jsonb, p_km numeric default null, p_fecha date default current_date, p_obs text default null,
  p_forzar_medida boolean default false, p_condicion text default 'nuevo'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_veh record; v_prod record; v_empresa uuid; v_neumatico uuid; v_montaje uuid; v_numero text;
  v_compatible boolean; v_op_id uuid;
  v_cliente_almacen uuid; v_ubicacion text; v_disponible numeric; v_prof_dibujo numeric;
begin
  if p_condicion not in ('nuevo','usado') then raise exception 'Condición de stock no válida'; end if;

  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  v_empresa := v_veh.empresa_id;

  if not (tc_is_superadmin() or (tc_is_admin() and v_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_empresa)) then
    raise exception 'Sin permiso para montar en esta empresa';
  end if;

  select * into v_prod from productos_neumaticos where id = p_producto_almacen and activo = true;
  if not found then raise exception 'Producto de almacén no encontrado'; end if;

  -- Profundidad de dibujo (neumático nuevo) desde la ficha del catálogo.
  select profundidad_dibujo_mm into v_prof_dibujo
    from tc_referencias_neumatico where id = v_prod.referencia_neumatico_id;

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

  -- Stock real del cliente de almacén enlazado, SOLO de la condición pedida.
  select cliente_almacen_id into v_cliente_almacen from tc_empresas where id = v_empresa;
  if v_cliente_almacen is null then
    raise exception 'Esta empresa no está enlazada con ningún cliente de almacén (ver TyreControl -> Enlace con almacén); no se puede descontar stock.';
  end if;

  select t.ubicacion, t.disponible into v_ubicacion, v_disponible
  from (
    select ubicacion, sum(case when tipo = 'SALIDA' then -cantidad else cantidad end) as disponible
    from movimientos_stock
    where producto_id = p_producto_almacen and cliente_id = v_cliente_almacen and condicion = p_condicion
    group by ubicacion
  ) t
  where t.disponible > 0
  order by t.disponible desc
  limit 1;

  if v_ubicacion is null then
    raise exception 'No hay stock % disponible en almacén para % % % (cliente enlazado)',
      p_condicion, v_prod.marca, coalesce(v_prod.modelo,''), v_prod.medida;
  end if;

  v_numero := tc_generar_numero_interno();

  insert into tc_neumaticos (
    empresa_id, numero_interno, codigo_interno, almacen_producto_id,
    control_individual, creado_automaticamente, origen,
    marca, modelo, medida, indice_carga, indice_velocidad,
    dot, numero_serie, rfid_epc, proveedor, profundidad_actual_mm,
    estado, vehiculo_id, posicion_id, activo
  ) values (
    v_empresa, v_numero, v_numero, p_producto_almacen,
    p_control_individual, not p_control_individual,
    case when p_condicion = 'usado' then 'almacen_usado' else 'almacen_generico' end,
    v_prod.marca, v_prod.modelo, v_prod.medida,
    case when p_control_individual then p_datos->>'indice_carga' else null end,
    case when p_control_individual then p_datos->>'indice_velocidad' else null end,
    coalesce(case when p_control_individual then p_datos->>'dot' else null end, v_prod.dot),
    case when p_control_individual then p_datos->>'numero_serie' else null end,
    case when p_control_individual then p_datos->>'rfid_epc' else null end,
    case when p_control_individual then p_datos->>'proveedor' else null end,
    -- nuevo: profundidad de dibujo de la ficha; usado: se medirá en revisión
    case when p_condicion = 'nuevo' then v_prof_dibujo else null end,
    'montado', p_vehiculo, p_posicion, true
  ) returning id into v_neumatico;

  insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, p_posicion, coalesce(p_fecha, current_date), p_km, auth.uid(), p_obs)
  returning id into v_montaje;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_destino_id, km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, 'montaje', p_posicion, v_montaje, p_km, coalesce(p_fecha, current_date),
    'almacen', 'montado', 'vehiculo', auth.uid(),
    trim(both ' ' from coalesce(p_obs,'') || case when p_condicion='usado' then ' [USADO]' else '' end))
  returning id into v_op_id;

  if not v_compatible then
    insert into autorizaciones_operaciones (empresa_id, operacion_id, tipo_autorizacion, solicitado_por, autorizado_por, motivo, estado, fecha_autorizacion)
    values (v_empresa, v_op_id, 'medida_incompatible', auth.uid(), auth.uid(),
      format('Medida %s forzada fuera de homologación para el tipo de vehículo', v_prod.medida), 'aprobada', now());
  end if;

  insert into movimientos_stock (empresa_id, cliente_id, producto_id, tipo, cantidad, ubicacion, condicion, origen_movimiento, observaciones)
  values (v_prod.empresa_id, v_cliente_almacen, p_producto_almacen, 'SALIDA', 1, v_ubicacion, p_condicion, 'montaje_tyrecontrol',
    'Montaje TyreControl (' || p_condicion || ') - neumático ' || v_numero);

  return v_neumatico;
end $$;

-- ── 3a. Devolución a stock como USADO (auxiliar) ────────────────────────────
create or replace function tc_devolver_usado_a_stock(p_neumatico uuid, p_empresa uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_neu record; v_prod record; v_cliente uuid;
begin
  select * into v_neu from tc_neumaticos where id = p_neumatico;
  if not found or v_neu.almacen_producto_id is null then return; end if; -- sin producto: no hay stock que reponer
  select cliente_almacen_id into v_cliente from tc_empresas where id = p_empresa;
  if v_cliente is null then return; end if;
  select * into v_prod from productos_neumaticos where id = v_neu.almacen_producto_id;
  if not found then return; end if;
  insert into movimientos_stock (empresa_id, cliente_id, producto_id, tipo, cantidad, ubicacion, condicion, origen_movimiento, observaciones)
  values (v_prod.empresa_id, v_cliente, v_neu.almacen_producto_id, 'ENTRADA', 1, 'USADOS', 'usado', 'desmontaje_tyrecontrol',
    'Devolución a stock (usado) - neumático ' || coalesce(v_neu.numero_interno,''));
end $$;

-- ── 3b. Desmontar: si vuelve a almacén, entra como USADO ────────────────────
create or replace function tc_desmontar_neumatico(
  p_montaje uuid, p_km numeric default null, p_motivo text default null,
  p_nuevo_estado text default 'almacen', p_obs text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare m record; v_estado_anterior text;
begin
  select * into m from tc_montajes_actuales where id = p_montaje;
  if not found then raise exception 'Montaje no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and m.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(m.empresa_id)) then
    raise exception 'Sin permiso';
  end if;
  if p_nuevo_estado not in ('almacen','reparacion','descartado') then
    raise exception 'Estado destino no válido';
  end if;

  select estado into v_estado_anterior from tc_neumaticos where id = m.neumatico_id;

  insert into tc_historial_montajes (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje,
    fecha_desmontaje, km_desmontaje, motivo_desmontaje, tecnico_montaje_id, tecnico_desmontaje_id, observaciones)
  values (m.empresa_id, m.vehiculo_id, m.neumatico_id, m.posicion_id, m.fecha_montaje, m.km_montaje,
    current_date, p_km, p_motivo, m.tecnico_id, auth.uid(), coalesce(p_obs, m.observaciones));

  update tc_neumaticos set estado = p_nuevo_estado, vehiculo_id = null, posicion_id = null,
    activo = case when p_nuevo_estado = 'descartado' then false else activo end, updated_at = now()
    where id = m.neumatico_id;
  delete from tc_montajes_actuales where id = p_montaje;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_origen_id,
    montaje_origen_id, km_vehiculo, fecha_operacion, motivo, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (m.empresa_id, m.vehiculo_id, m.neumatico_id, 'desmontaje', m.posicion_id, m.id, p_km, current_date,
    p_motivo, v_estado_anterior, p_nuevo_estado,
    case p_nuevo_estado when 'almacen' then 'almacen' when 'reparacion' then 'reparacion' else 'descarte' end,
    auth.uid(), p_obs);

  -- Devolución a stock como USADO (solo si vuelve a almacén).
  if p_nuevo_estado = 'almacen' then
    perform tc_devolver_usado_a_stock(m.neumatico_id, m.empresa_id);
  end if;
end $$;

-- ── 3c. Sustituir: el retirado, si vuelve a almacén, entra como USADO ────────
create or replace function tc_sustituir_neumatico(
  p_montaje_actual uuid, p_producto_almacen uuid, p_control_individual boolean, p_datos jsonb default '{}'::jsonb,
  p_motivo_desmontaje text default 'desgaste', p_destino_retirado text default 'almacen',
  p_km numeric default null, p_fecha date default current_date, p_obs text default null,
  p_forzar_medida boolean default false, p_condicion text default 'nuevo'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare m record; v_neumatico_nuevo uuid;
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

  -- El retirado, si vuelve a almacén, entra como USADO.
  if p_destino_retirado = 'almacen' then
    perform tc_devolver_usado_a_stock(m.neumatico_id, m.empresa_id);
  end if;

  -- Monta el nuevo (o usado) consumiendo la condición elegida.
  v_neumatico_nuevo := tc_montar_desde_almacen(m.vehiculo_id, m.posicion_id, p_producto_almacen, p_control_individual,
    p_datos, p_km, p_fecha, p_obs, p_forzar_medida, p_condicion);

  update operaciones_neumaticos set tipo_operacion = 'sustitucion'
    where neumatico_id = v_neumatico_nuevo and tipo_operacion = 'montaje' and vehiculo_id = m.vehiculo_id
      and created_at >= now() - interval '5 seconds';

  return v_neumatico_nuevo;
end $$;

-- ── 4. Stock del cliente de almacén enlazado, por producto (nuevo/usado) ─────
create or replace function tc_stock_almacen_empresa(p_empresa uuid)
returns table(producto_id uuid, marca text, modelo text, medida text, nuevo numeric, usado numeric)
language plpgsql security definer set search_path = public as $$
declare v_cliente uuid;
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;
  select cliente_almacen_id into v_cliente from tc_empresas where id = p_empresa;
  if v_cliente is null then return; end if;
  return query
  select ms.producto_id, p.marca, p.modelo, p.medida,
    sum(case when ms.condicion = 'nuevo' then (case when ms.tipo='SALIDA' then -ms.cantidad else ms.cantidad end) else 0 end)::numeric as nuevo,
    sum(case when ms.condicion = 'usado' then (case when ms.tipo='SALIDA' then -ms.cantidad else ms.cantidad end) else 0 end)::numeric as usado
  from movimientos_stock ms
  join productos_neumaticos p on p.id = ms.producto_id
  where ms.cliente_id = v_cliente
  group by ms.producto_id, p.marca, p.modelo, p.medida
  having sum(case when ms.condicion = 'nuevo' then (case when ms.tipo='SALIDA' then -ms.cantidad else ms.cantidad end) else 0 end) <> 0
      or sum(case when ms.condicion = 'usado' then (case when ms.tipo='SALIDA' then -ms.cantidad else ms.cantidad end) else 0 end) <> 0
  order by p.medida, p.marca;
end $$;
