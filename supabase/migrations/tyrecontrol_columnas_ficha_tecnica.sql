-- ============================================================
-- SEA TyreControl - Cada campo del catalogo de la ficha tecnica pasa a ser
-- una columna propia y tipada en tc_vehiculos, en vez de texto libre en
-- tc_vehiculo_atributos_tecnicos. Esa tabla se mantiene SOLO para datos que
-- el documento traiga y no esten en el catalogo (siguen sin perderse).
-- ============================================================

alter table tc_vehiculos
  -- "tipo" ya es la relación embebida con tc_tipos_vehiculo en las
  -- consultas del frontend: el campo D.2 de la ficha va a tipo_ficha.
  add column if not exists tipo_ficha             text,
  add column if not exists variante                text,
  add column if not exists version                 text,
  add column if not exists denominacion_comercial  text,
  add column if not exists fabricante               text,
  add column if not exists categoria                text,
  add column if not exists clasificacion            text,
  add column if not exists carroceria               text,
  add column if not exists num_homologacion         text,
  add column if not exists num_ejes                 smallint,
  add column if not exists num_ruedas                smallint,
  add column if not exists ejes_motrices             smallint,
  add column if not exists distancia_ejes            numeric,
  add column if not exists via                       numeric,
  add column if not exists mma                        numeric,
  add column if not exists masa_maxima_conjunto       numeric,
  add column if not exists masa_orden_marcha          numeric,
  add column if not exists tara                       numeric,
  add column if not exists masa_remolcable            numeric,
  add column if not exists longitud                   numeric,
  add column if not exists anchura                    numeric,
  add column if not exists altura                     numeric,
  add column if not exists combustible                text,
  add column if not exists cilindrada                 numeric,
  add column if not exists potencia                   numeric,
  add column if not exists num_cilindros              smallint,
  add column if not exists norma_emisiones            text,
  add column if not exists nivel_sonoro               numeric,
  add column if not exists fecha_emision              date;

comment on column tc_vehiculos.tipo_ficha is 'Ficha técnica D.2 · Tipo';
comment on column tc_vehiculos.variante is 'Ficha técnica D.2 · Variante';
comment on column tc_vehiculos.version is 'Ficha técnica D.2 · Versión';
comment on column tc_vehiculos.denominacion_comercial is 'Ficha técnica D.3';
comment on column tc_vehiculos.fabricante is 'Ficha técnica D.1 · Fabricante';
comment on column tc_vehiculos.categoria is 'Ficha técnica J · Categoría del vehículo';
comment on column tc_vehiculos.clasificacion is 'Ficha técnica J · Clasificación';
comment on column tc_vehiculos.carroceria is 'Ficha técnica J · Tipo de carrocería';
comment on column tc_vehiculos.num_homologacion is 'Ficha técnica K · Número de homologación';
comment on column tc_vehiculos.num_ejes is 'Ficha técnica L · Número de ejes';
comment on column tc_vehiculos.num_ruedas is 'Ficha técnica L · Número de ruedas';
comment on column tc_vehiculos.ejes_motrices is 'Ficha técnica N.1 · Ejes motrices';
comment on column tc_vehiculos.distancia_ejes is 'Ficha técnica M · Distancia entre ejes (mm)';
comment on column tc_vehiculos.via is 'Ficha técnica · Vía (mm)';
comment on column tc_vehiculos.mma is 'Ficha técnica F.1 · Masa máxima técnicamente admisible (kg)';
comment on column tc_vehiculos.masa_maxima_conjunto is 'Ficha técnica F.2 · Masa máxima del conjunto (kg)';
comment on column tc_vehiculos.masa_orden_marcha is 'Ficha técnica G · Masa en orden de marcha (kg)';
comment on column tc_vehiculos.tara is 'Ficha técnica G · Tara (kg)';
comment on column tc_vehiculos.masa_remolcable is 'Ficha técnica O.1 · Masa máxima remolcable (kg)';
comment on column tc_vehiculos.longitud is 'Ficha técnica · Longitud total (mm)';
comment on column tc_vehiculos.anchura is 'Ficha técnica · Anchura total (mm)';
comment on column tc_vehiculos.altura is 'Ficha técnica · Altura total (mm)';
comment on column tc_vehiculos.combustible is 'Ficha técnica P.3 · Tipo de combustible';
comment on column tc_vehiculos.cilindrada is 'Ficha técnica P.1 · Cilindrada (cm³)';
comment on column tc_vehiculos.potencia is 'Ficha técnica P.2 · Potencia máxima neta (kW)';
comment on column tc_vehiculos.num_cilindros is 'Ficha técnica · Número de cilindros';
comment on column tc_vehiculos.norma_emisiones is 'Ficha técnica V.9 · Norma anticontaminación';
comment on column tc_vehiculos.nivel_sonoro is 'Ficha técnica U.1 · Nivel sonoro (dB(A))';
comment on column tc_vehiculos.fecha_emision is 'Ficha técnica I · Fecha de emisión del documento';
