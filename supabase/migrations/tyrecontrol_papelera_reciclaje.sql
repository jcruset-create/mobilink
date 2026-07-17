-- ============================================================
-- SEA TyreControl — Papelera de reciclaje
--
-- Al soltar en la papelera, el neumático NO se da de baja: pasa a
-- 'pendiente_reciclaje' (sigue activo), y desde el escritorio se decide
-- qué hacer (reciclar, vender, reparar…). No vuelve al stock.
-- Requiere: tyrecontrol_stock_usado.sql (tc_devolver_usado_a_stock).
-- ============================================================

-- Añadir 'pendiente_reciclaje' a los estados válidos del neumático.
alter table tc_neumaticos drop constraint if exists tc_neumaticos_estado_check;
alter table tc_neumaticos add constraint tc_neumaticos_estado_check check (estado in (
  'almacen','reservado','montado','reparacion','descartado',
  'stock_nuevo','stock_usado','stock_recauchutado','pendiente_desmontaje',
  'pendiente_reparacion','en_reparacion','pendiente_recauchutado','en_recauchutado',
  'cuarentena','pendiente_clasificacion','pendiente_validar','pendiente_reciclaje',
  'no_localizado','vendido','extraviado'
));

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
  if p_nuevo_estado not in ('almacen','reparacion','descartado','pendiente_reciclaje') then
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
    case p_nuevo_estado
      when 'almacen' then 'almacen' when 'reparacion' then 'reparacion'
      when 'pendiente_reciclaje' then 'reciclaje' else 'descarte' end,
    auth.uid(), p_obs);

  -- Solo la vuelta a almacén repone stock (como usado). Reciclaje/reparación no.
  if p_nuevo_estado = 'almacen' then
    perform tc_devolver_usado_a_stock(m.neumatico_id, m.empresa_id);
  end if;
end $$;
