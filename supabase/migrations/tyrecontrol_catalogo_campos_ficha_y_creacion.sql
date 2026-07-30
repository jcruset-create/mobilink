-- ============================================================
-- SEA TyreControl - Catalogo de campos de la ficha tecnica (codigo +
-- descripcion oficial) y soporte para crear el vehiculo DIRECTAMENTE
-- desde la ficha (documento subido antes de que el vehiculo exista).
-- ============================================================

-- ── 1. El documento ya no exige un vehiculo: se puede subir "huerfano"
--       y se enlaza al vehiculo en el momento de crearlo.
alter table tc_vehiculo_documentos alter column vehiculo_id drop not null;

-- ── 2. Catalogo de campos de la ficha tecnica (codigo EU/ITV armonizado +
--       clave interna que ya usa el OCR + descripcion oficial). "clave" es
--       la clave normalizada que el prompt de OCR ya produce (ocrService.ts):
--       no se ha tocado esa lista, este catalogo solo la documenta.
create table if not exists tc_cat_campos_ficha_tecnica (
  id          uuid primary key default gen_random_uuid(),
  codigo      text,             -- codigo oficial ("E", "F.1"...). null si no tiene letra armonizada.
  clave       text not null unique,
  descripcion text not null,
  unidad      text,
  orden       int not null default 0
);
alter table tc_cat_campos_ficha_tecnica enable row level security;
drop policy if exists cat_campos_ficha_select on tc_cat_campos_ficha_tecnica;
create policy cat_campos_ficha_select on tc_cat_campos_ficha_tecnica
  for select to authenticated using (true);

insert into tc_cat_campos_ficha_tecnica (codigo, clave, descripcion, unidad, orden) values
  ('A',   'matricula',                    'Número de matrícula', null, 10),
  ('B',   'fecha_primera_matriculacion',  'Fecha de la primera matriculación', null, 20),
  ('D.1', 'marca',                        'Marca', null, 30),
  ('D.1', 'fabricante',                   'Fabricante', null, 31),
  ('D.2', 'tipo',                         'Tipo', null, 32),
  ('D.2', 'variante',                     'Variante', null, 33),
  ('D.2', 'version',                      'Versión', null, 34),
  ('D.2', 'modelo',                       'Modelo', null, 35),
  ('D.3', 'denominacion_comercial',       'Denominación comercial', null, 36),
  ('E',   'vin',                          'Número de identificación del vehículo (bastidor)', null, 40),
  ('J',   'categoria',                    'Categoría del vehículo', null, 50),
  ('J',   'clasificacion',                'Clasificación', null, 51),
  ('J',   'carroceria',                   'Tipo de carrocería', null, 52),
  ('K',   'num_homologacion',             'Número de homologación de tipo', null, 60),
  ('L',   'num_ejes',                     'Número de ejes', null, 70),
  ('L',   'num_ruedas',                   'Número de ruedas', null, 71),
  ('N.1', 'ejes_motrices',                'Ejes motrices', null, 72),
  ('M',   'distancia_ejes',               'Distancia entre ejes', 'mm', 73),
  (null,  'via',                          'Vía (anterior/posterior)', 'mm', 74),
  ('F.1', 'mma',                          'Masa máxima técnicamente admisible en carga', 'kg', 80),
  ('F.2', 'masa_maxima_conjunto',         'Masa máxima técnicamente admisible del conjunto', 'kg', 81),
  ('G',   'masa_orden_marcha',            'Masa en orden de marcha', 'kg', 82),
  ('G',   'tara',                         'Tara (masa en orden de marcha)', 'kg', 83),
  ('O.1', 'masa_remolcable',              'Masa máxima remolcable', 'kg', 84),
  (null,  'longitud',                     'Longitud total', 'mm', 90),
  (null,  'anchura',                      'Anchura total', 'mm', 91),
  (null,  'altura',                       'Altura total', 'mm', 92),
  ('P.3', 'combustible',                  'Tipo de combustible o fuente de energía', null, 100),
  ('P.1', 'cilindrada',                   'Cilindrada', 'cm³', 101),
  ('P.2', 'potencia',                     'Potencia máxima neta', 'kW', 102),
  (null,  'num_cilindros',                'Número de cilindros', null, 103),
  ('V.9', 'norma_emisiones',              'Norma anticontaminación (Euro)', null, 110),
  ('U.1', 'nivel_sonoro',                 'Nivel sonoro', 'dB(A)', 111),
  ('I',   'fecha_emision',                'Fecha de emisión del documento', null, 120)
on conflict (clave) do update set
  codigo = excluded.codigo, descripcion = excluded.descripcion, unidad = excluded.unidad, orden = excluded.orden;
