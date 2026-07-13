-- ============================================================
-- SEA TyreControl — Avisos automáticos por tiempo de los planes.
-- Reutiliza el centro de alertas (tc_webfleet_alertas) para no
-- duplicar UI. Se añade plan_id + tipo y un índice único para no
-- repetir el mismo aviso (próxima / vencida) del mismo plan.
-- ============================================================

alter table tc_webfleet_alertas add column if not exists plan_id uuid references tc_planes_mantenimiento(id) on delete cascade;
alter table tc_webfleet_alertas add column if not exists tipo text;  -- 'base' | 'proxima' | 'vencida'

-- Dedup de avisos por plan: un "próxima" y un "vencida" por fecha de vencimiento.
create unique index if not exists uq_wf_alertas_plan
  on tc_webfleet_alertas (vehiculo_id, plan_id, tipo, entrada_base_at)
  where plan_id is not null;
