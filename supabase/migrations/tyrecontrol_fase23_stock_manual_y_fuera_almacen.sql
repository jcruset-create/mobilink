-- ============================================================
-- SEA TyreControl — Fase 23: alta de stock manual en almacén +
-- profundidad actual al montar un neumático que ya llevaba el
-- vehículo (montaje fuera de almacén).
-- ============================================================

-- ── 1. Profundidad actual del neumático (mm) ────────────────────
-- No existía ningún campo de "cuánto dibujo le queda ahora mismo"
-- en tc_neumaticos (profundidad_dibujo_mm en tc_referencias_neumatico
-- es la profundidad DE FÁBRICA, no la actual). Se usa para registrar
-- el dato inicial de un neumático que se da de alta ya montado.
alter table tc_neumaticos add column if not exists profundidad_actual_mm numeric;

-- ── 2. tc_montar_fuera_almacen: acepta y guarda la profundidad ──
-- actual indicada al dar de alta el neumático (p_datos->>'profundidad_actual_mm')
create or replace function tc_montar_fuera_almacen(
  p_vehiculo uuid, p_posicion uuid, p_control_individual boolean, p_datos jsonb default '{}'::jsonb,
  p_motivo text default null, p_km numeric default null, p_fecha date default current_date, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_veh record; v_empresa uuid; v_usuario record; v_neumatico uuid; v_montaje uuid; v_numero text;
  v_autorizado boolean; v_operacion uuid;
begin
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio para montar un neumático fuera de almacén';
  end if;

  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  v_empresa := v_veh.empresa_id;
  select * into v_usuario from tc_usuarios where id = auth.uid();

  if v_usuario.rol = 'cliente' then raise exception 'Un cliente no puede montar neumáticos fuera de almacén'; end if;
  if not tc_puede_ver_empresa(v_empresa) then raise exception 'Sin permiso sobre esta empresa'; end if;

  v_autorizado := tc_is_superadmin() or tc_is_admin() or coalesce(v_usuario.puede_montar_fuera_almacen, false);
  if not v_autorizado then
    raise exception 'No tienes permiso para montar fuera de almacén; solicita autorización a un administrador (ver Autorizaciones)';
  end if;

  if v_veh.tipo_vehiculo_id is null or not exists (
     select 1 from tc_posiciones_vehiculo where id = p_posicion and tipo_vehiculo_id = v_veh.tipo_vehiculo_id) then
     raise exception 'La posición no corresponde al tipo del vehículo';
  end if;
  if exists (select 1 from tc_montajes_actuales where vehiculo_id = p_vehiculo and posicion_id = p_posicion) then
    raise exception 'La posición ya tiene un neumático montado';
  end if;

  v_numero := tc_generar_numero_interno();

  insert into tc_neumaticos (
    empresa_id, numero_interno, codigo_interno, control_individual, creado_automaticamente, origen,
    marca, modelo, medida, indice_carga, indice_velocidad, dot, numero_serie, rfid_epc, profundidad_actual_mm,
    estado, vehiculo_id, posicion_id, activo
  ) values (
    v_empresa, v_numero, v_numero, p_control_individual, not p_control_individual, 'montaje_directo_cliente',
    p_datos->>'marca', p_datos->>'modelo', p_datos->>'medida', p_datos->>'indice_carga', p_datos->>'indice_velocidad',
    p_datos->>'dot', p_datos->>'numero_serie', p_datos->>'rfid_epc', nullif(p_datos->>'profundidad_actual_mm', '')::numeric,
    'montado', p_vehiculo, p_posicion, true
  ) returning id into v_neumatico;

  insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, p_posicion, coalesce(p_fecha, current_date), p_km, auth.uid(), p_obs)
  returning id into v_montaje;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_destino_id, km_vehiculo, fecha_operacion, motivo, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, 'montaje', p_posicion, v_montaje, p_km, coalesce(p_fecha, current_date),
    'otro', null, 'montado', 'vehiculo', auth.uid(), coalesce(p_obs, '') || ' [FUERA DE ALMACÉN] ' || p_motivo)
  returning id into v_operacion;

  insert into autorizaciones_operaciones (empresa_id, operacion_id, tipo_autorizacion, solicitado_por, autorizado_por, motivo, estado, fecha_autorizacion)
  values (v_empresa, v_operacion, 'montaje_fuera_almacen', auth.uid(),
    case when tc_is_superadmin() or tc_is_admin() then auth.uid() else null end,
    p_motivo,
    case when tc_is_superadmin() or tc_is_admin() then 'aprobada' else 'pendiente' end,
    case when tc_is_superadmin() or tc_is_admin() then now() else null end);

  return v_neumatico;
end $$;

-- ── 3. Alta de stock manual: 6x Hankook TH31+ 385/65 R22.5 164K ──
-- para SEA Tarragona, listos para montar desde "Montajes actuales".
insert into tc_neumaticos (
  empresa_id, numero_interno, codigo_interno, control_individual, creado_automaticamente, origen,
  marca, modelo, medida, indice_carga, indice_velocidad, estado, activo
)
select e.id, g.n, g.n, false, true, 'alta_manual',
  'Hankook', 'TH31+', '385/65 R22.5', '164', 'K', 'almacen', true
from tc_empresas e
cross join generate_series(1, 6) as s(i)
cross join lateral (select tc_generar_numero_interno() as n) g
where e.nombre = 'SEA Tarragona';
