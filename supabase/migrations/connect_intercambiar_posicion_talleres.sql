-- Sea Tarragona y Sea Agro Reus tienen la posición intercambiada: cada uno
-- está en el punto del otro. Como están cambiadas ENTRE SÍ, se intercambian y
-- quedan exactas; arrastrarlas en el mapa las dejaría "más o menos", y de esa
-- posición dependen el reparto por cercanía y el radio de cobertura.
--
-- Se ejecuta entero. Si los nombres no son exactamente esos, avisa y no toca
-- nada: escribir coordenadas en el taller equivocado manda las asistencias al
-- sitio equivocado y no se nota hasta que una grúa va a donde no debe.

DO $$
DECLARE
  v_tgn_id  bigint; v_tgn_lat double precision; v_tgn_lng double precision;
  v_reus_id bigint; v_reus_lat double precision; v_reus_lng double precision;
  v_n       int;
BEGIN
  -- 1. Los dos talleres, por nombre exacto y únicos.
  SELECT COUNT(*) INTO v_n FROM connect_workshops WHERE name = 'Sea Tarragona';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Esperaba un taller llamado "Sea Tarragona" y hay %. No se toca nada.', v_n;
  END IF;
  SELECT COUNT(*) INTO v_n FROM connect_workshops WHERE name = 'Sea Agro Reus';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Esperaba un taller llamado "Sea Agro Reus" y hay %. No se toca nada.', v_n;
  END IF;

  SELECT id, latitude, longitude INTO v_tgn_id, v_tgn_lat, v_tgn_lng
    FROM connect_workshops WHERE name = 'Sea Tarragona';
  SELECT id, latitude, longitude INTO v_reus_id, v_reus_lat, v_reus_lng
    FROM connect_workshops WHERE name = 'Sea Agro Reus';

  -- 2. El intercambio. Cada uno recibe la del otro.
  UPDATE connect_workshops
     SET latitude = v_reus_lat, longitude = v_reus_lng,
         "updatedAtMs" = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
   WHERE id = v_tgn_id;

  UPDATE connect_workshops
     SET latitude = v_tgn_lat, longitude = v_tgn_lng,
         "updatedAtMs" = (EXTRACT(EPOCH FROM now()) * 1000)::bigint
   WHERE id = v_reus_id;
END $$;

-- Cómo queda. Tarragona ronda 41.11 N / 1.24 E; Reus, 41.15 N / 1.10 E. La
-- longitud es la que los distingue de un vistazo: Reus queda más al oeste, o
-- sea con el número MENOR.
SELECT id, name,
       ROUND(latitude::numeric, 5)  AS latitud,
       ROUND(longitude::numeric, 5) AS longitud,
       "radiusKm" AS radio_km
  FROM connect_workshops
 WHERE name IN ('Sea Tarragona', 'Sea Agro Reus')
 ORDER BY name;
