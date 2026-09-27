/*
 * FOTOGRAFÍA PREVIA A LAS CONTENCIONES — SOLO LECTURA
 *
 * Se ejecuta ANTES de aplicar 007, 005 y 008, y su salida se guarda con fecha.
 * Es la fuente de verdad para la vuelta atrás.
 *
 * ── POR QUÉ NO BASTA CON EL ROLLBACK QUE YA ESTÁ ESCRITO ───────────────────
 *
 * Los rollbacks de 005, 007 y 008 devuelven `select, insert, update, delete`.
 * Pero las migraciones hacen `revoke all`, y «all» en PostgreSQL incluye
 * además `TRUNCATE`, `REFERENCES`, `TRIGGER` y `MAINTAIN`.
 *
 * Las fotografías del 26 y del 27 de septiembre solo capturaron las cuatro
 * primeras, así que **no se sabe** si `anon` o `authenticated` tenían alguna de
 * las otras sobre estos objetos. Si las tenían, el rollback escrito se queda
 * corto; si no las tenían, sobra nada.
 *
 * En vez de suponerlo, esta consulta captura la lista COMPLETA de privilegios y
 * **genera el SQL de restauración exacto**, línea a línea, a partir de lo que
 * hay de verdad. Ese texto generado sustituye al rollback genérico.
 *
 * Una nota honesta sobre la dirección del error: quedarse corto restaurando es
 * el lado seguro (menos permisos), no el peligroso. Pero puede romper algo, y
 * «el rollback dejó la aplicación a medias» es un mal sitio donde estar a las
 * tres de la mañana.
 */

with objetivos(nombre, grupo) as (
  values
    -- Las diez tablas de 007
    ('sea_employees','007'), ('sea_companies','007'), ('sea_work_centers','007'),
    ('sea_authorizations','007'), ('sea_competencies','007'),
    ('sea_employee_authorizations','007'), ('sea_employee_certifications','007'),
    ('sea_employee_clothing','007'), ('sea_employee_competencies','007'),
    ('sea_training_records','007'),
    -- Las cuatro vistas de 005
    ('adm_ot_estado','005'), ('tc_clientes_almacen','005'),
    ('tc_productos_almacen','005'), ('tc_marcas_contadores','005'),
    -- Las nueve vistas de 008
    ('kpis_traspasos','008'), ('movimientos_stock_detalle','008'),
    ('stock_actual','008'), ('stock_actual_detalle','008'),
    ('tc_modelos_aplicacion_sin_clasificar','008'),
    ('tc_tipos_plano_descuadrado','008'), ('traspasos_detalle','008'),
    ('traspasos_lineas_detalle','008'), ('traspasos_resumen_lineas','008')
)
select jsonb_build_object(

'meta', jsonb_build_object(
  'fecha_utc', now(),
  'base', current_database(),
  'rol_que_consulta', current_user,
  'pg', version()),

-- ── 1) Las políticas de las diez tablas de Safety, completas ──────────────
-- Con el predicado entero: el rollback tiene que recrearlas idénticas, y
-- «using (true)» no es lo mismo que «using (activo = true)».
'politicas_sea', (select coalesce(jsonb_agg(jsonb_build_object(
    'tabla',p.tablename, 'politica',p.policyname, 'cmd',p.cmd,
    'permisiva',p.permissive, 'roles',p.roles,
    'using',p.qual, 'with_check',p.with_check
  ) order by p.tablename, p.policyname),'[]'::jsonb)
  from pg_policies p join objetivos o on o.nombre = p.tablename
 where p.schemaname='public' and o.grupo='007'),

