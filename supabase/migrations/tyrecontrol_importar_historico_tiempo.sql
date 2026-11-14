-- La importación del histórico se queda sin tiempo.
--
--   2026-10: ERROR — canceling statement due to statement timeout
--            (el lote no ha escrito nada; se puede reintentar)
--
-- ── Por qué pasa ────────────────────────────────────────────────────────────
--
-- `tc_importar_historico` se llama desde el navegador por PostgREST, así que
-- hereda el presupuesto del rol `authenticated`: `statement_timeout = 8s`.
--
-- Ocho segundos es un presupuesto de PETICIÓN WEB. Esto no lo es: el fichero
-- de octubre son 1.360 líneas, 159 albaranes, 248 operaciones de neumático y
-- 397 servicios, y cada albarán escribe su intervención, sus operaciones y sus
-- servicios. Nunca debió medirse con esa vara.
--
-- ── Y una parte es culpa de un cambio reciente, que conviene decir ─────────
--
-- `tyrecontrol_albaran_manda_en_montajes.sql` enganchó al final del importador
-- un bucle que aplica los albaranes a los montajes, un vehículo por vuelta.
-- Medido: la consulta de cada vehículo tarda unos 17 ms, y un lote mensual
-- toca del orden de 120 vehículos. Son unos 2 segundos añadidos a un trabajo
-- que ya rozaba el límite.
--
-- No se quita —es lo que mantiene la ficha al día tras importar— pero queda
-- apuntado que se puede abaratar: la MISMA consulta hecha de una vez para toda
-- la empresa tarda 411 ms, cinco veces menos que el bucle. Hacerlo pide pasar
-- la lista de vehículos del lote en un parámetro `uuid[]` en vez de llamar una
-- vez por cada uno, y eso es un cambio aparte.
--
-- ── El arreglo ──────────────────────────────────────────────────────────────
--
-- 55 segundos, que es siete veces lo de ahora y se queda por debajo del corte
-- de la pasarela de Supabase. Importa que lo corte la BASE y no la pasarela:
-- si cortara la pasarela, el navegador vería un error mientras la transacción
-- podría seguir viva, y «ha fallado» dejaría de significar «no ha escrito
-- nada» —que es justo lo que hoy promete el mensaje de error—.
--
-- Se le da también a `tc_deshacer_importacion`, que recorre el mismo lote para
-- deshacerlo y tiene el mismo problema por el mismo motivo.
--
-- Si aun así se quedara corto, el camino no es subir más el número: es partir
-- el fichero, y la pantalla ya deja elegir qué meses se importan.

alter function tc_importar_historico(uuid, text, jsonb, boolean)
  set statement_timeout to '55s';

alter function tc_deshacer_importacion(uuid, uuid[], boolean)
  set statement_timeout to '55s';

-- ── Comprobación ───────────────────────────────────────────────────────────
--
-- Las dos tienen que salir con «statement_timeout=55s» en `ajustes`.

select p.proname, p.proconfig as ajustes
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('tc_importar_historico', 'tc_deshacer_importacion')
 order by 1;
