-- ─────────────────────────────────────────────────────────────────────────
-- COMPROBACIÓN DESPUÉS DE IMPORTAR UN MES · histórico de Plana
--
-- SOLO LECTURA. No escribe, no bloquea, se puede repetir.
--
-- ── Por qué esto NO compara contra una fotografía ───────────────────────────
--
-- La primera versión guardaba los recuentos de antes de empezar y comparaba.
-- Con enero dio seis «PARAR» que eran todos falsos: entre la fotografía y la
-- comprobación habían pasado dos días, la flota había trabajado y el script
-- le echaba a la importación 2.214 mediciones que había hecho una tablet.
--
-- Un recuento congelado solo vale si nadie usa el sistema mientras tanto, y
-- eso aquí no pasa ni va a pasar: quedan nueve meses por cargar y el taller
-- no para. Así que se comprueba lo que de verdad define el invariante:
--
--   1. Por ENLACE: que nada de lo protegido apunte a algo que creó la
--      importación. Esto es cierto hoy, mañana y con la flota trabajando.
--   2. Por VENTANA: que dentro del segundo en que se aplicó cada lote no se
--      escribiera nada en las tablas protegidas. Es un indicio, no una
--      prueba —otra cosa pudo coincidir en ese segundo—, y por eso se
--      presenta como «mirar» y no como veredicto.
--
-- Lo que permite volver atrás sigue siendo el backup y
-- `tc_deshacer_importacion`, no esto.
-- ─────────────────────────────────────────────────────────────────────────

with lotes as (
  select id, periodo, estado, aplicado_at from tc_importacion_lotes
),
ventana as (
  -- Un margen de dos segundos a cada lado: la importación de un mes entra en
  -- una transacción y tarda menos que eso.
  select min(aplicado_at) - interval '2 s' ini, max(aplicado_at) + interval '2 s' fin from lotes
),

-- ── 1 · por enlace: lo protegido no toca nada de la importación ────────────
enlace(bloque, concepto, valor, esperado, veredicto) as (
  select '1 · nada protegido apunta al histórico', 'montajes actuales sobre una ficha importada',
         count(*)::text, '0', case when count(*) = 0 then 'OK' else 'PARAR' end
    from tc_montajes_actuales m
    join tc_neumaticos n on n.id = m.neumatico_id
   where n.importacion_lote_id is not null

  union all
  select '1 · nada protegido apunta al histórico', 'historial de montajes sobre una ficha importada',
         count(*)::text, '0', case when count(*) = 0 then 'OK' else 'PARAR' end
    from tc_historial_montajes h
    join tc_neumaticos n on n.id = h.neumatico_id
   where n.importacion_lote_id is not null

  union all
  select '1 · nada protegido apunta al histórico', 'mediciones de revisión sobre una ficha importada',
         count(*)::text, '0', case when count(*) = 0 then 'OK' else 'PARAR' end
    from revisiones_neumaticos_detalle d
    join tc_neumaticos n on n.id = d.neumatico_id
   where n.importacion_lote_id is not null

  union all
  -- `movimientos_stock` no enlaza con el neumático, así que aquí solo se
  -- puede mirar la ventana. Se dice, en vez de dar por comprobado algo que
  -- no se ha comprobado.
  select '1 · nada protegido apunta al histórico', 'movimientos_stock (no enlaza con el neumático)',
         '—', 'se mira por ventana, abajo', 'no comprobable por enlace'
),

-- ── 2 · por ventana: qué se escribió en el segundo del lote ────────────────
ventanas(bloque, concepto, valor, esperado, veredicto) as (
  select '2 · dentro del segundo del lote', t, n::text, '0',
         case when n = 0 then 'OK' else 'mirar · pudo coincidir otra cosa' end
    from (
      select 'tc_montajes_actuales' t, count(*) n from tc_montajes_actuales, ventana
       where created_at between ventana.ini and ventana.fin
      union all
      select 'tc_historial_montajes', count(*) from tc_historial_montajes, ventana
       where created_at between ventana.ini and ventana.fin
      union all
      select 'movimientos_stock', count(*) from movimientos_stock, ventana
       where created_at between ventana.ini and ventana.fin
      union all
      select 'revisiones_vehiculo', count(*) from revisiones_vehiculo, ventana
       where created_at between ventana.ini and ventana.fin
      union all
      select 'revisiones_neumaticos_detalle', count(*) from revisiones_neumaticos_detalle, ventana
       where created_at between ventana.ini and ventana.fin
      union all
      -- Una fila con lote fuera de la ventana de su lote sería una escritura
      -- del histórico que no vino de la importación.
      select 'operaciones con lote fuera de la ventana', count(*) from operaciones_neumaticos o, ventana
       where o.importacion_lote_id is not null
         and o.created_at not between ventana.ini and ventana.fin
    ) s
),

