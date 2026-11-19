-- ─────────────────────────────────────────────────────────────────────────────
-- TyreControl · Seguridad, fase 0 · Funciones abiertas de más
--
-- Supabase, por defecto, deja ejecutar cualquier función nueva a `anon` (sin
-- iniciar sesión) y a `authenticated` (cualquier usuario con sesión). En las
-- funciones SECURITY DEFINER eso significa saltarse las políticas de las
-- tablas, así que la función tiene que comprobar ella quién llama. Veintitantas
-- no lo hacían. La peor, `tc_reenganchar_neumatico`, dejaba a cualquiera —sin
-- sesión siquiera— marcar cualquier neumático como montado en cualquier camión.
--
-- Qué hace esta migración. NO cambia lo que hace ninguna función salvo una:
--
--   1. INTERNAS. Solo las llaman otras funciones (que sí comprueban permisos)
--      o nadie. Se quita el permiso de ejecutarlas a todos menos al servidor.
--   2. DEL SERVIDOR. Solo las llama el backend, con la clave de servicio. Igual.
--   3. CON SESIÓN. Las llaman el panel o la APK. Se les quita solo el acceso
--      sin sesión (`anon`). Quien tiene sesión sigue como estaba.
--   4. `tc_agrupar_operaciones_sueltas` gana dos frenos: nunca agrupa nada con
--      menos de media hora (antes, pasándole 0, partía en trozos un trabajo
--      que un técnico tenía abierto) y a un usuario de rol cliente no le hace
--      nada.
--
-- Por qué no rompe la operativa: antes de quitar ningún permiso, la migración
-- comprueba EN LA BASE DE DATOS REAL que cada función que se cierra solo se
-- usa desde funciones SECURITY DEFINER —que se ejecutan como su dueño, no como
-- quien llama— y que no está en ninguna política, valor por defecto, vista ni
-- restricción. Si algo no cuadra, aborta y no se cambia nada.
--
-- `tc_generar_numero_operacion` NO se cierra a los usuarios con sesión aunque
-- solo la llame el servidor: es el valor por defecto de
-- `tc_intervenciones.numero`, y un valor por defecto se evalúa con los
-- permisos de quien inserta. Cerrarla dejaría a la tablet sin poder abrir
-- partes.
--
-- No se tocan las funciones `tc_op_*` ni `tc_operator_login`: son de
-- ToolControl, cuya app entra sin sesión a propósito. Van en su propia fase.
--
-- Se puede pegar entera en el editor SQL de Supabase y repetir sin miedo.
-- ─────────────────────────────────────────────────────────────────────────────

do $migracion$
declare
  -- 1. Solo las llaman otras funciones SECURITY DEFINER, o nadie.
  v_internas constant text[] := array[
    'tc_reenganchar_neumatico',
    'tc_buscar_neumatico_identificado',
    'tc_devolver_usado_a_stock',
    'tc_elegir_usado_almacen',
    'tc_generar_numero_interno',
    'tc_inventario_inicial_km_montajes',
    'tc_imp_ampliar_intervencion',
    'tc_imp_anotar_bloqueado',
    'tc_imp_ficha_historica',
    'tc_imp_reconstruir_vehiculo',
    'tc_imp_desfase_mano_obra',
    'tc_imp_posiciones_norma',
    'tc_imp_huella_estado',
    'tc_imp_huella_intervalo'
  ];
  -- 2. Solo las llama el backend con la clave de servicio.
  v_servidor constant text[] := array[
    'tc_asignar_numero_intervencion',
    'tc_presencia_hist_cerrar',
    'tc_presencia_hist_extender'
  ];
  -- 3. Las llaman el panel o la APK, siempre con sesión.
  v_con_sesion constant text[] := array[
    'tc_agrupar_operaciones_sueltas',
    'tc_generar_numero_operacion',
    'tc_alta_operativa_ficha',
    'tc_aplicar_albaranes_a_montajes',
    'tc_identificacion_resuelve',
    'tc_presion_objetivo',
    'tc_medida_compatible',
    'tc_resolver_incidencia_parcial'
  ];
  v_cerradas text[];
  v_patron   text;
  v_falta    text;
  v_donde    text;
  v_fn       text;
  r          record;
