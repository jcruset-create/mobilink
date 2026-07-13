-- ============================================================
-- SEA TyreControl — Enlazar revisión (tablet/web) con el plan de
-- mantenimiento automáticamente.
--
-- Cuando una revisión de vehículo pasa a 'completada' (Finalizar
-- revisión en la tablet), se marca como realizada la operación de
-- mantenimiento "Revisión de neumáticos" del vehículo:
--   • se registra en el historial de mantenimiento (tc_mantenimiento_realizadas)
--   • se actualiza la última fecha/km del plan → recalcula la próxima
--
-- security definer: el técnico que finaliza la revisión no tiene
-- permiso de escritura en las tablas de mantenimiento; el trigger lo
-- hace por él. Solo actúa en la transición a 'completada' (una vez).
-- ============================================================

create or replace function tc_revision_a_mantenimiento()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  v_op   uuid;
  v_plan record;
begin
  -- Solo al pasar a 'completada' (y no si ya lo estaba).
  if new.estado_revision <> 'completada' then return new; end if;
  if tg_op = 'UPDATE' and old.estado_revision = 'completada' then return new; end if;

  select id into v_op from tc_operaciones_mantenimiento where nombre = 'Revisión de neumáticos' limit 1;
  if v_op is null then return new; end if;

  for v_plan in
    select id from tc_planes_mantenimiento
    where vehiculo_id = new.vehiculo_id and operacion_id = v_op and activo
  loop
    insert into tc_mantenimiento_realizadas
      (empresa_id, vehiculo_id, plan_id, operacion_id, fecha, tecnico_id, km, resultado, observaciones)
    values
      (new.empresa_id, new.vehiculo_id, v_plan.id, v_op, new.fecha_revision, new.tecnico_id,
       new.km_vehiculo, 'correcta', 'Registrada automáticamente desde la revisión');

    update tc_planes_mantenimiento
      set ultima_fecha = new.fecha_revision,
          ultima_km    = coalesce(new.km_vehiculo, ultima_km),
          ajuste_manual = false,
          estado_manual = null,
          updated_at    = now()
      where id = v_plan.id;
  end loop;

  return new;
end $$;

drop trigger if exists trg_revision_a_mantenimiento on revisiones_vehiculo;
create trigger trg_revision_a_mantenimiento
  after insert or update of estado_revision on revisiones_vehiculo
  for each row execute function tc_revision_a_mantenimiento();