-- ── 3 · lo que entró, lote a lote ──────────────────────────────────────────
-- Por periodo y no en total: con varios meses cargados, un total esconde
-- cuál escribió qué, que es justo lo que hace falta para deshacer uno solo.
porlote(bloque, concepto, valor, esperado, veredicto) as (
  select '3 · lo que entró, por mes',
         l.periodo || ' · ' || l.estado,
         'intervenciones ' || (select count(*) from tc_intervenciones where importacion_lote_id = l.id)
         || ' · operaciones ' || (select count(*) from operaciones_neumaticos where importacion_lote_id = l.id)
         || ' · servicios ' || (select count(*) from tc_intervencion_servicios where importacion_lote_id = l.id)
         || ' · fichas ' || (select count(*) from tc_neumaticos where importacion_lote_id = l.id)
         || ' · líneas ' || (select count(*) from tc_importacion_lineas where lote_id = l.id),
         'cuadra con lo que dijo la simulación de ese mes',
         to_char(l.aplicado_at, 'DD/MM HH24:MI')
    from lotes l
),

-- ── 4 · lo que no puede pasar ──────────────────────────────────────────────
nunca(bloque, concepto, valor, esperado, veredicto) as (
  select '4 · lo que no puede pasar', 'fichas del histórico con vehículo o posición',
         count(*)::text, '0', case when count(*) = 0 then 'OK' else 'PARAR' end
    from tc_neumaticos
   where importacion_lote_id is not null and (vehiculo_id is not null or posicion_id is not null)

  union all
  select '4 · lo que no puede pasar', 'operaciones con lote que no son source=import',
         count(*)::text, '0', case when count(*) = 0 then 'OK' else 'PARAR' end
    from operaciones_neumaticos
   where importacion_lote_id is not null and coalesce(source, '') <> 'import'

  union all
  select '4 · lo que no puede pasar', 'operaciones del histórico con coste',
         count(*)::text, '0 · histórico no es facturado',
         case when count(*) = 0 then 'OK' else 'PARAR' end
    from operaciones_neumaticos
   where importacion_lote_id is not null and coalesce(coste, 0) <> 0

  union all
  select '4 · lo que no puede pasar', 'operaciones del histórico sin intervención',
         count(*)::text, '0', case when count(*) = 0 then 'OK' else 'PARAR' end
    from operaciones_neumaticos
   where importacion_lote_id is not null and intervencion_id is null

  union all
  -- Dos lotes del mismo periodo serían el mismo mes cargado dos veces.
  select '4 · lo que no puede pasar', 'periodos cargados más de una vez',
         coalesce(string_agg(periodo, ', '), '0'), '0',
         case when count(*) = 0 then 'OK' else 'PARAR' end
    from (select periodo from tc_importacion_lotes
           where estado <> 'deshecho' group by periodo having count(*) > 1) d
),

-- ── 5 · contadores ─────────────────────────────────────────────────────────
contadores(bloque, concepto, valor, esperado, veredicto) as (
  select '5 · contadores', 'numero_interno · avanza con las fichas',
         coalesce((select string_agg(row_to_json(t)::text, ' · ')
                     from tc_contadores_numero_interno t), '—'),
         'por delante del valor anterior; el hueco no se reutiliza', 'mirar'
  union all
  select '5 · contadores', 'numero_operacion · no se toca',
         coalesce((select string_agg(row_to_json(t)::text, ' · ')
                     from tc_contadores_numero_operacion t), '—'),
         'igual que antes de importar', 'mirar'
)

select * from enlace
union all select * from ventanas
union all select * from porlote
union all select * from nunca
union all select * from contadores
order by 1, 2;
