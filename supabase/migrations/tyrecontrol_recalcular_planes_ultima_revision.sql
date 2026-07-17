-- ============================================================
-- SEA TyreControl — Corrección: planes con "ultima_fecha" desfasada.
--
-- Síntoma: un plan de "Revisión de neumáticos" aparece ATRASADO aunque
-- exista una inspección completada más reciente, porque su ultima_fecha
-- se quedó en la fecha de cuando se creó el plan y la revisión posterior
-- no la avanzó (el trigger revisión→plan no estaba activo en ese momento).
--
-- Este script:
--   1) (re)instala el trigger revisión→plan (idempotente), para el futuro.
--   2) recalcula ultima_fecha/ultima_km de cada plan "Revisión de
--      neumáticos" desde la ÚLTIMA inspección completada del vehículo,
--      solo si es más reciente que la guardada y el plan no está en
--      ajuste manual.
-- ============================================================

-- ── 1. Trigger revisión→plan (idéntico a tyrecontrol_revision_a_mantenimiento) ─
create or replace function tc_revision_a_mantenimiento()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  v_op   uuid;
  v_plan record;
begin
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

-- ── 2. Recalcular ultima_fecha/ultima_km de los planes existentes ─────────────
-- Toma la última inspección completada por vehículo y la aplica al plan
-- "Revisión de neumáticos" cuando sea más reciente que la guardada.
with op as (
  select id from tc_operaciones_mantenimiento where nombre = 'Revisión de neumáticos' limit 1
),
ultimas as (
  select distinct on (r.vehiculo_id)
    r.vehiculo_id, r.fecha_revision, r.km_vehiculo
  from revisiones_vehiculo r
  where r.estado_revision = 'completada'
  order by r.vehiculo_id, r.fecha_revision desc, r.created_at desc
)
update tc_planes_mantenimiento p
set ultima_fecha = u.fecha_revision,
    ultima_km    = coalesce(u.km_vehiculo, p.ultima_km),
    ajuste_manual = false,
    estado_manual = null,
    updated_at   = now()
from ultimas u, op
where p.operacion_id = op.id
  and p.activo
  and coalesce(p.ajuste_manual, false) = false
  and p.vehiculo_id = u.vehiculo_id
  and (p.ultima_fecha is null or u.fecha_revision > p.ultima_fecha);
