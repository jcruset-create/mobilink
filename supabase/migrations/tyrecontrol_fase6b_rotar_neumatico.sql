-- ============================================================
-- SEA TyreControl — Fase 6b: RPC de rotación (drag & drop del
-- motor gráfico de vehículos). Mueve o intercambia neumáticos
-- entre posiciones del MISMO vehículo en una sola transacción.
-- Si la posición destino está libre: mueve.
-- Si la posición destino está ocupada: intercambia ambos.
-- No genera entradas de historial (no es un desmontaje real, solo
-- un cambio de posición) — se actualiza tc_montajes_actuales in situ.
-- ============================================================

create or replace function tc_rotar_neumatico(
  p_montaje_origen uuid, p_posicion_destino uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m_origen record;
  m_destino record;
  v_veh record;
begin
  select * into m_origen from tc_montajes_actuales where id = p_montaje_origen;
  if not found then raise exception 'Montaje de origen no encontrado'; end if;

  if not (tc_is_superadmin() or (tc_is_admin() and m_origen.empresa_id = tc_auth_empresa_id())) then
    raise exception 'Sin permiso para rotar neumáticos en esta empresa';
  end if;

  select * into v_veh from tc_vehiculos where id = m_origen.vehiculo_id;
  if not exists (
    select 1 from tc_posiciones_vehiculo where id = p_posicion_destino and tipo_vehiculo_id = v_veh.tipo_vehiculo_id
  ) then
    raise exception 'La posición destino no corresponde al tipo del vehículo';
  end if;

  if p_posicion_destino = m_origen.posicion_id then
    return; -- misma posición, no-op
  end if;

  select * into m_destino from tc_montajes_actuales
    where vehiculo_id = m_origen.vehiculo_id and posicion_id = p_posicion_destino;

  if not found then
    -- destino libre: mover
    update tc_montajes_actuales set posicion_id = p_posicion_destino where id = m_origen.id;
  else
    -- destino ocupado: intercambiar (posición temporal para saltar el unique(vehiculo_id, posicion_id))
    update tc_montajes_actuales set posicion_id = null where id = m_origen.id;
    update tc_montajes_actuales set posicion_id = m_origen.posicion_id where id = m_destino.id;
    update tc_montajes_actuales set posicion_id = p_posicion_destino where id = m_origen.id;
  end if;
end $$;

-- posicion_id debe admitir null temporalmente durante el swap de arriba.
alter table tc_montajes_actuales alter column posicion_id drop not null;
