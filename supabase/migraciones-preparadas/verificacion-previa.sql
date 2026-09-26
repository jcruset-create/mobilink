/*
 * VERIFICACIÓN PREVIA — solo lectura, no cambia nada.
 *
 * Se ejecuta ANTES de `001_seguridad_fase0.sql` y hay que mirar la salida, no
 * solo que no dé error.
 *
 * Por qué existe: la migración conoce únicamente las tablas creadas en
 * `supabase/migrations/`. En este proyecto hay tablas creadas a mano desde el
 * dashboard —`clientes`, `empresas`, `movimientos_stock`, `traspasos`,
 * `perfiles_usuario`, `solicitudes_reposicion`, `productos_neumaticos`,
 * `incidencias`, `inventarios`, `stock_minimos`…— cuyo estado no se puede saber
 * leyendo el repositorio. La lista de la migración es un suelo, no un techo, y
 * esta consulta dice cuál es el techo de verdad.
 */

\echo '=== 1) TODAS las tablas de public sin RLS (la lista real) ==='
-- Si aquí aparecen tablas que no están en la lista de la migración, son las
-- creadas a mano en el dashboard. Hay que decidir sobre ellas antes de seguir.
select c.relname as tabla,
       pg_size_pretty(pg_total_relation_size(c.oid)) as tamano
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and not c.relrowsecurity
 order by pg_total_relation_size(c.oid) desc;

\echo '=== 2) Qué puede hacer hoy la clave pública sobre esas tablas ==='
-- Esto es lo que se cierra. Cada fila es una operación que cualquiera con la
-- clave publicable de las APKs puede hacer ahora mismo por PostgREST.
select g.table_name, g.grantee, string_agg(g.privilege_type, ', ' order by g.privilege_type) as permisos
  from information_schema.role_table_grants g
  join pg_class c on c.relname = g.table_name
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
 where g.table_schema = 'public'
   and g.grantee in ('anon', 'authenticated')
   and not c.relrowsecurity
 group by g.table_name, g.grantee
 order by g.table_name, g.grantee;

\echo '=== 3) Políticas con predicado siempre cierto (para la Fase 3) ==='
-- No se tocan en esta migración; se listan para tener el tamaño del trabajo.
select tablename, policyname, roles, cmd
  from pg_policies
 where schemaname = 'public'
   and (qual = 'true' or with_check = 'true')
 order by tablename, policyname;

\echo '=== 4) Políticas abiertas a anon (las que SÍ se retiran) ==='
select tablename, policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and 'anon' = any(roles)
 order by tablename, policyname;

\echo '=== 5) Funciones que anon o authenticated pueden ejecutar hoy ==='
-- Incluye las 170 `security definer` del informe. No se cierran aquí (es de la
-- Fase 3), pero conviene ver el número antes y después.
select count(*) as funciones_ejecutables_por_anon
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and has_function_privilege('anon', p.oid, 'execute');

\echo '=== 6) Cuántos superadministradores hay (para la Fase 1C) ==='
-- Si sale 1, la recuperación con doble aprobación no se puede montar todavía y
-- hace falta el procedimiento de rotura de cristal.
select count(*) filter (where es_superadmin) as superadministradores,
       count(*) filter (where es_superadmin and coalesce(email_recuperacion, '') = '')
         as superadmins_sin_email_de_recuperacion,
       count(*) as usuarios_totales
  from app_usuarios
 where activo;

\echo '=== 7) Colisiones de nombre de usuario con la normalización fuerte ==='
-- Adelanto de la Fase 1A: dice si al plegar acentos y espacios habría choques.
-- No se renombra nada; solo se mira.
select lower(
         translate(
           regexp_replace(btrim(username), '\s+', '.', 'g'),
           'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç',
           'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc'
         )
       ) as canonico,
       count(*) as cuentas,
       string_agg(username, ' | ' order by username) as usernames
  from app_usuarios
 group by 1
having count(*) > 1
 order by 2 desc;

\echo '=== 8) Recuento de tablas de public, y cuántas sin RLS ==='
select count(*) as tablas_public,
       count(*) filter (where relrowsecurity) as con_rls,
       count(*) filter (where not relrowsecurity) as sin_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r';

\echo '=== 9) Privilegios heredados vía PUBLIC (el caso que se colaba) ==='
-- `revoke ... from anon` no quita nada de lo concedido a PUBLIC, porque anon
-- hereda de PUBLIC. Estas filas son las que hay que mirar dos veces.
select table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'PUBLIC'
 order by 1, 2;

\echo '=== 10) Funciones ejecutables por anon / authenticated / PUBLIC ==='
select
  count(*) filter (where has_function_privilege('anon', p.oid, 'execute'))          as puede_anon,
  count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute')) as puede_authenticated,
  count(*) filter (where p.prosecdef)                                               as security_definer,
  count(*) filter (where p.prosecdef and not coalesce(array_to_string(p.proconfig, ','), '') like '%pg_temp%')
                                                                                    as secdef_sin_pg_temp,
  count(*)                                                                          as funciones_totales
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public';

\echo '=== 11) Las SECURITY DEFINER sin pg_temp en su search_path ==='
-- Suplantables con una tabla temporal por quien tenga conexión directa a la
-- base. `app_es_admin` es la que abre `app_guardar_usuario`.
select p.oid::regprocedure as firma, coalesce(array_to_string(p.proconfig, ', '), '(sin search_path)') as config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and not coalesce(array_to_string(p.proconfig, ','), '') like '%pg_temp%'
 order by 1
 limit 50;

\echo '=== 12) Buckets de Storage y su visibilidad ==='
-- Solo lectura. Si esta consulta falla, el rol no ve el esquema `storage` y hay
-- que mirarlo en el panel de Storage del dashboard.
select id, name, public, created_at from storage.buckets order by public desc, name;

\echo '=== 13) ¿Puede authenticated crear tablas temporales? ==='
-- Es la precondición del ataque por search_path. Si sale falso, el riesgo baja.
select has_database_privilege('authenticated', current_database(), 'TEMP') as authenticated_temp,
       has_database_privilege('anon', current_database(), 'TEMP') as anon_temp;
