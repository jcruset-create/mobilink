/*
 * INVENTARIO DE VISTAS Y OBJETOS PENDIENTES — SOLO LECTURA
 *
 * Se pega en el editor SQL de Supabase. Una sentencia, una celda de salida.
 *
 * Por qué hace falta: la fotografía del 2026-09-26 miró solo tablas
 * (`relkind = 'r'`). Las vistas se quedaron fuera, y una vista SIN
 * `security_invoker` se ejecuta con los privilegios de su DUEÑO y **se salta la
 * RLS de las tablas que lee**. Activar RLS en una tabla no protege nada si hay
 * una vista encima que la lee como `postgres` y está concedida a `anon`.
 *
 * Resuelve además tres nombres que el panel lee y que no son tablas de
 * `public`: `backups_sistema`, `tc_webfleet_config` y
 * `traspasos_auditoria_detalle`.
 */

select jsonb_build_object(
'meta', jsonb_build_object('fecha',now(),'pg',version()),

-- Vistas y vistas materializadas, con dueño, grants efectivos y si son
-- security_invoker. `relkind`: v = vista, m = materializada.
'vistas', (select coalesce(jsonb_agg(jsonb_build_object(
    'v',c.relname,
    'tipo',case c.relkind when 'v' then 'vista' when 'm' then 'materializada' end,
    'dueno',pg_get_userbyid(c.relowner),
    -- security_invoker vive en reloptions; si no está, la vista corre como su dueño
    'invoker',coalesce(array_to_string(c.reloptions,',') like '%security_invoker=true%',false),
    'opciones',coalesce(array_to_string(c.reloptions,', '),'-'),
    'anon',coalesce((select string_agg(left(x,1),'' order by x) from unnest(array['select','insert','update','delete']) x where has_table_privilege('anon',c.oid,x)),''),
    'auth',coalesce((select string_agg(left(x,1),'' order by x) from unnest(array['select','insert','update','delete']) x where has_table_privilege('authenticated',c.oid,x)),''),
    'pub', coalesce((select string_agg(left(x,1),'' order by x) from unnest(array['select','insert','update','delete']) x where has_table_privilege('public',c.oid,x)),'')
  ) order by c.relname),'[]'::jsonb)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('v','m')),

-- Las tablas base de cada vista, y si esas tablas tienen RLS. Es la pregunta
-- que importa: una vista no-invoker sobre una tabla CON RLS se la salta.
'vista_tablas_base', (select coalesce(jsonb_agg(jsonb_build_object(
    'v',v.relname,'base',t.relname,'base_rls',t.relrowsecurity) order by v.relname,t.relname),'[]'::jsonb)
  from pg_depend d
  join pg_rewrite r on r.oid=d.objid
  join pg_class v on v.oid=r.ev_class
  join pg_class t on t.oid=d.refobjid
  join pg_namespace nv on nv.oid=v.relnamespace
  join pg_namespace nt on nt.oid=t.relnamespace
 where d.classid='pg_rewrite'::regclass and d.refclassid='pg_class'::regclass
   and v.relkind in ('v','m') and t.relkind='r'
   and nv.nspname='public' and nt.nspname='public' and v.oid<>t.oid),

-- Definición de las que el panel lee directamente.
'definiciones', (select coalesce(jsonb_object_agg(viewname, definition),'{}'::jsonb)
  from pg_views where schemaname='public'
    and viewname in ('adm_ot_estado','tc_clientes_almacen','tc_marcas_contadores',
                     'tc_productos_almacen','traspasos_auditoria_detalle','backups_sistema')),

-- Los tres nombres sin identificar: qué son, en qué esquema y de qué clase.
'objetos_pendientes', (select coalesce(jsonb_agg(jsonb_build_object(
    'nombre',c.relname,'esquema',n.nspname,
    'clase',case c.relkind when 'r' then 'tabla' when 'v' then 'vista'
                           when 'm' then 'materializada' when 'p' then 'particionada'
                           when 'f' then 'foranea' else c.relkind::text end,
    'dueno',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity) order by c.relname),'[]'::jsonb)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relname in ('backups_sistema','tc_webfleet_config','traspasos_auditoria_detalle')),

-- Columnas de perfiles_usuario: hace falta para saber qué expone exactamente
-- la política `anon_read_activos` a la clave pública.
'perfiles_usuario_columnas', (select coalesce(jsonb_agg(jsonb_build_object(
    'col',a.attname,'tipo',format_type(a.atttypid,a.atttypmod)) order by a.attnum),'[]'::jsonb)
  from pg_attribute a
 where a.attrelid=to_regclass('public.perfiles_usuario') and a.attnum>0 and not a.attisdropped),

-- Lo mismo para sea_employees: el portal descarga `codigo_operario` al
-- navegador, y hay que saber qué más hay en la fila.
'sea_employees_columnas', (select coalesce(jsonb_agg(jsonb_build_object(
    'col',a.attname,'tipo',format_type(a.atttypid,a.atttypmod)) order by a.attnum),'[]'::jsonb)
  from pg_attribute a
 where a.attrelid=to_regclass('public.sea_employees') and a.attnum>0 and not a.attisdropped),

-- Funciones con nombre repetido (sobrecargas): `revoke ... on function f(args)`
-- solo alcanza a UNA firma, así que una sobrecarga olvidada deja la puerta.
'sobrecargas', (select coalesce(jsonb_object_agg(proname, firmas),'{}'::jsonb)
  from (select p.proname, jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text) as firmas
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' group by p.proname having count(*)>1) y),

-- Roles que no son anon/authenticated/postgres y pueden leer public: si un job
-- corre con un rol propio, activar RLS sin políticas lo deja fuera.
'otros_roles', (select coalesce(jsonb_agg(jsonb_build_object(
    'rol',r.rolname,'login',r.rolcanlogin,'superusuario',r.rolsuper,
    'bypassrls',r.rolbypassrls) order by r.rolname),'[]'::jsonb)
  from pg_roles r
 where r.rolname not like 'pg\_%'
   and r.rolname not in ('anon','authenticated','postgres'))
) as informe;
