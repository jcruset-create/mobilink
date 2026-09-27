-- POSTCHECK de 014 · solo lectura. Las cinco filas tienen que salir OK.
select comprobacion, valor, esperado,
       case when valor = esperado then 'OK' else 'FALLO' end as resultado
  from (
  select '1· adm_ot_estado quedo como security_invoker' as comprobacion,
         (select coalesce(array_to_string(reloptions,','),'(ninguna)')
            from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname='adm_ot_estado') as valor,
         'security_invoker=true' as esperado
  union all select '2· anon sigue SIN acceso a la vista',
         (select has_table_privilege('anon','adm_ot_estado','select')::text), 'false'
  union all select '3· authenticated conserva el SELECT sobre la vista',
         (select has_table_privilege('authenticated','adm_ot_estado','select')::text), 'true'
  union all select '4· authenticated conserva el SELECT sobre las tablas base',
         -- Con invoker esto pasa a ser imprescindible: sin el, la pantalla da
         -- «permission denied for table», no una pantalla vacia.
         (select (has_table_privilege('authenticated','adm_work_orders','select')
              and has_table_privilege('authenticated','adm_customers','select'))::text), 'true'
  union all select '5· la vista sigue sin exponer total_amount',
         (select exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='adm_ot_estado'
                            and column_name='total_amount')::text), 'false'
) x order by comprobacion;
