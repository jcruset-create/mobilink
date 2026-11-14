-- ─────────────────────────────────────────────────────────────────────────
-- ¿ESTÁN LAS TRES MIGRACIONES COMPLETAS? · histórico de Plana (PR #492)
--
-- GENERADO por scripts/produccion/generar-preflight-sql.py --comprobar
-- SOLO LECTURA.
--
-- Se pasa DESPUÉS de aplicar las migraciones. Comprueba una a una las 9
-- tablas, las 2 vistas, las 29 firmas y las 22 columnas que tienen que haber
-- quedado, que la RLS está activa en lo nuevo, y que no se ha importado nada
-- todavía.
--
-- Si falta algo, la solución es volver a pasar la migración que lo crea: las
-- tres son idempotentes y aplicarlas de nuevo no duplica nada.
-- ─────────────────────────────────────────────────────────────────────────

with
t(x) as (values ('tc_importacion_bloqueados'), ('tc_importacion_cargas'), ('tc_importacion_eventos'), ('tc_importacion_intervenciones'), ('tc_importacion_lineas'), ('tc_importacion_lotes'), ('tc_reconstruccion_ajustes'), ('tc_reconstruccion_montajes'), ('tc_reconstruccion_revisiones')),
v(x) as (values ('tc_marcas_contadores'), ('tc_reconstruccion_intervalos')),
f(x) as (values ('public.tc_anular_operacion(uuid, text)'), ('public.tc_deshacer_importacion(uuid, uuid[], boolean)'), ('public.tc_imp_ampliar_carga(uuid, boolean)'), ('public.tc_imp_ampliar_intervencion(uuid)'), ('public.tc_imp_anotar_bloqueado(uuid, uuid, text, jsonb, text)'), ('public.tc_imp_bloquear(uuid, text)'), ('public.tc_imp_desfase_mano_obra(uuid)'), ('public.tc_imp_exigir_admin(uuid)'), ('public.tc_imp_ficha_historica(uuid, uuid, text, text, uuid, text, text, text)'), ('public.tc_imp_fijar_limite_km_dia(uuid, numeric)'), ('public.tc_imp_huella_estado(uuid)'), ('public.tc_imp_huella_intervalo(uuid)'), ('public.tc_imp_identificar_unidad(uuid, uuid, boolean, text)'), ('public.tc_imp_intervalo_duda_continuidad(tc_reconstruccion_montajes)'), ('public.tc_imp_intervalo_duda_km(tc_reconstruccion_montajes)'), ('public.tc_imp_intervalo_en_medias(tc_reconstruccion_montajes)'), ('public.tc_imp_intervalo_motivos(tc_reconstruccion_montajes)'), ('public.tc_imp_limite_km_dia(uuid)'), ('public.tc_imp_medianoche(date)'), ('public.tc_imp_num(numeric)'), ('public.tc_imp_posiciones_norma(uuid, int, boolean)'), ('public.tc_imp_reconstruir_vehiculo(uuid)'), ('public.tc_imp_revisar_intervalo(uuid, text, text, text)'), ('public.tc_importar_historico(uuid, text, jsonb, boolean)'), ('public.tc_informes_inventario_marca_medida(uuid)'), ('public.tc_informes_inventario_por(uuid, text)'), ('public.tc_informes_inventario_resumen(uuid)'), ('public.tc_informes_montajes(uuid, date, date, text)'), ('public.tc_informes_recorridos_estimados(uuid, date, date, uuid)')),
c(tab, col) as (values ('operaciones_neumaticos', 'condicion'), ('operaciones_neumaticos', 'grupo_origen'), ('operaciones_neumaticos', 'grupo_sustitucion'), ('operaciones_neumaticos', 'identidad_retirado'), ('operaciones_neumaticos', 'importacion_lote_id'), ('operaciones_neumaticos', 'marca_txt'), ('operaciones_neumaticos', 'medida_txt'), ('operaciones_neumaticos', 'modelo_txt'), ('operaciones_neumaticos', 'origen_linea'), ('operaciones_neumaticos', 'origen_sistema'), ('operaciones_neumaticos', 'posicion_fuente'), ('tc_intervencion_servicios', 'grupo_origen'), ('tc_intervencion_servicios', 'importacion_lote_id'), ('tc_intervenciones', 'hora_desconocida'), ('tc_intervenciones', 'importacion_lote_id'), ('tc_intervenciones', 'origen_doc'), ('tc_intervenciones', 'origen_sistema'), ('tc_neumaticos', 'grupo_origen'), ('tc_neumaticos', 'identidad_reconstruida'), ('tc_neumaticos', 'importacion_lote_id'), ('tc_neumaticos', 'origen_doc'), ('tc_neumaticos', 'origen_linea')),

r1 as (
  select 1 ord, 'Tablas' seccion, 'PARA' estado, 'FALTA la tabla ' || x detalle
    from t where to_regclass('public.' || x) is null
  union all
  select 1, 'Tablas', 'OK', 'las 9 tablas nuevas están'
   where not exists (select 1 from t where to_regclass('public.' || x) is null)
),
r2 as (
  select 2, 'Vistas', 'PARA', 'FALTA la vista ' || x from v where to_regclass('public.' || x) is null
  union all
  select 2, 'Vistas', 'OK', 'las 2 vistas están'
   where not exists (select 1 from v where to_regclass('public.' || x) is null)
),
r3 as (
  select 3, 'Funciones', 'PARA', 'FALTA la función ' || x from f where to_regprocedure(x) is null
  union all
  select 3, 'Funciones', 'OK', 'las 29 firmas están, con su tipo exacto'
   where not exists (select 1 from f where to_regprocedure(x) is null)
),
r4 as (
  select 4, 'Columnas', 'PARA', 'FALTA la columna ' || tab || '.' || col
    from c where not exists (select 1 from information_schema.columns i
                              where i.table_schema = 'public' and i.table_name = tab and i.column_name = col)
  union all
  select 4, 'Columnas', 'OK', 'las 22 columnas nuevas están en las tablas vivas'
   where not exists (select 1 from c
                      where not exists (select 1 from information_schema.columns i
                                         where i.table_schema='public' and i.table_name=tab and i.column_name=col))
),
-- La RLS es la mitad de la seguridad de estas tablas: sin ella, los permisos
-- de Supabase sobre lo nuevo de public dejarían leerlas enteras.
r5 as (
  select 5, 'RLS', 'PARA', 'RLS APAGADA en ' || x
    from t join pg_class cl on cl.oid = to_regclass('public.' || x)
   where to_regclass('public.' || x) is not null and not cl.relrowsecurity
  union all
  select 5, 'RLS', 'DATO', x || ': ' ||
         (select count(*) from pg_policies p where p.schemaname='public' and p.tablename = x)::text || ' política(s)'
    from t where to_regclass('public.' || x) is not null
),
-- Nada importado todavía: esto se pasa antes de subir el Excel.
r6 as (
  select 6, 'Datos', case when n = 0 then 'OK' else 'MIRA' end,
         case when n = 0 then 'no hay ningún lote de importación: nada importado todavía'
              else n::text || ' lote(s) de importación ya aplicados' end
    from (select case when to_regclass('public.tc_importacion_lotes') is null then 0 else
            (xpath('/table/row/n/text()', query_to_xml('select count(*) n from tc_importacion_lotes',
                                                       false, false, '')))[1]::text::bigint end n) q
)
select seccion, estado, detalle
  from (select * from r1 union all select * from r2 union all select * from r3
        union all select * from r4 union all select * from r5 union all select * from r6) z
 order by ord, case estado when 'PARA' then 0 when 'MIRA' then 1 when 'OK' then 2 else 3 end, detalle;