-- ── 2) Grants CONCEDIDOS, con TODOS los tipos de privilegio ───────────────
-- No solo select/insert/update/delete: también truncate, references, trigger
-- y maintain, que es lo que `revoke all` se lleva por delante.
'grants_concedidos', (select coalesce(jsonb_agg(jsonb_build_object(
    'objeto',g.table_name, 'grupo',o.grupo, 'rol',g.grantee,
    'privilegios',g.privs, 'con_grant_option',g.con_opcion
  ) order by g.table_name, g.grantee),'[]'::jsonb)
  from (select table_name, grantee,
               string_agg(privilege_type, ',' order by privilege_type) as privs,
               string_agg(distinct is_grantable, ',') as con_opcion
          from information_schema.role_table_grants
         where table_schema='public' and grantee in ('anon','authenticated','PUBLIC')
         group by table_name, grantee) g
  join objetivos o on o.nombre = g.table_name),

-- ── 3) Privilegios EFECTIVOS, que incluyen lo heredado ────────────────────
-- Los grants dicen lo concedido; esto dice lo que el rol puede de verdad.
'privilegios_efectivos', (select coalesce(jsonb_agg(jsonb_build_object(
    'objeto',c.relname, 'grupo',o.grupo,
    'anon',   (select string_agg(x,',' order by x) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x where has_table_privilege('anon',c.oid,x)),
    'authenticated', (select string_agg(x,',' order by x) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x where has_table_privilege('authenticated',c.oid,x))
  ) order by c.relname),'[]'::jsonb)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join objetivos o on o.nombre = c.relname
 where n.nspname='public'),

-- ── 4) reloptions de adm_ot_estado, que 005 cambia ────────────────────────
'adm_ot_estado_reloptions', (select coalesce(array_to_string(c.reloptions,', '),'(ninguna)')
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='adm_ot_estado'),

-- ── 5) El dueño de cada objeto, y si la tabla tiene RLS ───────────────────
'estado_objetos', (select coalesce(jsonb_agg(jsonb_build_object(
    'objeto',c.relname, 'clase',c.relkind, 'dueno',pg_get_userbyid(c.relowner),
    'rls',c.relrowsecurity) order by c.relname),'[]'::jsonb)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join objetivos o on o.nombre = c.relname
 where n.nspname='public'),

-- ── 6) EL ROLLBACK EXACTO, generado a partir de lo que hay ────────────────
-- Esto es lo que sustituye al rollback genérico. Cada línea sale de un grant
-- real, así que no puede conceder de más ni de menos.
'rollback_generado_grants', (select coalesce(jsonb_agg(linea order by linea),'[]'::jsonb)
  from (select format('grant %s on public.%I to %s;', g.privs, g.table_name,
                      case when g.grantee='PUBLIC' then 'public' else quote_ident(g.grantee) end) as linea
          from (select table_name, grantee,
                       string_agg(privilege_type, ', ' order by privilege_type) as privs
                  from information_schema.role_table_grants
                 where table_schema='public' and grantee in ('anon','authenticated','PUBLIC')
                 group by table_name, grantee) g
          join objetivos o on o.nombre = g.table_name) z),

-- Y las políticas de Safety, recreadas tal cual estaban.
'rollback_generado_politicas', (select coalesce(jsonb_agg(linea order by linea),'[]'::jsonb)
  from (select format('create policy %I on public.%I as %s for %s to %s%s%s;',
                 p.policyname, p.tablename,
                 case when p.permissive='PERMISSIVE' then 'permissive' else 'restrictive' end,
                 lower(p.cmd),
                 array_to_string(p.roles, ', '),
                 coalesce(' using (' || p.qual || ')', ''),
                 coalesce(' with check (' || p.with_check || ')', '')) as linea
          from pg_policies p join objetivos o on o.nombre = p.tablename
         where p.schemaname='public' and o.grupo='007') z),

-- ── 7) Y el de adm_ot_estado ──────────────────────────────────────────────
'rollback_generado_reloptions', (select
   case when coalesce(array_to_string(c.reloptions,','),'') like '%security_invoker%'
        then 'alter view public.adm_ot_estado set (security_invoker = ' ||
             (select regexp_replace(array_to_string(c.reloptions,','), '.*security_invoker=([a-z]+).*', '\1')) || ');'
        else 'alter view public.adm_ot_estado reset (security_invoker);' end
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='adm_ot_estado')

) as fotografia_previa;
