-- ============================================================
-- SEA TyreControl — Fase 36: empresas visibles por usuario (manual)
--
-- La ficha de usuario del panel permite asignar VARIAS empresas a un
-- usuario (tc_operador_empresas). Hasta ahora la asignación era 100%
-- automática ("todo técnico ve todas las flotas"): el login del operario
-- reasigna todas las empresas activas y el trigger de la fase 33 añade
-- cada empresa nueva a todos los operadores. Para poder restringir a un
-- usuario (p. ej. David → solo SEA Tarragona y ENCATRANS) se añade el
-- flag empresas_manual: cuando está a true, ni el login ni el trigger
-- tocan sus asignaciones (las gestiona el panel).
-- ============================================================

alter table tc_usuarios add column if not exists empresas_manual boolean not null default false;

-- El trigger de auto-asignación (fase 33) respeta el flag.
create or replace function tc_asignar_empresa_a_operadores()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into tc_operador_empresas (usuario_id, empresa_id)
  select u.id, new.id
  from tc_usuarios u
  where u.rol = 'operador' and u.activo
    and coalesce(u.empresas_manual, false) = false
  on conflict (usuario_id, empresa_id) do nothing;
  return new;
end $$;
