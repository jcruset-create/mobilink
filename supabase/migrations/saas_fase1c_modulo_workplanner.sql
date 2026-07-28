-- ============================================================
-- SaaS — Fase 1c: módulo "workplanner" (Mobilink WorkPlanner)
--
--   WorkPlanner agrupa Operativo 2 y la agenda del panel de taller
--   bajo un módulo propio. Se licencia de forma INDEPENDIENTE del
--   módulo 'taller': una empresa puede tener WorkPlanner sin tener
--   el panel de taller completo, y al revés.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

alter table app_licencias drop constraint if exists app_licencias_modulo_check;
alter table app_licencias add constraint app_licencias_modulo_check
  check (modulo in ('administracion','tyrecontrol','almacen','sea-core','toolcontrol','safety','presencia','taller','workplanner'));

alter table app_usuario_modulos drop constraint if exists app_usuario_modulos_modulo_check;
alter table app_usuario_modulos add constraint app_usuario_modulos_modulo_check
  check (modulo in ('administracion','tyrecontrol','almacen','sea-core','toolcontrol','safety','presencia','taller','workplanner'));

-- Licencia sin caducidad para SEA Tarragona (empresa semilla).
insert into app_licencias (empresa_id, modulo)
select '00000000-0000-4000-a000-000000000001', 'workplanner'
where not exists (
  select 1 from app_licencias
  where empresa_id = '00000000-0000-4000-a000-000000000001' and modulo = 'workplanner'
);
