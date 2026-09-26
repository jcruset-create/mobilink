/*
 * ════════════════════════════════════════════════════════════════════════════
 *  CONSULTA MÍNIMA · para el editor SQL de Supabase, desde el móvil
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Una sola sentencia. Se pega, se ejecuta, se copia la única celda que sale.
 *
 * SOLO LECTURA: todo sale de `pg_catalog` e `information_schema`.
 *
 * Es la CONSULTA A de `verificacion-previa-dashboard.sql` recortada a la
 * cuarta parte para poder copiarla en un teléfono. Lo que se ha quitado es la
 * lista de las 88 tablas de la migración: no hacía falta mandarla a Supabase,
 * porque la clasificación en 4 vías se puede hacer cruzando `tablas` con la
 * lista del repositorio después. La salida no pierde nada.
 *
 * ── CÓMO LEER `tablas` ─────────────────────────────────────────────────────
 *
 * Cada fila trae DOS dimensiones independientes, a propósito:
 *
 *   `rls`                 → si la tabla tiene Row Level Security activada.
 *   `anon` `auth` `pub`   → permisos EFECTIVOS de cada rol, en letras:
 *                           d=delete, i=insert, s=select, u=update.
 *                           Cadena vacía = ningún permiso.
 *
 * Son controles distintos y las cuatro combinaciones existen. `pub` está
 * porque `anon` y `authenticated` HEREDAN de PUBLIC: una tabla a la que nunca
 * se le concedió nada a `anon` puede salir con `anon: "s"` solo por un
 * `grant select to public`. Es el caso que se colaba al mirar únicamente los
 * grants concedidos, y el motivo de que la migración haga `revoke from public`
 * ANTES que de `anon`.
 *
 * ── LO QUE DEVUELVE Y LO QUE NO ────────────────────────────────────────────
 *
 * No devuelve ningún secreto: ni contraseñas, ni tokens, ni claves, ni
 * `service_role`, ni filas de negocio. Nombres de tablas, de roles, de
 * privilegios y de funciones, recuentos, y los predicados de las políticas.
 *
 * Los nombres de usuario NO salen: `colisiones_username` da solo el recuento.
 *
 * Los buckets de Storage NO están aquí a propósito: `storage.buckets` puede
 * fallar por permisos y abortaría la consulta entera. Van en su propia
 * sentencia, al final.
 */

select jsonb_build_object(
'meta', jsonb_build_object('fecha',now(),'base',current_database(),'rol',current_user,'pg',version()),
'tablas', (select coalesce(jsonb_agg(jsonb_build_object(
    't',c.relname,'rls',c.relrowsecurity,'kb',(pg_total_relation_size(c.oid)/1024)::int,
    'anon',coalesce((select string_agg(left(x,1),'' order by x) from unnest(array['select','insert','update','delete']) x where has_table_privilege('anon',c.oid,x)),''),
    'auth',coalesce((select string_agg(left(x,1),'' order by x) from unnest(array['select','insert','update','delete']) x where has_table_privilege('authenticated',c.oid,x)),''),
    'pub', coalesce((select string_agg(left(x,1),'' order by x) from unnest(array['select','insert','update','delete']) x where has_table_privilege('public',c.oid,x)),'')
  ) order by c.relname),'[]'::jsonb)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r'),
'pub_grants', (select coalesce(jsonb_agg(table_name||':'||privilege_type order by table_name,privilege_type),'[]'::jsonb)
  from information_schema.role_table_grants where table_schema='public' and grantee='PUBLIC'),
'politicas', (select coalesce(jsonb_agg(jsonb_build_object('t',tablename,'p',policyname,'cmd',cmd,
    'roles',roles,'using',qual,'check',with_check) order by tablename,policyname),'[]'::jsonb)
  from pg_policies where schemaname='public'),
'funciones', (select jsonb_build_object('total',count(*),
    'anon',count(*) filter (where has_function_privilege('anon',p.oid,'execute')),
    'auth',count(*) filter (where has_function_privilege('authenticated',p.oid,'execute')),
    'pub',count(*) filter (where has_function_privilege('public',p.oid,'execute')),
    'secdef',count(*) filter (where p.prosecdef),
    'secdef_sin_pgtemp',count(*) filter (where p.prosecdef and coalesce(array_to_string(p.proconfig,','),'') not like '%pg_temp%'))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
'secdef_sin_pgtemp', (select coalesce(jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text),'[]'::jsonb)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef and coalesce(array_to_string(p.proconfig,','),'') not like '%pg_temp%'),
'fn_clave', (select coalesce(jsonb_agg(jsonb_build_object('f',p.oid::regprocedure::text,
    'secdef',p.prosecdef,'cfg',coalesce(array_to_string(p.proconfig,', '),'-'),
    'anon',has_function_privilege('anon',p.oid,'execute'),
    'auth',has_function_privilege('authenticated',p.oid,'execute'),
    'pub',has_function_privilege('public',p.oid,'execute')) order by 1),'[]'::jsonb)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
   and p.proname in ('app_es_admin','app_empresa_actual','app_login_email','app_guardar_usuario','app_eliminar_usuario')),
'existe', jsonb_build_object('app_bajas_auth',to_regclass('public.app_bajas_auth') is not null,
    'app_auth_intentos',to_regclass('public.app_auth_intentos') is not null,
    'perfiles_usuario',to_regclass('public.perfiles_usuario') is not null,
    'pres_records',to_regclass('public.pres_records') is not null,
    'sm_document_ack',to_regclass('public.sm_document_acknowledgements') is not null),
'triggers_app_usuarios', (select coalesce(jsonb_agg(t.tgname||' -> '||p.proname order by t.tgname),'[]'::jsonb)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  join pg_proc p on p.oid=t.tgfoid where n.nspname='public' and c.relname='app_usuarios' and not t.tgisinternal),
'superadmins', (select jsonb_build_object('super',count(*) filter (where es_superadmin),
    'super_sin_email',count(*) filter (where es_superadmin and coalesce(email_recuperacion,'')=''),
    'activos',count(*)) from app_usuarios where activo),
'colisiones_username', (select jsonb_build_object('grupos',count(*),'cuentas',coalesce(sum(c),0))
  from (select count(*) c from app_usuarios group by lower(translate(regexp_replace(btrim(username),'\s+','.','g'),
    'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc')) having count(*)>1) z),
'temp', jsonb_build_object('auth',has_database_privilege('authenticated',current_database(),'TEMP'),
    'anon',has_database_privilege('anon',current_database(),'TEMP'))
) as informe;

-- ═══════════════════════════════════════════════════════════════════════════
-- Aparte: buckets de Storage
-- ═══════════════════════════════════════════════════════════════════════════
-- Si da «permission denied for schema storage», no es un problema: se mira en
-- el panel de Storage, columna «Public».

select id, name, public, created_at from storage.buckets order by public desc, name;
