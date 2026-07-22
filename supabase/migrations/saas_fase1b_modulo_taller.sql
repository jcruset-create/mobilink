-- ============================================================
-- SaaS — Fase 1b: módulo "taller" (panel de taller) en licencias
--
--   El panel de taller (SeaTarragonaV1 + sus 74 endpoints Express)
--   no tenía código de módulo. Se añade 'taller' al catálogo de
--   app_licencias y se licencia a SEA Tarragona sin caducidad.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

alter table app_licencias drop constraint if exists app_licencias_modulo_check;
alter table app_licencias add constraint app_licencias_modulo_check
  check (modulo in ('administracion','tyrecontrol','almacen','sea-core','toolcontrol','safety','presencia','taller'));

alter table app_usuario_modulos drop constraint if exists app_usuario_modulos_modulo_check;
alter table app_usuario_modulos add constraint app_usuario_modulos_modulo_check
  check (modulo in ('administracion','tyrecontrol','almacen','sea-core','toolcontrol','safety','presencia','taller'));

insert into app_licencias (empresa_id, modulo)
select '00000000-0000-4000-a000-000000000001', 'taller'
where not exists (
  select 1 from app_licencias
  where empresa_id = '00000000-0000-4000-a000-000000000001' and modulo = 'taller'
);
