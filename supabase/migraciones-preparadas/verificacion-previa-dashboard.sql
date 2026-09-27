/*
 * ════════════════════════════════════════════════════════════════════════════
 *  VERIFICACIÓN PREVIA · VERSIÓN PARA EL EDITOR SQL DE SUPABASE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Es `verificacion-previa.sql` sin los `\echo`, que son meta-órdenes de `psql` y
 * en el editor del dashboard dan error de sintaxis.
 *
 * SOLO LECTURA. No crea, no altera y no borra nada: todo sale de `pg_catalog` e
 * `information_schema`. Se puede ejecutar en producción sin ventana.
 *
 * ── CÓMO USARLO ────────────────────────────────────────────────────────────
 *
 * CONSULTA A (una sola). Devuelve UNA celda con todo el informe en JSON.
 * Es la vía rápida: se pega, se ejecuta, se copia la celda y se pega de vuelta.
 * Si la celda sale cortada en la pantalla, usar el botón de descarga del
 * resultado en vez de seleccionar con el ratón.
 *
 * CONSULTA B (buckets de Storage). Va aparte porque es la única que puede
 * fallar por permisos: si el rol no ve el esquema `storage`, la A entera
 * abortaría. Si da error, no pasa nada: se mira en el panel de Storage.
 *
 * CONSULTAS C.1 a C.13. Las mismas de siempre, una por una, por si se prefiere
 * ver cada cosa en su tabla en vez de en un JSON.
 *
 * ── LO QUE NO HAY QUE PEGAR DE VUELTA ──────────────────────────────────────
 *
 * Nada de aquí devuelve secretos: ni contraseñas, ni tokens, ni claves, ni
 * `service_role`, ni contenido de filas de negocio. Son nombres de tablas,
 * nombres de roles, nombres de privilegios, nombres de funciones, recuentos y
 * los predicados de las políticas.
 *
 * Dos excepciones que conviene mirar antes de pegar la salida:
 *
 *   · C.7 (colisiones de nombre de usuario) devuelve NOMBRES DE USUARIO reales.
 *     Son datos personales. Para el GO/NO-GO de la Fase 0 no hacen falta: basta
 *     el recuento. Si se prefiere, ejecutar C.7b, que da solo el número.
 *   · C.3 y C.4 devuelven el texto de las políticas. Si alguna llevara un valor
 *     literal sensible dentro del predicado, saldría. Es improbable, pero es la
 *     única superficie donde podría pasar.
 */


-- ═══════════════════════════════════════════════════════════════════════════
-- CONSULTA A · el informe completo en una sola celda
-- ═══════════════════════════════════════════════════════════════════════════
-- Pegar desde aquí hasta el punto y coma, ejecutar, copiar la celda.

