-- ─────────────────────────────────────────────────────────────────────────
-- FOTOGRAFÍA PREVIA · importación del histórico de Plana (PR #492)
--
-- GENERADO por scripts/produccion/generar-preflight-sql.py. SOLO LECTURA.
--
-- Se ejecuta DOS veces: antes de importar y después. Las tablas que la
-- importación NO debe tocar tienen que dar el mismo número las dos veces; en
-- las cuatro que sí escribe, la diferencia tiene que estar entera en la
-- columna `con_lote`, que son las filas de la importación.
--
-- Son recuentos, no huellas por fila: la versión con md5 de cada fila está en
-- `preflight-produccion.sh`, que necesita psql. Un recuento no detecta dos
-- cambios que se compensen, y por eso no sustituye al backup: lo que de
-- verdad permite volver atrás es el backup, no esto.
--
-- Si alguna tabla tarda demasiado en el editor, se ejecuta su línea aparte.
-- ─────────────────────────────────────────────────────────────────────────

with protegidas(t) as (values
  ('tc_vehiculos'), ('tc_neumaticos'), ('tc_montajes_actuales'),
  ('operaciones_neumaticos'), ('tc_intervenciones'), ('tc_intervencion_servicios'),
  ('tc_historial_montajes'), ('revisiones_vehiculo'), ('revisiones_neumaticos_detalle'),
  ('movimientos_stock'), ('tc_contadores_numero_interno'), ('tc_contadores_numero_operacion')
),
medidas as (
  select p.t,
         to_regclass('public.' || p.t) is not null existe,
         exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = p.t
                    and c.column_name = 'importacion_lote_id') tiene_lote
    from protegidas p
),
conteos as (
  select m.t, m.existe, m.tiene_lote,
         case when not m.existe then null else
           (xpath('/table/row/n/text()',
                  query_to_xml('select count(*) n from public.' || quote_ident(m.t),
                               false, false, '')))[1]::text::bigint end filas,
         case when not m.existe or not m.tiene_lote then null else
           (xpath('/table/row/n/text()',
                  query_to_xml('select count(*) n from public.' || quote_ident(m.t)
                               || ' where importacion_lote_id is not null', false, false, '')))[1]::text::bigint end con_lote
    from medidas m
)
select t tabla,
       case when existe then filas::text else '(no existe)' end filas,
       case when not existe then '' when tiene_lote then coalesce(con_lote::text, '?')
            else '(sin columna de lote)' end con_lote,
       now()::timestamptz(0)::text momento
  from conteos
 order by t;
