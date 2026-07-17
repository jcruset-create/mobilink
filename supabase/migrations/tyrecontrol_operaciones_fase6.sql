-- ============================================================
-- SEA TyreControl — Operaciones · Fase 6
-- Anulación de operaciones + auditoría.
-- Requiere: tyrecontrol_operaciones_fase1.sql (+ fase5 para el historial)
-- ============================================================

-- ── Anular una operación (marca anulada + auditoría) ──────────
-- No revierte físicamente el neumático (para eso están las correcciones
-- de la Fase 3); deja la operación fuera de los cómputos y trazada.
create or replace function tc_anular_operacion(p_operacion uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare o record;
begin
  if p_motivo is null or trim(p_motivo) = '' then raise exception 'El motivo de anulación es obligatorio'; end if;
  select * into o from operaciones_neumaticos where id = p_operacion;
  if not found then raise exception 'Operación no encontrada'; end if;
  -- anular es una acción sensible: solo admin/superadmin
  if not (tc_is_superadmin() or (tc_is_admin() and o.empresa_id = tc_auth_empresa_id())) then
    raise exception 'Solo un administrador puede anular operaciones';
  end if;
  if o.is_anulada then raise exception 'La operación ya está anulada'; end if;

  update operaciones_neumaticos set is_anulada = true, status = 'anulada', updated_at = now() where id = p_operacion;

  insert into tc_operacion_auditoria (operacion_id, accion, datos_anteriores, motivo)
  values (p_operacion, 'anular', jsonb_build_object('status', o.status, 'tipo', o.tipo_operacion), p_motivo);

  -- libera cualquier reserva asociada que siguiera activa
  update tc_reservas_neumatico set status = 'liberada', liberado_at = now(), liberado_por = auth.uid(),
    motivo_liberacion = 'operación anulada'
    where operacion_id = p_operacion and status = 'activa';
end $$;

-- ── Registrar una entrada de auditoría manual (correcciones, notas) ─
create or replace function tc_auditar_operacion(
  p_operacion uuid, p_accion text, p_motivo text default null, p_datos jsonb default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare o record; v_id uuid;
begin
  select * into o from operaciones_neumaticos where id = p_operacion;
  if not found then raise exception 'Operación no encontrada'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and o.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(o.empresa_id)) then
    raise exception 'Sin permiso sobre esta operación';
  end if;
  insert into tc_operacion_auditoria (operacion_id, accion, datos_nuevos, motivo)
  values (p_operacion, p_accion, p_datos, p_motivo)
  returning id into v_id;
  return v_id;
end $$;
