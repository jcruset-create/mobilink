-- ============================================================
-- SEA TyreControl — Montar desde el CATÁLOGO (sin stock de almacén)
--
-- Permite montar/sustituir eligiendo una referencia del catálogo
-- (tc_referencias_neumatico) aunque NO exista como producto de almacén.
-- No descuenta stock (no hay producto en el almacén). Si es sustitución
-- (p_montaje_actual informado) desmonta el actual y, si vuelve a almacén,
-- lo devuelve como usado. Requiere: tyrecontrol_stock_usado.sql.
-- ============================================================

-- Permitir el origen 'catalogo_sin_stock'.
alter table tc_neumaticos drop constraint if exists chk_tc_neu_origen;
alter table tc_neumaticos add constraint chk_tc_neu_origen check (
  origen is null or origen in ('almacen_generico','almacen_usado','catalogo_sin_stock','alta_individual','carga_inicial','montaje_directo_cliente','importacion_excel','manual')
);

create or replace function tc_montar_desde_catalogo(
  p_vehiculo uuid, p_posicion uuid, p_referencia uuid, p_control_individual boolean,
  p_datos jsonb default '{}'::jsonb, p_km numeric default null, p_fecha date default current_date, p_obs text default null,
  p_forzar_medida boolean default false, p_condicion text default 'nuevo',
  p_montaje_actual uuid default null, p_motivo_desmontaje text default 'desgaste', p_destino_retirado text default 'almacen'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_veh record; v_ref record; v_empresa uuid; v_neumatico uuid; v_montaje uuid; v_numero text;
  v_compatible boolean; v_op_id uuid; m record; v_ic text; v_es_sust boolean;
begin
  if p_condicion not in ('nuevo','usado') then raise exception 'Condición no válida'; end if;

  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  v_empresa := v_veh.empresa_id;
  if not (tc_is_superadmin() or (tc_is_admin() and v_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_empresa)) then
    raise exception 'Sin permiso para montar en esta empresa';
  end if;

  -- Datos de la referencia del catálogo (marca, modelo, medida, índices, dibujo).
  select r.profundidad_dibujo_mm, ts.medida as medida, ts.indice_carga_simple, ts.indice_carga_doble,
         ts.codigo_velocidad, mo.nombre as modelo_nombre, mar.nombre as marca_nombre
    into v_ref
  from tc_referencias_neumatico r
  join tyre_sizes ts on ts.id = r.tyre_size_id
  join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
  join tc_cat_marcas_neumatico mar on mar.id = mo.marca_id
  where r.id = p_referencia;
  if not found then raise exception 'Referencia de catálogo no encontrada'; end if;

  v_compatible := tc_medida_compatible(v_veh.tipo_vehiculo_id, v_ref.medida);
  if not v_compatible then
    if not p_forzar_medida then
      raise exception 'MEDIDA_INCOMPATIBLE: % no está homologada para este tipo de vehículo', v_ref.medida;
    end if;
    if not (tc_is_superadmin() or tc_is_admin()) then
      raise exception 'Solo un administrador puede forzar el montaje de una medida no homologada';
    end if;
  end if;

  -- ── Sustitución: desmontar primero el actual ──
  v_es_sust := p_montaje_actual is not null;
  if v_es_sust then
    select * into m from tc_montajes_actuales where id = p_montaje_actual;
    if not found then raise exception 'Montaje actual no encontrado'; end if;

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
    if p_destino_retirado = 'almacen' then perform tc_devolver_usado_a_stock(m.neumatico_id, m.empresa_id); end if;
  end if;

  if v_veh.tipo_vehiculo_id is null or not exists (
     select 1 from tc_posiciones_vehiculo where id = p_posicion and tipo_vehiculo_id = v_veh.tipo_vehiculo_id) then
     raise exception 'La posición no corresponde al tipo del vehículo';
  end if;
  if exists (select 1 from tc_montajes_actuales where vehiculo_id = p_vehiculo and posicion_id = p_posicion) then
    raise exception 'La posición ya tiene un neumático montado';
  end if;

  v_ic := v_ref.indice_carga_simple || case when v_ref.indice_carga_doble is not null and v_ref.indice_carga_doble <> ''
            then '/' || v_ref.indice_carga_doble else '' end;
  v_numero := tc_generar_numero_interno();

  insert into tc_neumaticos (
    empresa_id, numero_interno, codigo_interno, almacen_producto_id,
    control_individual, creado_automaticamente, origen,
    marca, modelo, medida, indice_carga, indice_velocidad,
    dot, numero_serie, rfid_epc, proveedor, profundidad_actual_mm,
    estado, vehiculo_id, posicion_id, activo
  ) values (
    v_empresa, v_numero, v_numero, null,
    p_control_individual, not p_control_individual, 'catalogo_sin_stock',
    v_ref.marca_nombre, v_ref.modelo_nombre, v_ref.medida, v_ic, v_ref.codigo_velocidad,
    case when p_control_individual then p_datos->>'dot' else null end,
    case when p_control_individual then p_datos->>'numero_serie' else null end,
    case when p_control_individual then p_datos->>'rfid_epc' else null end,
    case when p_control_individual then p_datos->>'proveedor' else null end,
    case when p_condicion = 'nuevo' then v_ref.profundidad_dibujo_mm
         else nullif(p_datos->>'profundidad_actual_mm', '')::numeric end,
    'montado', p_vehiculo, p_posicion, true
  ) returning id into v_neumatico;

  insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, p_posicion, coalesce(p_fecha, current_date), p_km, auth.uid(), p_obs)
  returning id into v_montaje;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_destino_id, km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, case when v_es_sust then 'sustitucion' else 'montaje' end, p_posicion, v_montaje,
    p_km, coalesce(p_fecha, current_date), 'catalogo', 'montado', 'vehiculo', auth.uid(),
    trim(both ' ' from coalesce(p_obs,'') || ' [CATÁLOGO' || case when p_condicion='usado' then ' · USADO' else '' end || ' · sin descuento de stock]'))
  returning id into v_op_id;

  if not v_compatible then
    insert into autorizaciones_operaciones (empresa_id, operacion_id, tipo_autorizacion, solicitado_por, autorizado_por, motivo, estado, fecha_autorizacion)
    values (v_empresa, v_op_id, 'medida_incompatible', auth.uid(), auth.uid(),
      format('Medida %s forzada fuera de homologación para el tipo de vehículo', v_ref.medida), 'aprobada', now());
  end if;

  return v_neumatico;
end $$;
