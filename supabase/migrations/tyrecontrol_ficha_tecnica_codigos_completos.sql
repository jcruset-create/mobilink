-- ============================================================
-- SEA TyreControl - Ficha tecnica: TODOS los codigos de la tarjeta ITV
--
-- Completa el catalogo tc_cat_campos_ficha_tecnica con los codigos que
-- faltaban (A.2, D.6, R, Z, F.1.1, F.2, F.2.1, F.3.1, O.1..O.1.4, F.7,
-- F.7.1, M.1, M.4, L.1, P.5, P.5.1, P.1.1, P.2.1, S.1, S.2, U.2, V.7,
-- C.I, C.V) y corrige los codigos de los que ya existian pero estaban
-- mal numerados respecto a la tarjeta.
--
-- Cada campo nuevo tiene su propia columna tipada en tc_vehiculos: nada
-- de texto libre.
-- ============================================================

-- ── 1. Columnas nuevas en el vehiculo ──────────────────────────────
alter table tc_vehiculos
  add column if not exists campo_ci                 text,
  add column if not exists campo_cv                 text,
  add column if not exists direccion_fabricante     text,
  add column if not exists procedencia              text,
  add column if not exists color                    text,
  add column if not exists campo_j2                 text,
  add column if not exists campo_j3                 text,
  add column if not exists observaciones_ficha      text,
  add column if not exists mma_por_eje              text,
  add column if not exists mma_autorizada           numeric,
  add column if not exists mma_autorizada_por_eje   text,
  add column if not exists masa_remolque_con_freno  numeric,
  add column if not exists campo_o11                text,
  add column if not exists carga_vertical_maxima    numeric,
  add column if not exists campo_o13                text,
  add column if not exists campo_o14                text,
  add column if not exists campo_f7                 text,
  add column if not exists campo_f71                text,
  add column if not exists voladizo                 text,
  add column if not exists anchura_vias             text,
  add column if not exists configuracion_ejes_ficha text,
  add column if not exists fabricante_motor         text,
  add column if not exists tipo_motor               text,
  add column if not exists alimentacion             text,
  add column if not exists relacion_potencia        numeric,
  add column if not exists num_plazas               integer,
  add column if not exists plazas_pie               integer,
  add column if not exists regimen_motor            numeric,
  add column if not exists co2                      numeric;

-- ── 2. Codigos corregidos de los campos que ya existian ────────────
-- CL es la clasificacion del vehiculo (codigo DGT), no la tara.
update tc_cat_campos_ficha_tecnica set codigo = 'CL',    descripcion = 'Clasificacion del vehiculo' where clave = 'clasificacion';
update tc_cat_campos_ficha_tecnica set codigo = 'A.1'    where clave = 'fabricante';
update tc_cat_campos_ficha_tecnica set codigo = 'J.1'    where clave = 'carroceria';
update tc_cat_campos_ficha_tecnica set codigo = null     where clave = 'tara';
update tc_cat_campos_ficha_tecnica set codigo = 'F.4'    where clave = 'distancia_ejes';
update tc_cat_campos_ficha_tecnica set codigo = 'F.5'    where clave = 'anchura';
update tc_cat_campos_ficha_tecnica set codigo = 'F.6'    where clave = 'altura';
update tc_cat_campos_ficha_tecnica set codigo = 'F.8'    where clave = 'via';
update tc_cat_campos_ficha_tecnica set codigo = 'F.1.5'  where clave = 'longitud';
update tc_cat_campos_ficha_tecnica set codigo = 'F.3'    where clave = 'masa_maxima_conjunto';
update tc_cat_campos_ficha_tecnica set codigo = 'F.3.1'  where clave = 'masa_remolcable';
update tc_cat_campos_ficha_tecnica set codigo = 'L.0'    where clave = 'ejes_motrices';
update tc_cat_campos_ficha_tecnica set codigo = 'L.2'    where clave = 'num_ruedas';

