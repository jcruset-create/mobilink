-- ============================================================
-- SEA Administración — Fase 7
-- Permite a los roles admin/administración ver la lista de
-- usuarios del módulo (para el campo "Gestionado por" en las
-- gestiones de recobro).
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

drop policy if exists adm_usuarios_gestion_select on adm_usuarios;
create policy adm_usuarios_gestion_select on adm_usuarios for select
  using ( adm_can_manage() );
