-- ============================================================
-- SEA TyreControl — Fase 7: motor gráfico basado en imagen real
-- (sustituye el intento de plano vectorial simple, insuficiente
-- visualmente). Cada tipo de vehículo tiene una imagen de fondo
-- (URL) y cada posición sus coordenadas como % de esa imagen,
-- calibrables desde el panel (botón "Editar posiciones").
-- ============================================================

alter table tc_tipos_vehiculo
  add column if not exists imagen_chasis_url text;

alter table tc_posiciones_vehiculo
  add column if not exists pos_x numeric,  -- % desde la izquierda (0-100)
  add column if not exists pos_y numeric,  -- % desde arriba (0-100)
  add column if not exists pos_w numeric,  -- % ancho
  add column if not exists pos_h numeric;  -- % alto

comment on column tc_tipos_vehiculo.imagen_chasis_url is
  'URL de la imagen de fondo (foto/render) del chasis para el motor gráfico. Vista superior.';
comment on column tc_posiciones_vehiculo.pos_x is
  'Posición del recuadro del neumático sobre la imagen, en % (0-100), calibrado a mano desde el panel.';
