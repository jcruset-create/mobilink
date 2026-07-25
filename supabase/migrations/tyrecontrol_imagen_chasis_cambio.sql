-- ============================================================
-- SEA TyreControl — Imagen de chasis específica para la pantalla
-- de "Cambiar neumático" de la APK.
--
-- La imagen normal del plano (imagen_chasis_url) la comparten la ficha
-- y todas las pantallas. En la pantalla de cambio de neumático interesa
-- una versión con los ejes más separados (más sitio para las tarjetas),
-- SIN alterar el resto. Esa versión se guarda aparte aquí; si está vacía,
-- la pantalla de cambio usa la imagen normal como hasta ahora.
-- ============================================================

alter table tc_tipos_vehiculo add column if not exists imagen_chasis_cambio_url text;
