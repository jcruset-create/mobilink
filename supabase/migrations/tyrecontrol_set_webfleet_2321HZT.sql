-- ============================================================
-- SEA TyreControl — Enlazar el vehículo 2321HZT con su objeto Webfleet.
-- El objeto en la cuenta Webfleet disponible es el nº 003.
-- Tras ejecutarlo, en la ficha del vehículo "Sincronizar" traerá los km
-- reales (~178.366 km) y la posición.
-- ============================================================

update tc_vehiculos
set webfleet_vehicle_id = '003'
where id = '3bc7e05d-baa2-4bd7-8757-80bc8b678ba8';