begin
  v_cerradas := v_internas || v_servidor;
  -- «\m…\M» son los límites de palabra de Postgres: `tc_imp_huella_estado` no
  -- puede casar dentro de `tc_imp_huella_estado_v2`.
  v_patron := '\m(' || array_to_string(v_cerradas, '|') || ')\M';

  -- ── Que estén todas, y cada una una sola vez ──────────────────────────────
  -- Con una sobrecarga de por medio habría que decidir cuál se cierra; mejor
  -- parar y mirarlo que cerrar la que no es.
  select string_agg(n, ', ') into v_falta
    from unnest(v_cerradas || v_con_sesion) n
   where (select count(*) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname = n) <> 1;
  if v_falta is not null then
    raise exception 'Fase 0: estas funciones no existen o están sobrecargadas, no se toca nada: %', v_falta;
  end if;

  -- ── Que cerrar no deje a nadie sin poder trabajar ─────────────────────────
  -- Una función SECURITY DEFINER llama a las demás como su dueño, así que le
  -- da igual lo que se le quite a `authenticated`. Todo lo demás —una función
  -- normal, una política, un valor por defecto, una vista, una restricción—
  -- se evalúa con los permisos de quien llama, y se quedaría colgado.
  select string_agg(distinct p.proname, ', ') into v_donde
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not p.prosecdef
     and p.prosrc ~ v_patron;
  if v_donde is not null then
    raise exception 'Fase 0: estas funciones NO son SECURITY DEFINER y llaman a una de las que se cierran: %. No se toca nada.', v_donde;
  end if;

  select string_agg(distinct p.proname || ' (dueño ' || pg_get_userbyid(p.proowner) || ')', ', ') into v_donde
    from pg_proc p
    join pg_proc c on c.pronamespace = 'public'::regnamespace
                  and c.proname = any (v_cerradas)
                  and p.prosrc ~ ('\m' || c.proname || '\M')
   where p.pronamespace = 'public'::regnamespace
     and p.prosecdef
     and p.proowner <> c.proowner;
  if v_donde is not null then
    raise exception 'Fase 0: estas funciones llaman a una de las que se cierran y son de otro dueño: %. No se toca nada.', v_donde;
  end if;

  select string_agg(d, ', ') into v_donde from (
    select 'política ' || tablename || '.' || policyname d from pg_policies
     where coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ v_patron
    union all
    select 'valor por defecto de ' || c.relname || '.' || a.attname
      from pg_attrdef x
      join pg_class c on c.oid = x.adrelid
      join pg_attribute a on a.attrelid = x.adrelid and a.attnum = x.adnum
     where pg_get_expr(x.adbin, x.adrelid) ~ v_patron
    union all
    select 'vista ' || viewname from pg_views where definition ~ v_patron
    union all
    select 'restricción ' || conname from pg_constraint
     where contype = 'c' and pg_get_constraintdef(oid) ~ v_patron
  ) usos;
  if v_donde is not null then
    raise exception 'Fase 0: una función que se iba a cerrar se usa en: %. No se toca nada.', v_donde;
  end if;

  -- ── Los dos frenos de tc_agrupar_operaciones_sueltas ──────────────────────
  -- El cuerpo es el de producción, letra por letra, con dos cosas delante.
  -- El editor de Supabase manda CRLF: se quitan los retornos de carro para
  -- que la función guardada no los lleve dentro.
  v_fn := $fn$
create or replace function public.tc_agrupar_operaciones_sueltas(p_minutos integer default 30)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; v_interv uuid; n int := 0; v_minutos int;
begin
  -- Un usuario de cliente solo consulta. Esto es limpieza de la casa: a él se
  -- le contesta que no había nada que agrupar, sin error, para que su
  -- pantalla cargue igual.
  if tc_is_cliente() then
    return 0;
  end if;

  -- Nunca menos de media hora. Con menos se parte en trozos el trabajo que un
  -- técnico tiene abierto ahora mismo: cada rueda acabaría en un parte suyo.
  v_minutos := greatest(coalesce(p_minutos, 30), 30);

  if not pg_try_advisory_xact_lock(hashtext('tc_agrupar_operaciones_sueltas')) then
    return 0;
  end if;

  for r in
    select id, empresa_id, vehiculo_id, tecnico_id, fecha_operacion, tipo_operacion,
           neumatico_id, created_at
      from operaciones_neumaticos
     where intervencion_id is null
       and status = 'completada'
       and created_at < now() - make_interval(mins => v_minutos)
     order by created_at, id
       for update skip locked
  loop
    insert into tc_intervenciones (
      empresa_id, vehiculo_id, fecha, tecnico_id, resumen, n_operaciones,
      tipo_principal, n_neumaticos, created_at, cerrada_at)
    values (
      r.empresa_id, r.vehiculo_id, r.fecha_operacion, r.tecnico_id,
      initcap(replace(r.tipo_operacion, '_', ' ')),
      1, r.tipo_operacion, case when r.neumatico_id is null then null else 1 end,
      r.created_at, r.created_at)
    returning id into v_interv;

    update operaciones_neumaticos set intervencion_id = v_interv where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $function$
$fn$;
  execute replace(v_fn, chr(13), '');

  -- ── Quitar permisos ───────────────────────────────────────────────────────
  -- `public` va siempre en la lista: es de donde heredan `anon` y
  -- `authenticated`, y quitárselo solo a ellos no cambiaría nada.
  for r in
    select p.oid::regprocedure::text firma, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = any (v_cerradas || v_con_sesion)
  loop
    if r.proname = any (v_cerradas) then
      execute format('revoke execute on function %s from public, anon, authenticated', r.firma);
    else
      execute format('revoke execute on function %s from public, anon', r.firma);
      execute format('grant execute on function %s to authenticated', r.firma);
    end if;
    -- El backend, siempre: entra con la clave de servicio.
    execute format('grant execute on function %s to service_role', r.firma);
  end loop;

  -- ── Comprobar que ha quedado como se quería ───────────────────────────────
  select string_agg(p.proname, ', ') into v_donde
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = any (v_cerradas)
     and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
       or not has_function_privilege('service_role', p.oid, 'execute')
       or not has_function_privilege(p.proowner, p.oid, 'execute'));
  if v_donde is not null then
    raise exception 'Fase 0: estas funciones no han quedado cerradas como debían: %', v_donde;
  end if;

  select string_agg(p.proname, ', ') into v_donde
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = any (v_con_sesion)
     and (has_function_privilege('anon', p.oid, 'execute')
       or not has_function_privilege('authenticated', p.oid, 'execute')
       or not has_function_privilege('service_role', p.oid, 'execute'));
  if v_donde is not null then
    raise exception 'Fase 0: estas funciones tenían que seguir abiertas solo a quien tiene sesión y no ha quedado así: %', v_donde;
  end if;

  if (select p.prosrc from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'tc_agrupar_operaciones_sueltas') !~ 'tc_is_cliente\(\)' then
    raise exception 'Fase 0: tc_agrupar_operaciones_sueltas no ha quedado con sus frenos';
  end if;

  raise notice 'Fase 0 · funciones: % cerradas del todo, % solo con sesión.',
    cardinality(v_cerradas), cardinality(v_con_sesion);
end
$migracion$;
