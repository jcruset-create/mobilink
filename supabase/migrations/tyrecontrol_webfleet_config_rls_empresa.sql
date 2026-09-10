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
-- ── Si la tabla no existe ───────────────────────────────────────────────────
--
-- No en todos los proyectos está creada: tyrecontrol_webfleet_config.sql se
-- pasa a mano, y donde no se pasó, Webfleet funciona con las credenciales
-- globales de entorno (resolveWebfleetCreds cae a ellas cuando no hay fila).
-- Ahí no hay nada que arreglar, así que esta migración lo dice y termina en
-- vez de fallar con «relation does not exist». Se puede ejecutar en cualquier
-- proyecto, tenga la tabla o no.
--
-- Nota sobre el backend: el servidor lee esta tabla con service_role, que no
-- pasa por RLS. Esta migración no cambia nada de la sincronización ni de los
-- endpoints; solo cierra el acceso directo desde el navegador.
--
-- Idempotente. Pegar en Supabase (SQL Editor).
-- ============================================================

do $$
declare
  v_pol text;
begin
  if to_regclass('public.tc_webfleet_config') is null then
    raise notice 'tc_webfleet_config no existe en este proyecto: no hay credenciales por empresa que proteger. Nada que hacer.';
    return;
  end if;

  -- Por si la tabla existiera con RLS apagada.
  execute 'alter table public.tc_webfleet_config enable row level security';

  execute 'drop policy if exists tc_webfleet_config_all on public.tc_webfleet_config';
  execute $pol$
    create policy tc_webfleet_config_all on public.tc_webfleet_config
      for all
      using      ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
      with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  $pol$;

  -- ── Comprobación: que la política quede realmente acotada ─────────────────
  -- Mismo patrón que tyrecontrol_parte_guiado_alta_vehiculo.sql: si una
  -- migración posterior vuelve a dejarla abierta, esto lo dice en voz alta en
  -- vez de dejar las credenciales expuestas en silencio.
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

  raise notice 'tc_webfleet_config: política acotada por empresa aplicada correctamente.';
end $$;
