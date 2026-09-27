/*
 * POSTCHECKS DE LAS TRES CONTENCIONES — SOLO LECTURA
 *
 * Tres consultas independientes. Se ejecuta la que toca después de cada
 * migración. Cada fila dice OK o FALLO; **no puede quedar ni un FALLO**.
 *
 * Cada bloque está separado para poder pegarlo suelto en el editor, que solo
 * muestra el resultado de la última sentencia.
 */


-- ═══════════════════════════════════════════════════════════════════════════
-- POSTCHECK DE 007 · Safety
-- ═══════════════════════════════════════════════════════════════════════════

select comprobacion, valor, esperado,
       case when valor = esperado then 'OK' else 'FALLO' end as resultado
  from (
  select '1· policies de escritura de anon sobre sea_*' as comprobacion,
         (select count(*)::text from pg_policies
           where schemaname='public' and tablename like 'sea\_%'
             and 'anon' = any(roles) and cmd <> 'SELECT') as valor,
         '0' as esperado
  union all select '2· policies de anon con WITH CHECK sobre sea_*',
         (select count(*)::text from pg_policies
           where schemaname='public' and tablename like 'sea\_%'
             and 'anon' = any(roles) and with_check is not null), '0'
  union all select '3· tablas sea_* donde anon puede INSERT',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='r' and c.relname like 'sea\_%'
             and has_table_privilege('anon',c.oid,'insert')), '0'
  union all select '4· tablas sea_* donde anon puede UPDATE',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='r' and c.relname like 'sea\_%'
             and has_table_privilege('anon',c.oid,'update')), '0'
  union all select '5· tablas sea_* donde anon puede DELETE',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='r' and c.relname like 'sea\_%'
             and has_table_privilege('anon',c.oid,'delete')), '0'
  union all select '6· LECTURA conservada en sea_employees',
         (select has_table_privilege('anon','sea_employees','select')::text), 'true'
  union all select '7· LECTURA conservada en sea_companies',
         (select has_table_privilege('anon','sea_companies','select')::text), 'true'
  union all select '8· LECTURA conservada en sea_work_centers',
         (select has_table_privilege('anon','sea_work_centers','select')::text), 'true'
  union all select '9· policies de authenticated intactas (sea_auth_all)',
         (select count(*)::text from pg_policies
           where schemaname='public' and tablename like 'sea\_%'
             and 'authenticated' = any(roles)), '10'
  union all select '10· authenticated conserva la escritura',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='r' and c.relname like 'sea\_%'
             and has_table_privilege('authenticated',c.oid,'update')), '10'
) x order by comprobacion;


-- ═══════════════════════════════════════════════════════════════════════════
-- POSTCHECK DE 005 · las cuatro vistas demostradas
-- ═══════════════════════════════════════════════════════════════════════════

select comprobacion, valor, esperado,
       case when valor = esperado then 'OK' else 'FALLO' end as resultado
  from (
  with v(nombre) as (values ('adm_ot_estado'),('tc_clientes_almacen'),
                            ('tc_productos_almacen'),('tc_marcas_contadores'))
  select '1· vistas de 005 con CUALQUIER acceso de anon' as comprobacion,
         (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
            join v on v.nombre=c.relname
           where n.nspname='public'
             and (has_table_privilege('anon',c.oid,'select') or has_table_privilege('anon',c.oid,'insert')
               or has_table_privilege('anon',c.oid,'update') or has_table_privilege('anon',c.oid,'delete'))) as valor,
         '0' as esperado
  union all select '2· vistas de 005 con escritura de authenticated',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
            join v on v.nombre=c.relname
           where n.nspname='public'
             and (has_table_privilege('authenticated',c.oid,'insert')
               or has_table_privilege('authenticated',c.oid,'update')
               or has_table_privilege('authenticated',c.oid,'delete'))), '0'
  union all select '3· authenticated conserva la LECTURA de las cuatro',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
            join v on v.nombre=c.relname
           where n.nspname='public' and has_table_privilege('authenticated',c.oid,'select')), '4'
  union all select '4· adm_ot_estado quedo como security_invoker',
         (select coalesce(array_to_string(c.reloptions,','),'(ninguna)')
            from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname='adm_ot_estado'), 'security_invoker=true'
) x order by comprobacion;


-- ═══════════════════════════════════════════════════════════════════════════
-- POSTCHECK DE 008 · las nueve vistas sin consumidor
-- ═══════════════════════════════════════════════════════════════════════════

select comprobacion, valor, esperado,
       case when valor = esperado then 'OK' else 'FALLO' end as resultado
  from (
  with v(nombre) as (values ('kpis_traspasos'),('movimientos_stock_detalle'),('stock_actual'),
    ('stock_actual_detalle'),('tc_modelos_aplicacion_sin_clasificar'),('tc_tipos_plano_descuadrado'),
    ('traspasos_detalle'),('traspasos_lineas_detalle'),('traspasos_resumen_lineas'))
  select '1· las nueve SIN select para anon' as comprobacion,
         (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
            join v on v.nombre=c.relname
           where n.nspname='public' and has_table_privilege('anon',c.oid,'select')) as valor,
         '0' as esperado
  union all select '2· ninguna escritura para anon',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
            join v on v.nombre=c.relname
           where n.nspname='public'
             and (has_table_privilege('anon',c.oid,'insert') or has_table_privilege('anon',c.oid,'update')
               or has_table_privilege('anon',c.oid,'delete'))), '0'
  union all select '3· ninguna escritura para authenticated',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
            join v on v.nombre=c.relname
           where n.nspname='public'
             and (has_table_privilege('authenticated',c.oid,'insert')
               or has_table_privilege('authenticated',c.oid,'update')
               or has_table_privilege('authenticated',c.oid,'delete'))), '0'
  union all select '4· SELECT de authenticated: 9 de 9',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
            join v on v.nombre=c.relname
           where n.nspname='public' and has_table_privilege('authenticated',c.oid,'select')), '9'
  union all select '5· traspasos_auditoria_detalle NO se ha tocado (caso F)',
         (select has_table_privilege('anon','traspasos_auditoria_detalle','select')::text), 'true'
) x order by comprobacion;
