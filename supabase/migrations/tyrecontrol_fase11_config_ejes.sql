-- ============================================================
-- SEA TyreControl — Fase 11: etiqueta de configuración de ejes
-- por tipo de vehículo (ej. "2x2x2", "4x2", "6x4"...), editable
-- desde Configuración → Tipos de vehículo.
-- ============================================================

alter table tc_tipos_vehiculo
  add column if not exists configuracion_ejes text;

comment on column tc_tipos_vehiculo.configuracion_ejes is
  'Etiqueta descriptiva de la configuración de ejes (ej. 2x2x2, 4x2, 6x4), informativa y usada para identificar qué imagen de chasis corresponde a este tipo.';
