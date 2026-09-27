/*
 * CADENA DE AUTORIZACIÓN DE ADMINISTRACIÓN — SOLO LECTURA
 *
 * No falsifica `auth.uid()` ni toca la configuración de sesión. Evalúa la
 * MISMA lógica que `adm_rol_actual()` y `adm_can_read()`, pero con el UUID
 * pasado como literal, para poder compararla con lo que ocurre de verdad.
 *
 * ── CÓMO USARLO ────────────────────────────────────────────────────────────
 *
 * Sustituir el UUID de la primera línea por el del usuario a comprobar. Si no
 * se cambia, evalúa todas las filas de `adm_usuarios` y también los
 * superadministradores, que es lo útil la primera vez.
 */

with objetivo(uuid_a_comprobar) as (
  -- Poner aquí el UUID de la sesión que se quiere comprobar, o dejar null
  -- para evaluar a todos los candidatos conocidos.
  values (null::uuid)
),
candidatos as (
  select u.id, u.nombre as etiqueta, 'adm_usuarios' as origen from adm_usuarios u
  union
  select a.id, a.username, 'superadmin' from app_usuarios a where coalesce(a.es_superadmin,false)
  union
  select o.uuid_a_comprobar, 'UUID indicado', 'manual' from objetivo o where o.uuid_a_comprobar is not null
)
select jsonb_build_object(
'meta', jsonb_build_object('fecha_utc', now(), 'pg', version()),

-- ── 1) Las funciones de la cadena, con todo lo que se pidió ──────────────
-- Cuerpo, definer/invoker, search_path, dueño, y si hay sobrecargas.
'funciones', (select coalesce(jsonb_agg(jsonb_build_object(
    'firma', p.oid::regprocedure::text,
    'security', case when p.prosecdef then 'DEFINER' else 'INVOKER' end,
    'volatilidad', case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end,
    'search_path', coalesce(array_to_string(p.proconfig, ', '), '(SIN search_path)'),
    'dueno', pg_get_userbyid(p.proowner),
    'cuerpo', pg_get_functiondef(p.oid),
    'ejecuta_public', has_function_privilege('public', p.oid, 'execute'),
    'ejecuta_anon', has_function_privilege('anon', p.oid, 'execute'),
    'ejecuta_authenticated', has_function_privilege('authenticated', p.oid, 'execute')
  ) order by p.proname, p.oid::regprocedure::text),'[]'::jsonb)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('adm_rol_actual','adm_can_read','adm_can_manage','adm_is_admin')),

-- ¿Hay más de una función con el mismo nombre? Una sobrecarga explicaría que
-- se resuelva una distinta de la esperada.
'sobrecargas', (select coalesce(jsonb_object_agg(proname, n),'{}'::jsonb)
  from (select p.proname, count(*) as n
          from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
         where n2.nspname = 'public'
           and p.proname in ('adm_rol_actual','adm_can_read','adm_can_manage','uid')
         group by p.proname) z),

-- Y la de Supabase, por si estuviera redefinida o en otro esquema.
'auth_uid', (select coalesce(jsonb_agg(jsonb_build_object(
    'firma', p.oid::regprocedure::text,
    'esquema', n.nspname,
    'security', case when p.prosecdef then 'DEFINER' else 'INVOKER' end,
    'cuerpo', pg_get_functiondef(p.oid)) order by n.nspname),'[]'::jsonb)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.proname = 'uid' and n.nspname in ('auth','public')),

-- ── 2) La tabla que lee la cadena ────────────────────────────────────────
-- `force_rls` importa: con FORCE, ni el dueño se salta la RLS, así que una
-- función SECURITY DEFINER del dueño dejaría de ver las filas.
'adm_usuarios_tabla', (select jsonb_build_object(
    'dueno', pg_get_userbyid(c.relowner),
    'rls', c.relrowsecurity,
    'force_rls', c.relforcerowsecurity,
    'politicas', (select coalesce(jsonb_agg(jsonb_build_object(
        'politica', p.policyname, 'cmd', p.cmd, 'roles', p.roles,
        'using', p.qual, 'with_check', p.with_check) order by p.policyname),'[]'::jsonb)
      from pg_policies p where p.schemaname='public' and p.tablename='adm_usuarios'),
    'select_anon', has_table_privilege('anon', c.oid, 'select'),
    'select_authenticated', has_table_privilege('authenticated', c.oid, 'select'))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='adm_usuarios'),

-- Y las dos tablas base de la vista: con `security_invoker` el llamante
-- necesita SELECT sobre ellas, no solo pasar la RLS.
'tablas_base_vista', (select coalesce(jsonb_agg(jsonb_build_object(
    'tabla', c.relname,
    'dueno', pg_get_userbyid(c.relowner),
    'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'select_authenticated', has_table_privilege('authenticated', c.oid, 'select'),
    'select_anon', has_table_privilege('anon', c.oid, 'select')) order by c.relname),'[]'::jsonb)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ('adm_work_orders','adm_customers')),

'vista', (select jsonb_build_object(
    'dueno', pg_get_userbyid(c.relowner),
    'reloptions', coalesce(array_to_string(c.reloptions, ', '), '(ninguna)'),
    'select_anon', has_table_privilege('anon', c.oid, 'select'),
    'select_authenticated', has_table_privilege('authenticated', c.oid, 'select'))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='adm_ot_estado'),

-- ── 3) La evaluación, candidato a candidato ──────────────────────────────
-- Reproduce el predicado de `adm_rol_actual()` y `adm_can_read()` con el UUID
-- como literal. Si aquí sale `true` para alguien, la cadena es correcta PARA
-- ESE UUID, y entonces el problema está en qué UUID llega, no en la lógica.
'evaluacion', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'etiqueta', c.etiqueta,
    'origen', c.origen,
    'existe_en_adm_usuarios', exists (select 1 from adm_usuarios u where u.id = c.id),
    'activo', (select u.activo from adm_usuarios u where u.id = c.id),
    'rol', (select u.rol::text from adm_usuarios u where u.id = c.id),
    'adm_rol_actual_equivalente',
      coalesce((select u.rol::text from adm_usuarios u where u.id = c.id and u.activo), ''),
    'adm_can_read_equivalente',
      coalesce((select u.rol::text from adm_usuarios u where u.id = c.id and u.activo), '')
        in ('admin','administracion','recepcion','supervisor')
  ) order by c.etiqueta),'[]'::jsonb)
  from candidatos c where c.id is not null)
) as cadena_adm;
