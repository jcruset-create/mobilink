-- Km mensuales: los meses cerrados POR PARTES cuya suma pasa del avance del
-- odómetro se corrigen al avance del odómetro.
--
-- La noche del 26 al 27/11/2026 se cerraron por partes 53 vehículos de
-- octubre. En 4 la suma de las partes sale muy por encima de lo que avanzó el
-- odómetro (0179JDJ: 1.356 km frente a 657; 26667399: 4.492 frente a 1.177):
-- pedidos por días, los tramos de al lado del día roto traen km de más. Desde
-- este PR el servidor ya toma el odómetro en ese caso; esto arregla las filas
-- que ya se guardaron.
--
-- Solo toca integration_vehicle_monthly_mileage, y solo filas con source
-- summarytrips_partes / summarytrips_partes_odometro, con odómetro de inicio y
-- fin, avance positivo y suma > 1,1 × avance. Idempotente: tras corregirlas,
-- la razón es 1 y no vuelven a entrar.

do $migracion$
declare v_n int; v_lista text;
begin
  with corregidas as (
    update integration_vehicle_monthly_mileage m
       set distance_km = round((m.final_odometer_km - m.initial_odometer_km)::numeric, 2),
           source = 'summarytrips_partes_odometro',
           last_error = coalesce(m.last_error || ' · ', '') ||
             format('Suma por partes %s km > avance del odómetro: se toma el odómetro.', round(m.distance_km::numeric)),
           updated_at_ms = (extract(epoch from now()) * 1000)::bigint
     where m.source in ('summarytrips_partes', 'summarytrips_partes_odometro')
       and m.initial_odometer_km is not null and m.final_odometer_km is not null
       and m.final_odometer_km - m.initial_odometer_km > 0
       and m.distance_km > (m.final_odometer_km - m.initial_odometer_km) * 1.1
    returning m.external_code, m.year, m.month, m.distance_km
  )
  select count(*), string_agg(format('%s %s/%s → %s km', external_code, month, year, round(distance_km::numeric)), ', ')
    into v_n, v_lista from corregidas;
  perform set_config('mobilink.resultado',
    format('OK: %s meses por partes corregidos al odómetro%s', v_n, coalesce(': ' || v_lista, '.')), false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