with lista_migracion(tabla) as (
  -- Las 88 tablas que la migración 001 pretende cerrar. Están aquí para que la
  -- base compare ella misma su estado real contra lo que el repositorio cree,
  -- y salga clasificado en vez de a ojo.
  select unnest(array[
    'app_zonas',
    'cash_advances',
    'cash_bank_deposit_sessions',
    'cash_bank_deposits',
    'cash_change_order_lines',
    'cash_change_orders',
    'cash_count_lines',
    'cash_counts',
    'cash_denomination_movements',
    'cash_denominations',
    'cash_document_counters',
    'cash_erp_configs',
    'cash_erp_logs',
    'cash_erp_outbox',
    'cash_event_outbox',
    'cash_external_documents',
    'cash_operation_documents',
    'cash_operation_payments',
    'cash_operations',
    'cash_payment_methods',
    'cash_reauth',
    'cash_registers',
    'cash_sessions',
    'cash_transfer_lines',
    'cash_transfers',
    'central_api_clients',
    'central_api_tokens',
    'central_bank_deposits',
    'central_bank_statements',
    'central_denomination_stock',
    'central_deposit_sources',
    'central_events',
    'central_float_topups',
    'central_incidents',
    'central_notification_channels',
    'central_notifications',
    'central_registers',
    'central_rules',
    'central_sessions',
    'central_statement_lines',
    'central_transits',
    'central_webhook_deliveries',
    'central_webhooks',
    'erp_articulo_plantilla',
    'orm_avisos',
    'orm_blocs',
    'orm_config',
    'orm_documentos',
    'orm_entregas',
    'orm_eventos',
    'orm_or',
    'orm_procesamientos',
    'rcp_albaran_lineas',
    'rcp_albaranes',
    'rcp_avisos',
    'rcp_buzon_pasadas',
    'rcp_config',
    'rcp_contadores',
    'rcp_correos',
    'rcp_documentos',
    'rcp_eventos',
    'rcp_incidencias',
    'rcp_operarios',
    'rcp_pedido_lineas',
    'rcp_pedidos',
    'rcp_proveedor_articulos',
    'rcp_proveedores',
    'rcp_recepcion_lineas',
    'rcp_recepciones',
    'rcp_rectificacion_lineas',
    'rcp_rectificaciones',
    'recepciones_vehiculo',
    'recordatorios_caducidad',
    'tac_centros',
    'tac_comunicaciones',
    'tac_documentos',
    'tac_expedientes',
    'tac_firmas',
    'tac_plantillas',
    'tc_contadores_numero_interno',
    'tc_contadores_numero_operacion',
    'thf_albaran_linea_descuentos',
    'thf_albaran_lineas',
    'thf_albaranes_analizados',
    'thf_buzon_pasadas',
    'thf_documentos',
    'thf_validaciones',
    'vacaciones_config'
  ])
),
tablas_public as (
  select c.oid, c.relname as tabla, c.relrowsecurity as rls,
         pg_total_relation_size(c.oid) as bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
clasificacion as (
  select coalesce(t.tabla, l.tabla) as tabla,
         (l.tabla is not null)     as en_la_migracion,
         (t.tabla is not null)     as existe,
         t.rls,
         case
           when l.tabla is not null and t.tabla is null            then 'A_en_migracion_pero_no_existe'
           when l.tabla is not null and not t.rls                  then 'B_en_migracion_y_sin_rls'
           when l.tabla is not null and t.rls                      then 'C_en_migracion_y_ya_con_rls'
           when l.tabla is null     and not t.rls                  then 'D_fuera_de_la_migracion_y_sin_rls'
           else 'E_fuera_de_la_migracion_y_con_rls'
         end as grupo
    from lista_migracion l
    full outer join tablas_public t on t.tabla = l.tabla
),
-- Permisos EFECTIVOS, que no es lo mismo que los concedidos: has_table_privilege
-- resuelve la herencia, así que aquí sale también lo que anon recibe por ser
-- miembro de PUBLIC. Es la dimensión que se colaba mirando solo los grants.
efectivos as (
  select t.tabla, t.rls,
         has_table_privilege('anon', t.oid, 'select') as anon_select,
         has_table_privilege('anon', t.oid, 'insert') as anon_insert,
         has_table_privilege('anon', t.oid, 'update') as anon_update,
         has_table_privilege('anon', t.oid, 'delete') as anon_delete,
         has_table_privilege('authenticated', t.oid, 'select') as auth_select,
         has_table_privilege('authenticated', t.oid, 'insert') as auth_insert,
         has_table_privilege('authenticated', t.oid, 'update') as auth_update,
         has_table_privilege('authenticated', t.oid, 'delete') as auth_delete
    from tablas_public t
)
select jsonb_build_object(

  'meta', jsonb_build_object(
    'generado_en', now(),
    'base', current_database(),
    'rol_que_consulta', current_user,
    'version', version(),
    'tablas_en_la_lista_de_la_migracion', (select count(*) from lista_migracion)
  ),

  -- C.8 · el recuento de cabecera
  'b08_recuento', (
    select jsonb_build_object(
      'tablas_public', count(*),
      'con_rls', count(*) filter (where rls),
      'sin_rls', count(*) filter (where not rls)
    ) from tablas_public
  ),

  -- Clasificación de las 4 vías. Es lo que decide si la lista de 88 sigue
  -- valiendo o hay que revisarla.
  'b14_clasificacion_resumen', (
    select coalesce(jsonb_object_agg(grupo, n), '{}'::jsonb)
      from (select grupo, count(*) as n from clasificacion group by grupo) x
  ),
  'b14a_en_migracion_pero_no_existe', (
    select coalesce(jsonb_agg(tabla order by tabla), '[]'::jsonb)
      from clasificacion where grupo = 'A_en_migracion_pero_no_existe'
  ),
  'b14b_en_migracion_y_sin_rls', (
    select coalesce(jsonb_agg(tabla order by tabla), '[]'::jsonb)
      from clasificacion where grupo = 'B_en_migracion_y_sin_rls'
  ),
  'b14c_en_migracion_y_ya_con_rls', (
    select coalesce(jsonb_agg(tabla order by tabla), '[]'::jsonb)
      from clasificacion where grupo = 'C_en_migracion_y_ya_con_rls'
  ),
  'b14d_fuera_de_la_migracion_y_sin_rls', (
    -- Las creadas a mano en el dashboard. Son las que nadie ha decidido.
    select coalesce(jsonb_agg(tabla order by tabla), '[]'::jsonb)
      from clasificacion where grupo = 'D_fuera_de_la_migracion_y_sin_rls'
  ),

  -- C.1 · todas las tablas sin RLS, con tamaño
  'b01_tablas_sin_rls', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tabla', tabla,
             'tamano', pg_size_pretty(bytes),
             'en_la_migracion', exists (select 1 from lista_migracion l where l.tabla = t.tabla)
           ) order by bytes desc), '[]'::jsonb)
      from tablas_public t where not rls
  ),

  -- C.2 · grants CONCEDIDOS a anon / authenticated sobre tablas sin RLS
  'b02_grants_concedidos_sin_rls', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tabla', table_name, 'rol', grantee, 'permisos', permisos
           ) order by table_name, grantee), '[]'::jsonb)
      from (
        select g.table_name, g.grantee,
               string_agg(g.privilege_type, ', ' order by g.privilege_type) as permisos
          from information_schema.role_table_grants g
          join tablas_public t on t.tabla = g.table_name
         where g.table_schema = 'public'
           and g.grantee in ('anon', 'authenticated')
           and not t.rls
         group by g.table_name, g.grantee
      ) y
  ),

  -- Permisos EFECTIVOS, herencia de PUBLIC incluida. Dimensión distinta de la
  -- RLS: una tabla puede tener RLS activa y seguir dando permiso de tabla, y al
  -- contrario. Se listan las dos cosas juntas a propósito.
  'b02b_permisos_efectivos', (
    select coalesce(jsonb_agg(to_jsonb(e) order by e.tabla), '[]'::jsonb)
      from efectivos e
     where e.anon_select or e.anon_insert or e.anon_update or e.anon_delete
        or e.auth_select or e.auth_insert or e.auth_update or e.auth_delete
  ),

  -- C.9 · lo concedido a PUBLIC, que es de donde venía la herencia
  'b09_grants_a_public', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tabla', table_name, 'permiso', privilege_type
           ) order by table_name, privilege_type), '[]'::jsonb)
      from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'PUBLIC'
  ),

  -- C.3 · políticas con predicado siempre cierto (tamaño del trabajo de Fase 3)
  'b03_politicas_permisivas', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tabla', tablename, 'politica', policyname, 'roles', roles, 'cmd', cmd
           ) order by tablename, policyname), '[]'::jsonb)
      from pg_policies
     where schemaname = 'public' and (qual = 'true' or with_check = 'true')
  ),

  -- C.4 · políticas abiertas a anon (las que la migración retira)
  'b04_politicas_anon', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tabla', tablename, 'politica', policyname, 'cmd', cmd,
             'using', qual, 'with_check', with_check
           ) order by tablename, policyname), '[]'::jsonb)
      from pg_policies
     where schemaname = 'public' and 'anon' = any(roles)
  ),

  -- Todas las políticas de las tablas que la migración toca: hace falta para
  -- saber si activar RLS sin políticas deja fuera a alguien.
  'b04b_politicas_de_las_tablas_de_la_migracion', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'tabla', p.tablename, 'politica', p.policyname, 'cmd', p.cmd, 'roles', p.roles
           ) order by p.tablename, p.policyname), '[]'::jsonb)
      from pg_policies p
      join lista_migracion l on l.tabla = p.tablename
     where p.schemaname = 'public'
  ),

  -- C.10 · funciones: quién puede ejecutarlas y cuántas security definer
  'b10_funciones', (
    select jsonb_build_object(
      'puede_anon', count(*) filter (where has_function_privilege('anon', p.oid, 'execute')),
      'puede_authenticated', count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute')),
      'security_definer', count(*) filter (where p.prosecdef),
      'secdef_sin_pg_temp', count(*) filter (
        where p.prosecdef
          and not coalesce(array_to_string(p.proconfig, ','), '') like '%pg_temp%'),
      'funciones_totales', count(*)
    )
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  ),

  -- C.11 · las security definer sin pg_temp. Sin límite: el recuento de arriba
  -- dice cuántas son, y aquí interesan todas para la migración de SEC-067.
  'b11_secdef_sin_pg_temp', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'firma', p.oid::regprocedure::text,
             'config', coalesce(array_to_string(p.proconfig, ', '), '(sin search_path)')
           ) order by p.oid::regprocedure::text), '[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and not coalesce(array_to_string(p.proconfig, ','), '') like '%pg_temp%'
  ),

  -- Las tres funciones que la migración endurece, con su estado de hoy. Si aquí
  -- alguna ya lleva pg_temp, la sección 7 no tiene nada que hacer con ella.
  'b11b_funciones_de_la_migracion', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'firma', p.oid::regprocedure::text,
             'security_definer', p.prosecdef,
             'config', coalesce(array_to_string(p.proconfig, ', '), '(sin search_path)'),
             'puede_anon', has_function_privilege('anon', p.oid, 'execute'),
             'puede_authenticated', has_function_privilege('authenticated', p.oid, 'execute'),
             'puede_public', has_function_privilege('public', p.oid, 'execute')
           ) order by p.oid::regprocedure::text), '[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_es_admin', 'app_empresa_actual', 'app_login_email',
                         'app_guardar_usuario', 'app_eliminar_usuario')
  ),

  -- Las dos tablas que la migración CREA: si ya existieran, hay que mirar por qué.
  'b15_tablas_que_la_migracion_crea', (
    select jsonb_build_object(
      'app_bajas_auth', to_regclass('public.app_bajas_auth') is not null,
      'app_auth_intentos', to_regclass('public.app_auth_intentos') is not null,
      'perfiles_usuario', to_regclass('public.perfiles_usuario') is not null,
      'pres_records', to_regclass('public.pres_records') is not null,
      'sm_document_acknowledgements', to_regclass('public.sm_document_acknowledgements') is not null
    )
  ),

  -- Los disparadores que la migración crea, por si ya hubiera algo con ese nombre.
  'b16_disparadores_de_app_usuarios', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'nombre', t.tgname, 'funcion', p.proname, 'activado', t.tgenabled
           ) order by t.tgname), '[]'::jsonb)
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
     where n.nspname = 'public' and c.relname = 'app_usuarios' and not t.tgisinternal
  ),

  -- C.6 · superadministradores (decide el diseño de la recuperación de Fase 1C)
  'b06_superadmins', (
    select jsonb_build_object(
      'superadministradores', count(*) filter (where es_superadmin),
      'superadmins_sin_email_de_recuperacion',
        count(*) filter (where es_superadmin and coalesce(email_recuperacion, '') = ''),
      'usuarios_activos_totales', count(*)
    ) from app_usuarios where activo
  ),

  -- C.7 · colisiones de nombre de usuario: SOLO EL RECUENTO, sin los nombres.
  -- Los nombres van en C.7 aparte, para no meter datos personales aquí.
  'b07_colisiones_username', (
    select jsonb_build_object(
      'grupos_en_colision', count(*),
      'cuentas_afectadas', coalesce(sum(cuentas), 0)
    ) from (
      select count(*) as cuentas
        from app_usuarios
       group by lower(translate(regexp_replace(btrim(username), '\s+', '.', 'g'),
                'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç',
                'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc'))
      having count(*) > 1
    ) z
  ),

  -- C.13 · precondición del ataque por search_path
  'b13_temp', (
    select jsonb_build_object(
      'authenticated_puede_temp', has_database_privilege('authenticated', current_database(), 'TEMP'),
      'anon_puede_temp', has_database_privilege('anon', current_database(), 'TEMP')
    )
  )

) as informe;


