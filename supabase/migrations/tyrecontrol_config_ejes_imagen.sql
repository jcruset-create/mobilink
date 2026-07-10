-- ============================================================
-- SEA TyreControl — Imagen de chasis por configuración de ejes
-- La imagen del plano se asocia al catálogo de configuraciones
-- de ejes (2x2x2, 2x4…): todos los vehículos con esa configuración
-- la heredan automáticamente, sin subir una imagen por vehículo.
-- La imagen específica del tipo de vehículo (si existe) tiene
-- prioridad sobre la de la configuración.
-- ============================================================

alter table tc_config_ejes
  add column if not exists imagen_chasis_url text;

comment on column tc_config_ejes.imagen_chasis_url is
  'URL de la imagen de chasis (vista superior) que heredan todos los vehículos con esta configuración de ejes. La imagen propia del tipo de vehículo, si existe, tiene prioridad.';
