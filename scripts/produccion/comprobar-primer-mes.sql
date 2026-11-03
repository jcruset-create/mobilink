-- ─────────────────────────────────────────────────────────────────────────
-- COMPROBACIÓN DESPUÉS DEL PRIMER MES · histórico de Plana
--
-- SOLO LECTURA. No escribe nada, no bloquea nada, se puede repetir.
--
-- Contesta tres preguntas, en este orden, que es el orden en que importan:
--
--   1. ¿Se ha roto algo de lo que ya había?  Las seis tablas que la
--      importación NO debe tocar tienen que dar EXACTAMENTE el mismo número
--      que la fotografía previa. Una sola fila de diferencia es motivo para
--      parar y deshacer.
--
--   2. ¿Lo que ha entrado está marcado?  En las cuatro tablas donde sí
--      escribe, todo el crecimiento tiene que llevar `importacion_lote_id`.
--      Lo que haya subido SIN lote es algo que escribió otra cosa, y hay que
--      mirarlo antes de seguir.
--
--   3. ¿Cuánto ha entrado, y cuadra con lo que dijo la simulación?
--
-- La fotografía previa (2026-11-01, confirmada dos veces) va escrita aquí
-- dentro a propósito: un script que te pide los números de ayer para
-- compararlos no comprueba nada, solo te hace teclearlos.
--
-- Los recuentos NO sustituyen al backup: no detectan dos cambios que se
-- compensen. Lo que permite volver atrás es el backup y
-- `tc_deshacer_importacion`.
-- ─────────────────────────────────────────────────────────────────────────

with base(t, antes, protegida) as (values
  -- Las seis que NO se tocan. Cero `insert` y cero `update` contra ellas en
  -- las tres migraciones; esto lo comprueba sobre los datos de verdad.
  ('movimientos_stock',              93::bigint, true),
  ('tc_montajes_actuales',         4800,         true),
  ('tc_historial_montajes',         253,         true),
  ('revisiones_vehiculo',         17589,         true),
  ('revisiones_neumaticos_detalle', 107890,      true),
  ('tc_vehiculos',                  909,         true),
  -- Las cuatro donde sí escribe: suben, y todo lo que suba lleva lote.
  ('operaciones_neumaticos',        605,         false),
  ('tc_intervenciones',             350,         false),
  ('tc_intervencion_servicios',       6,         false),
  ('tc_neumaticos',                5060,         false)
),
medidas as (
  select b.t, b.antes, b.protegida,
         to_regclass('public.' || b.t) is not null existe,
         exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = b.t
                    and c.column_name = 'importacion_lote_id') tiene_lote
    from base b
),
conteos as (
  select m.*,
         case when not m.existe then null else
           (xpath('/table/row/n/text()',
                  query_to_xml('select count(*) n from public.' || quote_ident(m.t),
                               false, false, '')))[1]::text::bigint end ahora,
         case when not m.existe or not m.tiene_lote then null else
           (xpath('/table/row/n/text()',
                  query_to_xml('select count(*) n from public.' || quote_ident(m.t)
                               || ' where importacion_lote_id is not null',
                               false, false, '')))[1]::text::bigint end con_lote
    from medidas m
),

-- ── 1 y 2 · las tablas ─────────────────────────────────────────────────────
tablas as (
  select
    case when protegida then '1 · no se toca' else '2 · recibe el histórico' end bloque,
    t concepto,
    coalesce(ahora::text, '(no existe)') valor,
    case when protegida then antes::text
         else antes::text || ' + lo importado' end esperado,
    case
      when not existe then 'REVISAR · la tabla no existe'
      when protegida and ahora = antes then 'OK'
      when protegida then 'PARAR · ha cambiado en ' || (ahora - antes)::text || ' filas'
      -- Sin lote no se puede comprobar nada: se dice, no se da por bueno.
      when not tiene_lote then 'REVISAR · sin columna de lote'
      when ahora - coalesce(con_lote, 0) = antes then
        'OK · ' || coalesce(con_lote, 0)::text || ' del histórico'
      when ahora - coalesce(con_lote, 0) > antes then
        'PARAR · ' || (ahora - coalesce(con_lote, 0) - antes)::text || ' filas nuevas SIN lote'
      else 'PARAR · faltan ' || (antes - (ahora - coalesce(con_lote, 0)))::text || ' filas de las de antes'
    end veredicto
  from conteos
),

