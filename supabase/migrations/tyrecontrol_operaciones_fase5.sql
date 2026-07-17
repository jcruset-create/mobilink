-- ============================================================
-- SEA TyreControl — Operaciones · Fase 5
-- Operaciones pendientes / planificadas + ciclo de estados +
-- reservas de neumático.
-- Requiere: tyrecontrol_operaciones_fase1.sql
-- ============================================================

-- ── Trigger: registra en el historial cada cambio de status ───
create or replace function tc_op_log_estado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into tc_operacion_estado_historial (operacion_id, estado_anterior, estado_nuevo, cambiado_por)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_op_log_estado on operaciones_neumaticos;
create trigger trg_op_log_estado after update on operaciones_neumaticos
  for each row execute function tc_op_log_estado();

-- ── Planificar una operación (queda pendiente, no se ejecuta) ──
-- Crea la operación con status 'pendiente'/'planificada'. La ejecución
-- física (montaje/desmontaje/…) la hará el RPC correspondiente cuando
-- se marque como completada desde la app o el escritorio.
create or replace function tc_planificar_operacion(
  p_empresa uuid,
  p_tipo_operacion text,
  p_vehiculo uuid default null,
  p_neumatico uuid default null,
  p_posicion_destino uuid default null,
  p_fecha_prevista date default null,
  p_prioridad text default 'normal',
  p_motivo text default null,
  p_tecnico uuid default null,
  p_obs text default null,
  p_reservar boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_op uuid; v_status text;
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso para planificar operaciones en esta empresa';
  end if;
  v_status := case when p_fecha_prevista is not null or p_tecnico is not null then 'planificada' else 'pendiente' end;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    fecha_operacion, fecha_prevista, prioridad, motivo, tecnico_id, assigned_by, observaciones, status)
  values (p_empresa, p_vehiculo, p_neumatico, p_tipo_operacion, p_posicion_destino,
    current_date, p_fecha_prevista, coalesce(p_prioridad,'normal'), p_motivo, p_tecnico,
    case when p_tecnico is not null then auth.uid() else null end, p_obs, v_status)
  returning id into v_op;

  if p_reservar and p_neumatico is not null then
    perform tc_reservar_neumatico(p_neumatico, v_op, p_vehiculo, p_posicion_destino, p_fecha_prevista);
  end if;

  return v_op;
end $$;

-- ── Cambiar el estado de una operación (asignar/iniciar/…) ─────
create or replace function tc_cambiar_estado_operacion(
  p_operacion uuid, p_nuevo_estado text, p_tecnico uuid default null, p_motivo text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from operaciones_neumaticos where id = p_operacion;
  if not found then raise exception 'Operación no encontrada'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and o.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(o.empresa_id)) then
    raise exception 'Sin permiso sobre esta operación';
  end if;
  if p_nuevo_estado not in ('borrador','pendiente','planificada','asignada','en_proceso','pausada','completada','cancelada','no_realizada','anulada') then
    raise exception 'Estado no válido';
  end if;

  update operaciones_neumaticos set
    status = p_nuevo_estado,
    tecnico_id = coalesce(p_tecnico, tecnico_id),
    assigned_by = case when p_nuevo_estado = 'asignada' then auth.uid() else assigned_by end,
    started_at = case when p_nuevo_estado = 'en_proceso' and started_at is null then now() else started_at end,
    completed_at = case when p_nuevo_estado = 'completada' then now() else completed_at end,
    cancelled_at = case when p_nuevo_estado in ('cancelada','no_realizada') then now() else cancelled_at end,
    observaciones = case when p_motivo is null then observaciones else coalesce(observaciones,'') || ' · ' || p_motivo end,
    updated_at = now()
  where id = p_operacion;

  -- al cerrar la operación se consumen/liberan sus reservas activas
  if p_nuevo_estado = 'completada' then
    update tc_reservas_neumatico set status = 'consumida', liberado_at = now(), liberado_por = auth.uid()
      where operacion_id = p_operacion and status = 'activa';
  elsif p_nuevo_estado in ('cancelada','no_realizada','anulada') then
    update tc_reservas_neumatico set status = 'liberada', liberado_at = now(), liberado_por = auth.uid(), motivo_liberacion = coalesce(p_motivo,'operación '||p_nuevo_estado)
      where operacion_id = p_operacion and status = 'activa';
  end if;
end $$;

-- ── Reservar un neumático para una operación/futuro montaje ────
create or replace function tc_reservar_neumatico(
  p_neumatico uuid, p_operacion uuid default null, p_vehiculo uuid default null,
  p_posicion uuid default null, p_fecha_prevista date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_neu record; v_id uuid;
begin
  select * into v_neu from tc_neumaticos where id = p_neumatico;
  if not found then raise exception 'Neumático no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and v_neu.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_neu.empresa_id)) then
    raise exception 'Sin permiso para reservar en esta empresa';
  end if;
  if v_neu.estado = 'montado' then raise exception 'El neumático está montado; no se puede reservar'; end if;
  if v_neu.estado = 'descartado' then raise exception 'El neumático está descartado'; end if;
  if exists (select 1 from tc_reservas_neumatico where neumatico_id = p_neumatico and status = 'activa') then
    raise exception 'El neumático ya tiene una reserva activa';
  end if;

  insert into tc_reservas_neumatico (neumatico_id, operacion_id, vehiculo_id, posicion_id, empresa_id, delegacion_id, fecha_prevista)
  values (p_neumatico, p_operacion, p_vehiculo, p_posicion, v_neu.empresa_id, null, p_fecha_prevista)
  returning id into v_id;
  return v_id;
end $$;

create or replace function tc_liberar_reserva(p_reserva uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from tc_reservas_neumatico where id = p_reserva;
  if not found then raise exception 'Reserva no encontrada'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and r.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(r.empresa_id)) then
    raise exception 'Sin permiso sobre esta reserva';
  end if;
  update tc_reservas_neumatico set status = 'liberada', liberado_at = now(), liberado_por = auth.uid(), motivo_liberacion = p_motivo, updated_at = now()
    where id = p_reserva and status = 'activa';
end $$;
