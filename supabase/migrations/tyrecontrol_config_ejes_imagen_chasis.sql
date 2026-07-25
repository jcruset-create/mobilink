-- ============================================================
-- SEA TyreControl — Fix: columna imagen_chasis_url en tc_config_ejes
--
-- La sección "Configuraciones de ejes" (Configuración) permite subir una
-- imagen de chasis por configuración (2x2x2, 2x4…) que heredan los vehículos
-- de esa config. El código (subirImagenConfigEjes / actualizarImagenConfigEjes
-- y el fallback imagenFallback del plano) usa tc_config_ejes.imagen_chasis_url,
-- pero la columna nunca se creó → PostgREST devuelve:
--   "Could not find the 'imagen_chasis_url' column of 'tc_config_ejes'".
--
-- Esta migración añade la columna. No afecta a nada existente.
-- ============================================================

alter table tc_config_ejes add column if not exists imagen_chasis_url text;