-- ═══════════════════════════════════════════════════════════════════════════
-- CONSULTA B · buckets de Storage (aparte, porque puede fallar por permisos)
-- ═══════════════════════════════════════════════════════════════════════════
-- Si da «permission denied for schema storage», no es un problema: significa que
-- el rol del editor no ve ese esquema. Se mira entonces en el panel de Storage,
-- columna «Public».

select id, name, public, created_at
  from storage.buckets
 order by public desc, name;


-- ═══════════════════════════════════════════════════════════════════════════
-- CONSULTAS C · las mismas, una por una
-- ═══════════════════════════════════════════════════════════════════════════
-- El editor del dashboard muestra solo el resultado de la ÚLTIMA consulta que
-- se ejecuta. Así que estas se lanzan de una en una: se selecciona el bloque
-- con el ratón y se ejecuta la selección.


-- ── C.1 · todas las tablas de public sin RLS ────────────────────────────────
-- Si aquí aparecen tablas que no están en la lista de 88 de la migración, son
-- las creadas a mano en el dashboard. Hay que decidir sobre ellas antes de
-- seguir: la lista de la migración es un suelo, no un techo.

select c.relname as tabla,
       pg_size_pretty(pg_total_relation_size(c.oid)) as tamano
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and not c.relrowsecurity
 order by pg_total_relation_size(c.oid) desc;


