-- Enciende el espejo económico de Mobilink Assist.
--
-- A partir de aquí, cada asistencia que nazca en Assist obtiene su fila
-- espejo en Connect y la factura el motor de siempre. Diseño en
-- docs/PROMPT_tarifas_assist.md.
--
-- DOS COSAS QUE NO TIENEN VUELTA FÁCIL:
--
--   · NO ES RETROACTIVO, y no debe serlo: `desdeMs` se pone AHORA. Espejar
--     asistencias de la semana pasada sería tarificar hoy servicios cuyos
--     tiempos y kilómetros nadie anotó, o sea, inventarse importes.
--   · Encender esto dos veces con fechas distintas no duplica nada (hay
--     índice único por asistencia del core), pero adelantar `desdeMs` hacia
--     atrás SÍ traería asistencias viejas. Si hay que rectificar la fecha,
--     muévela hacia adelante, nunca hacia atrás.
--
-- Se ejecuta entero, de una vez. Si algo no cuadra, lanza un error con la
-- explicación y no toca nada: el editor de Supabase no muestra los RAISE
-- NOTICE, así que todo lo que hay que leer va dentro del error.

DO $$
DECLARE
  v_centro    bigint;
  v_cuantos   int;
  v_lista     text;
  v_ahora     bigint := (EXTRACT(EPOCH FROM now()) * 1000)::bigint;
  v_settings  text;
BEGIN
  -- 1. El centro. Si hay más de uno activo, no adivinamos: encender el que
  --    no toca facturaría por un tarifario ajeno.
  SELECT COUNT(*), string_agg(id || ' = ' || name, ' | ' ORDER BY id)
    INTO v_cuantos, v_lista
    FROM connect_control_centers
   WHERE "deletedAtMs" IS NULL AND status = 'active';

  IF v_cuantos = 0 THEN
    RAISE EXCEPTION 'No hay ningún centro de control activo. Nada que encender.';
  END IF;
  IF v_cuantos > 1 THEN
    RAISE EXCEPTION
      'Hay % centros activos: %. Sustituye la línea marcada más abajo por el id que toque.',
      v_cuantos, v_lista;
  END IF;

  SELECT id, settings INTO v_centro, v_settings
    FROM connect_control_centers
   WHERE "deletedAtMs" IS NULL AND status = 'active';

  -- Si hubiera varios centros: comenta las cuatro líneas de arriba y pon
  --   v_centro := <id>;
  -- con el id que salga en el error.

  -- 2. El interruptor no se pisa si ya estaba puesto: volver a encenderlo
  --    con la fecha de hoy dejaría fuera lo espejado desde la vez anterior.
  IF v_settings::jsonb -> 'assistMirror' ->> 'activo' = 'true' THEN
    RAISE EXCEPTION
      'El espejo YA estaba encendido en el centro % desde %. No se toca.',
      v_centro,
      to_timestamp(((v_settings::jsonb -> 'assistMirror' ->> 'desdeMs')::bigint) / 1000);
  END IF;

  -- 3. Encender, conservando el resto de los ajustes del centro.
  UPDATE connect_control_centers
     SET settings = jsonb_set(
           COALESCE(settings, '{}')::jsonb,
           '{assistMirror}',
           jsonb_build_object('activo', true, 'desdeMs', v_ahora)
         )::text,
         "updatedAtMs" = v_ahora
   WHERE id = v_centro;
END $$;

-- Lo que ha quedado. Tiene que salir una fila, con `activo` en true y la
-- fecha de hoy: esa fecha es la frontera, y todo lo anterior a ella no se
-- espejará jamás.
SELECT c.id,
       c.name AS centro,
       c.settings::jsonb -> 'assistMirror' ->> 'activo' AS activo,
       to_timestamp(((c.settings::jsonb -> 'assistMirror' ->> 'desdeMs')::bigint) / 1000)
         AS espeja_desde
  FROM connect_control_centers c
 WHERE c.settings LIKE '%assistMirror%'
 ORDER BY c.id;
