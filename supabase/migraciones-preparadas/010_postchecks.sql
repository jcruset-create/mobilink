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
-- POSTCHECK DE 007 + 007b · Safety
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Reescrito el 2026-09-27. La versión anterior asumía 10 tablas `sea_*` y
-- producción tiene 19: las filas 9 y 10 daban FALLO sin que hubiera nada mal.
--
-- Ahora no hay ningún número fijo. Cada comprobación compara el conjunto
-- consigo mismo, así que sigue valiendo si mañana aparece una tabla `sea_`
-- más. El recuento total se muestra como dato, no como criterio.
--
-- Y separa dos cosas que la versión anterior mezclaba:
--
--   GRANT      lo que el catálogo concede  (`has_table_privilege`)
--   EFECTIVO   lo que se puede hacer de verdad, que además depende de que
--              exista una política de RLS que lo permita
--
-- Una tabla con RLS y sin política para `anon` no es escribible aunque el
-- grant esté puesto. Medir solo el grant exagera el problema; medir solo la
-- política se pierde la cerradura que falta. Aquí se miran las dos.

with sea as (
  select c.oid, c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'sea\_%'
)
select comprobacion, valor, esperado,
       case when valor = esperado then 'OK' else 'FALLO' end as resultado
  from (
  select '0· tablas sea_* en el esquema (dato, no criterio)' as comprobacion,
         (select count(*)::text from sea) as valor,
         (select count(*)::text from sea) as esperado
  union all select '1· todas tienen RLS activa',
         (select count(*) filter (where relrowsecurity)::text from sea),
         (select count(*)::text from sea)
  union all select '2· policies de anon que NO son SELECT',
         (select count(*)::text from pg_policies p join sea on sea.relname = p.tablename
           where p.schemaname='public' and 'anon' = any(p.roles) and p.cmd <> 'SELECT'), '0'
  union all select '3· policies de anon con WITH CHECK',
         (select count(*)::text from pg_policies p join sea on sea.relname = p.tablename
           where p.schemaname='public' and 'anon' = any(p.roles) and p.with_check is not null), '0'
  union all select '4· GRANT: tablas donde anon conserva INSERT',
         (select count(*)::text from sea where has_table_privilege('anon', oid, 'insert')), '0'
  union all select '5· GRANT: tablas donde anon conserva UPDATE',
         (select count(*)::text from sea where has_table_privilege('anon', oid, 'update')), '0'
  union all select '6· GRANT: tablas donde anon conserva DELETE',
         (select count(*)::text from sea where has_table_privilege('anon', oid, 'delete')), '0'
  union all select '7· EFECTIVO: tablas escribibles por anon (grant Y policy)',
         (select count(*)::text from sea
           where (has_table_privilege('anon', oid, 'insert') or has_table_privilege('anon', oid, 'update')
               or has_table_privilege('anon', oid, 'delete'))
             and exists (select 1 from pg_policies p where p.schemaname='public'
                          and p.tablename = sea.relname and 'anon' = any(p.roles)
                          and p.cmd in ('ALL','INSERT','UPDATE','DELETE'))), '0'
  union all select '8· LECTURA conservada en sea_employees',
         (select has_table_privilege('anon','sea_employees','select')::text), 'true'
  union all select '9· LECTURA conservada en sea_companies',
         (select has_table_privilege('anon','sea_companies','select')::text), 'true'
  union all select '10· LECTURA conservada en sea_work_centers',
         (select has_table_privilege('anon','sea_work_centers','select')::text), 'true'
  union all select '11· authenticated: policy en TODAS las tablas sea_*',
         (select count(distinct p.tablename)::text from pg_policies p join sea on sea.relname = p.tablename
           where p.schemaname='public' and 'authenticated' = any(p.roles)),
         (select count(*)::text from sea)
  union all select '12· authenticated conserva la escritura en TODAS',
         (select count(*)::text from sea where has_table_privilege('authenticated', oid, 'update')),
         (select count(*)::text from sea)
) x order by lpad(split_part(comprobacion, '·', 1), 3, '0');


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