-- ── C.2 · qué puede hacer hoy la clave pública sobre esas tablas ────────────
-- Grants CONCEDIDOS. Ojo: esto NO ve la herencia de PUBLIC. Para los permisos
-- efectivos, C.2b.

select g.table_name,
       g.grantee,
       string_agg(g.privilege_type, ', ' order by g.privilege_type) as permisos
  from information_schema.role_table_grants g
  join pg_class c on c.relname = g.table_name
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
 where g.table_schema = 'public'
   and g.grantee in ('anon', 'authenticated')
   and not c.relrowsecurity
 group by g.table_name, g.grantee
 order by g.table_name, g.grantee;


-- ── C.2b · permisos EFECTIVOS, con la herencia de PUBLIC resuelta ───────────
-- Esta es la consulta que importa, y la que C.2 no da. `has_table_privilege`
-- resuelve la pertenencia a PUBLIC, así que una tabla a la que nunca se le
-- concedió nada a `anon` puede salir aquí con `anon_select` en cierto.
--
-- Y va con la columna `rls` al lado a propósito: RLS y permisos de tabla son
-- DOS controles independientes. Las cuatro combinaciones existen, y solo una
-- es segura:
--
--   rls = true,  sin permiso  → cerrado por los dos lados
--   rls = true,  con permiso  → depende enteramente de las políticas
--   rls = false, sin permiso  → cerrado solo por el permiso
--   rls = false, con permiso  → abierto a quien tenga la clave pública