-- ── 3. Catalogo completo, en el orden en que sale en la tarjeta ────
insert into tc_cat_campos_ficha_tecnica (codigo, clave, descripcion, unidad, orden) values
  ('A',     'matricula',                   'Número de matrícula',                          null,    10),
  ('B',     'fecha_primera_matriculacion', 'Fecha de la primera matriculación',            null,    20),
  ('CL',    'clasificacion',               'Clasificación del vehículo',                   null,    30),
  ('C.I',   'campo_ci',                    'Campo C.I de la ficha',                        null,    31),
  ('C.V',   'campo_cv',                    'Campo C.V de la ficha',                        null,    32),
  ('A.1',   'fabricante',                  'Fabricante',                                   null,    33),
  ('A.2',   'direccion_fabricante',        'Dirección del fabricante',                     null,    34),
  ('D.1',   'marca',                       'Marca',                                        null,    35),
  ('D.2',   'tipo',                        'Tipo',                                         null,    36),
  ('D.2',   'variante',                    'Variante',                                     null,    37),
  ('D.2',   'version',                     'Versión',                                      null,    38),
  ('D.2',   'modelo',                      'Modelo',                                       null,    39),
  ('D.3',   'denominacion_comercial',      'Denominación comercial',                       null,    40),
  ('D.6',   'procedencia',                 'Procedencia',                                  null,    41),
  ('E',     'vin',                         'Número de identificación del vehículo (bastidor)', null, 42),
  ('J',     'categoria',                   'Categoría del vehículo',                       null,    43),
  ('J.1',   'carroceria',                  'Tipo de carrocería',                           null,    44),
  ('J.2',   'campo_j2',                    'Campo J.2 de la ficha',                        null,    45),
  ('J.3',   'campo_j3',                    'Campo J.3 de la ficha',                        null,    46),
  ('R',     'color',                       'Color del vehículo',                           null,    47),
  ('K',     'num_homologacion',            'Número de homologación de tipo',               null,    48),
  ('Z',     'observaciones_ficha',         'Observaciones adicionales',                    null,    49),
  ('G',     'masa_orden_marcha',           'Masa en orden de marcha',                      'kg',    50),
  (null,    'tara',                        'Tara',                                         'kg',    51),
  ('F.1',   'mma',                         'Masa máxima técnicamente admisible en carga',  'kg',    52),
  ('F.1.1', 'mma_por_eje',                 'MMA técnicamente admisible por ejes',          'kg',    53),
  ('F.1.5', 'longitud',                    'Longitud máxima',                              'mm',    54),
  ('F.2',   'mma_autorizada',              'Masa máxima autorizada',                       'kg',    55),
  ('F.2.1', 'mma_autorizada_por_eje',      'Masa máxima autorizada por ejes',              'kg',    56),
  ('F.3',   'masa_maxima_conjunto',        'Masa máxima del conjunto',                     'kg',    57),
  ('F.3.1', 'masa_remolcable',             'Masa máxima remolcable',                       'kg',    58),
  ('O.1',   'masa_remolque_con_freno',     'Masa de remolque con freno',                   'kg',    59),
  ('O.1.1', 'campo_o11',                   'Campo O.1.1 de la ficha',                      null,    60),
  ('O.1.2', 'carga_vertical_maxima',       'Carga vertical máxima',                        'kg',    61),
  ('O.1.3', 'campo_o13',                   'Campo O.1.3 de la ficha',                      null,    62),
  ('O.1.4', 'campo_o14',                   'Campo O.1.4 de la ficha',                      null,    63),
  ('F.4',   'distancia_ejes',              'Batalla (distancia entre ejes)',               'mm',    64),
  ('F.5',   'anchura',                     'Anchura total',                                'mm',    65),
  ('F.6',   'altura',                      'Altura total',                                 'mm',    66),
  ('F.7',   'campo_f7',                    'Campo F.7 de la ficha',                        null,    67),
  ('F.7.1', 'campo_f71',                   'Campo F.7.1 de la ficha',                      null,    68),
  ('F.8',   'via',                         'Vía',                                          'mm',    69),
  ('M.1',   'voladizo',                    'Voladizo delantero / trasero',                 'mm',    70),
  ('M.4',   'anchura_vias',                'Anchura de vías',                              'mm',    71),
  ('L',     'num_ejes',                    'Número de ejes',                               null,    72),
  ('L.0',   'ejes_motrices',               'Ejes motrices',                                null,    73),
  ('L.1',   'configuracion_ejes_ficha',    'Configuración de ejes',                        null,    74),
  ('L.2',   'num_ruedas',                  'Número de ruedas',                             null,    75),
  ('P.5.1', 'fabricante_motor',            'Fabricante del motor',                         null,    76),
  ('P.5',   'tipo_motor',                  'Tipo de motor',                                null,    77),
  ('P.3',   'combustible',                 'Tipo de combustible o fuente de energía',      null,    78),
  ('P.1',   'cilindrada',                  'Cilindrada',                                   'cm³',   79),
  ('P.1.1', 'alimentacion',                'Alimentación (cilindros / disposición)',       null,    80),
  (null,    'num_cilindros',               'Número de cilindros',                          null,    81),
  ('P.2',   'potencia',                    'Potencia máxima neta',                         'kW',    82),
  ('P.2.1', 'relacion_potencia',           'Relación potencia / masa',                     null,    83),
  ('S.1',   'num_plazas',                  'Número de plazas sentadas',                    null,    84),
  ('S.2',   'plazas_pie',                  'Plazas de pie',                                null,    85),
  ('U.1',   'nivel_sonoro',                'Nivel sonoro',                                 'dB(A)', 86),
  ('U.2',   'regimen_motor',               'Régimen del motor',                            'rpm',   87),
  ('V.7',   'co2',                         'Emisiones de CO2',                             'g/km',  88),
  ('V.9',   'norma_emisiones',             'Norma anticontaminación (Euro)',               null,    89),
  ('I',     'fecha_emision',               'Fecha de emisión del documento',               null,    90)
on conflict (clave) do update
  set codigo      = excluded.codigo,
      descripcion = excluded.descripcion,
      unidad      = excluded.unidad,
      orden       = excluded.orden;

-- PostgREST tiene que enterarse de las columnas nuevas.
notify pgrst, 'reload schema';
