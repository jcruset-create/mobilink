-- ============================================================
-- SaaS — Fase 1c: cerrar el acceso anónimo al módulo de Almacén
--
--   ⚠️  APLICAR SOLO cuando la APK de Almacén >= 1.2.0 (login con
--   sesión Supabase vía /api/almacen/login-operario) esté instalada
--   en todos los dispositivos. La APK 1.1.x dejará de funcionar al
--   ejecutar esto (leía las tablas con la clave anónima).
--
--   · Revoca el acceso del rol anon a las tablas del almacén.
--   · Políticas RLS: solo usuarios autenticados.
--   · La web de almacén no se ve afectada (ya usa sesión Supabase).
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'perfiles_usuario',
    'traspasos',
    'traspasos_auditoria',
    'traspasos_auditoria_detalle',
    'movimientos_stock',
    'solicitudes_reposicion'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice 'Tabla % no existe, saltada', t;
      continue;
    end if;

    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);

    -- Política única: cualquier usuario autenticado (la granularidad por
    -- rol/ubicación llegará con el RBAC completo de la fase 2).
    execute format('drop policy if exists almacen_solo_autenticados on %I', t);
    execute format(
      'create policy almacen_solo_autenticados on %I for all to authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- Comprobación: estas dos consultas deben devolver 0 filas de privilegios
-- de anon sobre las tablas del almacén.
-- select table_name, privilege_type from information_schema.role_table_grants
-- where grantee = 'anon' and table_name in
--   ('perfiles_usuario','traspasos','traspasos_auditoria',
--    'traspasos_auditoria_detalle','movimientos_stock','solicitudes_reposicion');