select c.relname as tabla,
       c.relrowsecurity as rls,
       has_table_privilege('anon', c.oid, 'select') as anon_select,
       has_table_privilege('anon', c.oid, 'insert') as anon_insert,
       has_table_privilege('anon', c.oid, 'update') as anon_update,
       has_table_privilege('anon', c.oid, 'delete') as anon_delete,
       has_table_privilege('authenticated', c.oid, 'select') as auth_select,
       has_table_privilege('authenticated', c.oid, 'insert') as auth_insert,
       has_table_privilege('authenticated', c.oid, 'update') as auth_update,
       has_table_privilege('authenticated', c.oid, 'delete') as auth_delete
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and (has_table_privilege('anon', c.oid, 'select')
     or has_table_privilege('anon', c.oid, 'insert')
     or has_table_privilege('anon', c.oid, 'update')
     or has_table_privilege('anon', c.oid, 'delete')
     or has_table_privilege('authenticated', c.oid, 'select')
     or has_table_privilege('authenticated', c.oid, 'insert')
     or has_table_privilege('authenticated', c.oid, 'update')
     or has_table_privilege('authenticated', c.oid, 'delete'))
 order by c.relrowsecurity, c.relname;


-- ── C.3 · políticas con predicado siempre cierto (para la Fase 3) ───────────
-- No se tocan en esta migración; se listan para tener el tamaño del trabajo.

