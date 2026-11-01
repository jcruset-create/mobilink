-- ─────────────────────────────────────────────────────────────────────────
-- VUELTA ATRÁS · importación del histórico de Plana (PR #492)
--
-- GENERADO por scripts/produccion/generar-preflight-sql.py. SOLO LECTURA:
-- esto NO deshace nada. IMPRIME el SQL que haría falta para devolver a su
-- estado actual los objetos que ya existen y que las migraciones van a
-- redefinir.
--
-- Se ejecuta ANTES de migrar y se guarda la salida. Si luego hay que volver
-- atrás, se pega esa salida y se añade el `drop` de lo que el PR crea nuevo
-- (que está en supabase/migrations/..., cada tabla con su nombre).
--
-- Son tres funciones y una vista: lo único vivo que las migraciones tocan
-- antes de que se importe nada. Todo lo demás que crean es nuevo, y lo nuevo
-- se deshace borrándolo.
--
-- Esto NO sustituye al backup: una función restaurada no devuelve los datos.
-- ─────────────────────────────────────────────────────────────────────────

select 'FUNCIÓN ' || p.oid::regprocedure::text as objeto,
       pg_get_functiondef(p.oid) || ';' as sql_para_restaurar
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.oid::regprocedure::text in (
     'tc_anular_operacion(uuid,text)',
     'tc_informes_inventario_por(uuid,text)',
     'tc_informes_inventario_marca_medida(uuid)')
union all
select 'VISTA ' || c.relname,
       'create or replace view public.' || c.relname || ' as' || E'
' ||
       pg_get_viewdef(c.oid, true) || E'
' ||
       coalesce((select string_agg('grant ' || lower(a.privilege_type) || ' on public.' || c.relname ||
                                   ' to ' || quote_ident(a.grantee) || ';', E'
')
                   from information_schema.role_table_grants a
                  where a.table_schema = 'public' and a.table_name = c.relname), '')
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v' and c.relname = 'tc_marcas_contadores'
 order by 1;