-- ── 3 · lo que ha entrado ──────────────────────────────────────────────────
-- Cada consulta va envuelta en `query_to_xml` para que la falta de una tabla
-- no reviente el script entero: se queda esa línea sin contestar y las demás
-- siguen.
dinamico(bloque, concepto, valor, esperado, veredicto) as (
  select '3 · la carga', 'lotes aplicados',
         coalesce((xpath('/table/row/v/text()', query_to_xml(
           'select string_agg(periodo || '' ('' || estado || '', '' || '
           || 'to_char(aplicado_at, ''DD/MM HH24:MI'') || '')'', '' · '' order by periodo) v '
           || 'from public.tc_importacion_lotes', false, false, '')))[1]::text, '—'),
         'un solo periodo, en estado aplicado',
         'mirar'
   where to_regclass('public.tc_importacion_lotes') is not null

  union all
  select '3 · la carga', 'albaranes importados (intervenciones del lote)',
         coalesce((xpath('/table/row/v/text()', query_to_xml(
           'select count(*) v from public.tc_importacion_intervenciones', false, false, '')))[1]::text, '—'),
         'lo que dijo la simulación para ese mes', 'mirar'
   where to_regclass('public.tc_importacion_intervenciones') is not null

  union all
  select '3 · la carga', 'líneas de origen guardadas',
         coalesce((xpath('/table/row/v/text()', query_to_xml(
           'select count(*) v from public.tc_importacion_lineas', false, false, '')))[1]::text, '—'),
         'las del mes', 'mirar'
   where to_regclass('public.tc_importacion_lineas') is not null

  union all
  select '3 · la carga', 'albaranes bloqueados anotados',
         coalesce((xpath('/table/row/v/text()', query_to_xml(
           'select count(*) v from public.tc_importacion_bloqueados', false, false, '')))[1]::text, '—'),
         'los bloqueados del mes; no se importan, solo se deja constancia', 'mirar'
   where to_regclass('public.tc_importacion_bloqueados') is not null

  union all
  select '3 · la carga', 'intervalos reconstruidos',
         coalesce((xpath('/table/row/v/text()', query_to_xml(
           'select count(*) v from public.tc_reconstruccion_montajes', false, false, '')))[1]::text, '—'),
         'uno por montaje de goma nueva CON posición', 'mirar'
   where to_regclass('public.tc_reconstruccion_montajes') is not null

  union all
  -- Lo que de verdad no puede pasar: una ficha histórica con vehículo o
  -- posición. Nacen sin montar, en `pendiente_clasificacion`.
  select '4 · lo que no puede pasar', 'fichas del histórico con vehículo o posición',
         coalesce((xpath('/table/row/v/text()', query_to_xml(
           'select count(*) v from public.tc_neumaticos '
           || 'where importacion_lote_id is not null '
           || 'and (vehiculo_id is not null or posicion_id is not null)', false, false, '')))[1]::text, '—'),
         '0', 'PARAR si no es 0'
   where to_regclass('public.tc_neumaticos') is not null

  union all
  select '4 · lo que no puede pasar', 'montajes actuales con lote de importación',
         coalesce((xpath('/table/row/v/text()', query_to_xml(
           'select count(*) v from public.tc_montajes_actuales m '
           || 'join public.tc_neumaticos n on n.id = m.neumatico_id '
           || 'where n.importacion_lote_id is not null', false, false, '')))[1]::text, '—'),
         '0 · el histórico no monta nada', 'PARAR si no es 0'
   where to_regclass('public.tc_montajes_actuales') is not null

  union all
  -- `es_fisica` no vive aquí: es del catálogo de tipos de operación. Lo que
  -- SÍ escribe la importación en cada fila es `source = 'import'`, y eso es
  -- lo que se comprueba: una operación con lote que no venga marcada así la
  -- escribió otra cosa.
  select '4 · lo que no puede pasar', 'operaciones con lote que no son source=import',
         coalesce((xpath('/table/row/v/text()', query_to_xml(
           'select count(*) v from public.operaciones_neumaticos '
           || 'where importacion_lote_id is not null '
           || 'and coalesce(source, '''') <> ''import''', false, false, '')))[1]::text, '—'),
         '0', 'PARAR si no es 0'
   where to_regclass('public.operaciones_neumaticos') is not null

  union all
  -- Histórico no significa facturado: la importación no pone coste.
  select '4 · lo que no puede pasar', 'operaciones del histórico con coste',
         coalesce((xpath('/table/row/v/text()', query_to_xml(
           'select count(*) v from public.operaciones_neumaticos '
           || 'where importacion_lote_id is not null '
           || 'and coalesce(coste, 0) <> 0', false, false, '')))[1]::text, '—'),
         '0 · histórico no es facturado', 'PARAR si no es 0'
   where to_regclass('public.operaciones_neumaticos') is not null

  union all
  -- Cada operación cuelga de su intervención; una suelta es un albarán a medias.
  select '4 · lo que no puede pasar', 'operaciones del histórico sin intervención',
         coalesce((xpath('/table/row/v/text()', query_to_xml(
           'select count(*) v from public.operaciones_neumaticos '
           || 'where importacion_lote_id is not null '
           || 'and intervencion_id is null', false, false, '')))[1]::text, '—'),
         '0', 'PARAR si no es 0'
   where to_regclass('public.operaciones_neumaticos') is not null

  union all
  select '5 · contadores', 'numero_interno (la fila no cambia; su valor sube)',
         coalesce((xpath('/table/row/v/text()', query_to_xml(
           'select string_agg(c::text, '' · '') v from ('
           || 'select row_to_json(t)::text c from public.tc_contadores_numero_interno t limit 5'
           || ') s', false, false, '')))[1]::text, '—'),
         '1 fila, con el valor por delante del de ayer', 'mirar'
   where to_regclass('public.tc_contadores_numero_interno') is not null

  union all
  select '5 · contadores', 'numero_operacion (no se toca)',
         coalesce((xpath('/table/row/v/text()', query_to_xml(
           'select string_agg(c::text, '' · '') v from ('
           || 'select row_to_json(t)::text c from public.tc_contadores_numero_operacion t limit 5'
           || ') s', false, false, '')))[1]::text, '—'),
         'igual que ayer', 'mirar'
   where to_regclass('public.tc_contadores_numero_operacion') is not null
)

select bloque, concepto, valor, esperado, veredicto from tablas
union all
select bloque, concepto, valor, esperado, veredicto from dinamico
order by bloque, concepto;