select tablename, policyname, roles, cmd
  from pg_policies
 where schemaname = 'public'
   and (qual = 'true' or with_check = 'true')
 order by tablename, policyname;


-- ── C.4 · políticas abiertas a anon (las que SÍ se retiran) ─────────────────

select tablename, policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and 'anon' = any(roles)
 order by tablename, policyname;


-- ── C.5 · cuántas funciones puede ejecutar anon hoy ─────────────────────────
-- Recuento antes, para comparar después. El desglose está en C.10.

select count(*) as funciones_ejecutables_por_anon
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and has_function_privilege('anon', p.oid, 'execute');


-- ── C.6 · cuántos superadministradores hay (para la Fase 1C) ────────────────
-- Si sale 1, la recuperación con doble aprobación no se puede montar todavía y
-- hace falta el procedimiento de rotura de cristal.

select count(*) filter (where es_superadmin) as superadministradores,
       count(*) filter (where es_superadmin and coalesce(email_recuperacion, '') = '')
         as superadmins_sin_email_de_recuperacion,
       count(*) as usuarios_totales
  from app_usuarios
 where activo;


-- ── C.7b · colisiones de nombre de usuario, SOLO EL RECUENTO ───────────────
-- Esta es la que hay que ejecutar si no se quieren mover nombres de usuario
-- reales fuera de la base. Para el GO/NO-GO basta con el número.

select count(*) as grupos_en_colision,
       coalesce(sum(cuentas), 0) as cuentas_afectadas
  from (
    select count(*) as cuentas
      from app_usuarios
     group by lower(
               translate(
                 regexp_replace(btrim(username), '\s+', '.', 'g'),
                 'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç',
                 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc'
               ))
    having count(*) > 1
  ) x;


-- ── C.7 · las colisiones con los nombres ───────────────────────────────────
-- DEVUELVE NOMBRES DE USUARIO REALES: son datos personales. Solo hace falta
-- cuando haya que resolver las colisiones de verdad, ya en la Fase 1A, y
-- entonces se mira en la base sin sacarlo de ahí. Para el precheck, C.7b.
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


-- ── C.8 · recuento de tablas de public, y cuántas sin RLS ──────────────────

select count(*) as tablas_public,
       count(*) filter (where relrowsecurity) as con_rls,
       count(*) filter (where not relrowsecurity) as sin_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r';


-- ── C.9 · privilegios concedidos a PUBLIC (el caso que se colaba) ──────────
-- `revoke ... from anon` no quita nada de lo concedido a PUBLIC, porque anon
-- hereda de PUBLIC. Estas filas son las que hay que mirar dos veces, y son la
-- razón de que la migración haga `revoke ... from public` ANTES que de anon.

select table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'PUBLIC'
 order by 1, 2;


-- ── C.9b · lo mismo para funciones ─────────────────────────────────────────
-- El defecto de PostgreSQL concede EXECUTE a PUBLIC en cada función que se
-- crea. Es lo que dejaba `app_login_email` abierta después de quitarla de anon.

select count(*) as funciones_ejecutables_por_public
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and has_function_privilege('public', p.oid, 'execute');


