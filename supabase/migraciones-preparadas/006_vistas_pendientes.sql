/*
 * LAS 9 VISTAS QUE FALTAN — SOLO LECTURA
 *
 * Nueve de las catorce vistas se crearon a mano en el dashboard y su definición
 * no está en `supabase/migrations/`. Sin ella no se puede decidir su
 * corrección: no se sabe si son actualizables, qué columnas exponen ni qué
 * predicado llevan dentro.
 *
 * Una sentencia, solo lectura, una celda de salida.
 */

select jsonb_build_object(
'meta', jsonb_build_object('fecha',now(),'pg',version()),

-- Definición y actualizabilidad de las 14. `is_updatable` e
-- `is_insertable_into` los calcula PostgreSQL con sus propias reglas de
-- actualizabilidad automática: es la respuesta directa a «¿se puede escribir
-- a través de ella?», sin tener que deducirla de la definición.
'vistas', (select coalesce(jsonb_agg(jsonb_build_object(
    'v',v.table_name,
    'actualizable',v.is_updatable,
    'insertable',v.is_insertable_into,
    'invoker',coalesce(array_to_string(c.reloptions,',') like '%security_invoker=true%',false),
    'check_option',v.check_option,
    'definicion',v.view_definition
  ) order by v.table_name),'[]'::jsonb)
  from information_schema.views v
  join pg_class c on c.relname=v.table_name
  join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
 where v.table_schema='public'),

-- Columnas de cada vista: para clasificar qué dato sensible expone cada una.
'columnas', (select coalesce(jsonb_object_agg(v, cols),'{}'::jsonb)
  from (select c.relname as v,
               jsonb_agg(a.attname order by a.attnum) as cols
          from pg_class c
          join pg_namespace n on n.oid=c.relnamespace
          join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
         where n.nspname='public' and c.relkind in ('v','m')
         group by c.relname) x),

-- Y de paso, el dueño de las tablas base: una vista no-invoker corre como su
-- dueño, y el dueño de una TABLA no pasa por la RLS de esa tabla. Si los dueños
-- coinciden, el salto es total; si no, conviene saberlo.
'duenos_tablas_base', (select coalesce(jsonb_object_agg(t, dueno),'{}'::jsonb)
  from (select c.relname as t, pg_get_userbyid(c.relowner) as dueno
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relkind='r'
           and c.relname in ('clientes','productos_neumaticos','movimientos_stock',
                'traspasos','traspaso_lineas','centros','traspasos_auditoria',
                'adm_work_orders','adm_customers','tc_cat_marcas_neumatico',
                'tc_cat_modelos_neumatico','tc_neumaticos','tc_posiciones_vehiculo',
                'tc_tipos_vehiculo','tc_cat_aplicaciones_neumatico')) y)
) as informe;
