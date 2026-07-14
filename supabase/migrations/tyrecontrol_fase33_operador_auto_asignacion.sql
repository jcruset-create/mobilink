-- ============================================================
-- SEA TyreControl — Fase 33: auto-asignación de empresas nuevas
-- a los operadores.
--
-- El backend asigna todas las empresas activas al operario en cada
-- login, pero las tablets mantienen la sesión durante semanas: si
-- entra un cliente nuevo (p. ej. creado por la sincronización del
-- almacén), el operario no ve su nombre hasta volver a loguearse
-- (caso real: ENCATRANS invisible en la APK). Este trigger asigna
-- cada empresa nueva a todos los operadores activos al momento.
-- ============================================================

create or replace function tc_asignar_empresa_a_operadores()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into tc_operador_empresas (usuario_id, empresa_id)
  select u.id, new.id
  from tc_usuarios u
  where u.rol = 'operador' and u.activo
  on conflict (usuario_id, empresa_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_asignar_empresa_operadores on tc_empresas;
create trigger trg_asignar_empresa_operadores
  after insert on tc_empresas
  for each row execute function tc_asignar_empresa_a_operadores();

-- Backfill: asegurar que los operadores activos tienen todas las
-- empresas activas actuales.
insert into tc_operador_empresas (usuario_id, empresa_id)
select u.id, e.id
from tc_usuarios u cross join tc_empresas e
where u.rol = 'operador' and u.activo and e.activo
on conflict (usuario_id, empresa_id) do nothing;