-- ── C.10 · funciones ejecutables por anon / authenticated / PUBLIC ─────────

select
  count(*) filter (where has_function_privilege('anon', p.oid, 'execute'))          as puede_anon,
  count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute')) as puede_authenticated,
  count(*) filter (where has_function_privilege('public', p.oid, 'execute'))        as puede_public,
  count(*) filter (where p.prosecdef)                                               as security_definer,
  count(*) filter (where p.prosecdef and not coalesce(array_to_string(p.proconfig, ','), '') like '%pg_temp%')
                                                                                    as secdef_sin_pg_temp,
  count(*)                                                                          as funciones_totales
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public';


-- ── C.11 · las SECURITY DEFINER sin pg_temp en su search_path ─────────────
-- Suplantables con una tabla temporal por quien tenga conexión directa a la
-- base. `app_es_admin` es la que abre `app_guardar_usuario`.
--
-- SIN `limit`: la versión de psql llevaba `limit 50` para no llenar la pantalla,
-- y aquí interesan todas, porque de esta lista sale el inventario de SEC-067.

select p.oid::regprocedure as firma,
       coalesce(array_to_string(p.proconfig, ', '), '(sin search_path)') as config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and not coalesce(array_to_string(p.proconfig, ','), '') like '%pg_temp%'
 order by 1;


-- ── C.11b · las cinco funciones que la migración toca, con su estado ──────
-- Si alguna ya lleva pg_temp, la sección 7 de la migración no tiene nada que
-- hacer con ella. Si `app_login_email` ya sale con `puede_public` en falso, la
-- sección 6 tampoco.

select p.oid::regprocedure as firma,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ', '), '(sin search_path)') as config,
       has_function_privilege('anon', p.oid, 'execute') as puede_anon,
       has_function_privilege('authenticated', p.oid, 'execute') as puede_authenticated,
       has_function_privilege('public', p.oid, 'execute') as puede_public
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('app_es_admin', 'app_empresa_actual', 'app_login_email',
                     'app_guardar_usuario', 'app_eliminar_usuario')
 order by 1;


-- ── C.12 · buckets de Storage ──────────────────────────────────────────────
-- Es la CONSULTA B de arriba. Se repite aquí solo para no romper la numeración
-- respecto a `verificacion-previa.sql`.

select id, name, public, created_at from storage.buckets order by public desc, name;


-- ── C.13 · ¿puede authenticated crear tablas temporales? ───────────────────
-- Es la precondición del ataque por search_path de SEC-067. Si sale falso, el
-- riesgo baja: sin TEMP no se puede suplantar una tabla.

select has_database_privilege('authenticated', current_database(), 'TEMP') as authenticated_temp,
       has_database_privilege('anon', current_database(), 'TEMP') as anon_temp;


-- ── C.14 · lo que la migración crea, por si ya existiera ───────────────────
-- Si `app_bajas_auth` o `app_auth_intentos` ya están, hay que mirar por qué
-- antes de aplicar: el `create table if not exists` las dejaría como estén, con
-- las columnas que tengan, y el código espera las de la migración.

select 'app_bajas_auth' as objeto, to_regclass('public.app_bajas_auth') is not null as existe
union all select 'app_auth_intentos', to_regclass('public.app_auth_intentos') is not null
union all select 'perfiles_usuario', to_regclass('public.perfiles_usuario') is not null
union all select 'pres_records', to_regclass('public.pres_records') is not null
union all select 'sm_document_acknowledgements', to_regclass('public.sm_document_acknowledgements') is not null
order by 1;


-- ── C.15 · disparadores que ya hay en app_usuarios ─────────────────────────
-- La migración crea tres. Si ya existe alguno con esos nombres, el
-- `drop trigger if exists` lo sustituye: conviene saber qué se sustituye.

select t.tgname as disparador, p.proname as funcion, t.tgenabled as activado
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
 where n.nspname = 'public' and c.relname = 'app_usuarios' and not t.tgisinternal
 order by 1;
