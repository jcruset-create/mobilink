-- ============================================================
-- SEA TyreControl — RLS de tc_webfleet_config acotada POR EMPRESA
--
-- La política original decía:
--
--   for all using ( tc_is_superadmin() or tc_is_admin() )
--
-- Le falta el filtro de empresa. La intención estaba escrita en la cabecera
-- de aquella migración —«Credenciales sensibles: solo admin/super-admin (no
-- clientes)»— pero la condición solo comprueba el ROL, no de QUÉ empresa es
-- administrador quien pregunta. El resultado es que un administrador del
-- cliente A puede leer (y escribir) usuario, contraseña y API key de Webfleet
-- del cliente B, en texto plano. Y como el panel las consulta directamente
-- desde el navegador, basta con abrir las herramientas de desarrollo.
--
-- Aquí se le añade el mismo filtro que ya usa tc_vehiculos_write, que es el
-- criterio de escritura del resto del módulo:
--
--   tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id())
--
-- No se inventa un criterio nuevo: se copia el que el proyecto ya aplica a
-- los datos del vehículo. Una credencial no puede estar menos protegida que
-- la ficha del camión al que da acceso.
--
-- Nota sobre el backend: el servidor lee esta tabla con service_role, que no
-- pasa por RLS. Esta migración no cambia nada de la sincronización ni de los
-- endpoints; solo cierra el acceso directo desde el navegador.
--
-- Idempotente. Pegar en Supabase (SQL Editor).
-- ============================================================

drop policy if exists tc_webfleet_config_all on public.tc_webfleet_config;

create policy tc_webfleet_config_all on public.tc_webfleet_config
  for all
  using      ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );

-- ── Comprobación: que la política quede realmente acotada ────────────────────
-- Mismo patrón que tyrecontrol_parte_guiado_alta_vehiculo.sql: si una migración
-- posterior vuelve a dejarla abierta, esto lo dice en voz alta en vez de dejar
-- las credenciales expuestas en silencio.
do $$
declare v_pol text;
begin
  select pg_get_expr(polqual, polrelid) into v_pol
    from pg_policy
   where polname = 'tc_webfleet_config_all'
     and polrelid = 'public.tc_webfleet_config'::regclass;

  if v_pol is null then
    raise exception 'No existe la política tc_webfleet_config_all';
  end if;

  if v_pol not like '%tc_auth_empresa_id%' then
    raise exception 'tc_webfleet_config_all no filtra por empresa: %', v_pol;
  end if;
end $$;
