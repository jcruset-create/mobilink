-- ============================================================
-- SEA TyreControl - Modulo ficha tecnica ITV (1/3): tabla maestra
--
-- Extiende tc_cat_campos_ficha_tecnica (que ya existia) con categoria,
-- orden de seccion, tipo de dato, campo multiple, ayuda y activo, y la
-- puebla con TODOS los codigos de una ficha tecnica, tengan o no dato.
--
-- Reversible: al final del fichero, en comentario, el rollback.
-- ============================================================

alter table tc_cat_campos_ficha_tecnica
  add column if not exists categoria     text,
  add column if not exists orden_seccion integer not null default 0,
  add column if not exists tipo_dato     text    not null default 'text',
  add column if not exists es_multiple   boolean not null default false,
  add column if not exists ayuda         text,
  add column if not exists activo        boolean not null default true,
  add column if not exists updated_at    timestamptz not null default now();

alter table tc_cat_campos_ficha_tecnica drop constraint if exists chk_campos_ficha_tipo_dato;
alter table tc_cat_campos_ficha_tecnica add constraint chk_campos_ficha_tipo_dato check (
  tipo_dato in ('text','integer','decimal','date','boolean','json','text_array','decimal_array')
);

create index if not exists idx_campos_ficha_codigo    on tc_cat_campos_ficha_tecnica (codigo);
create index if not exists idx_campos_ficha_categoria on tc_cat_campos_ficha_tecnica (categoria);

-- El catalogo lo lee cualquier usuario autenticado, no el mundo entero.
drop policy if exists cat_campos_ficha_select on tc_cat_campos_ficha_tecnica;
create policy cat_campos_ficha_select on tc_cat_campos_ficha_tecnica
  for select using ( auth.uid() is not null );
drop policy if exists cat_campos_ficha_write on tc_cat_campos_ficha_tecnica;
create policy cat_campos_ficha_write on tc_cat_campos_ficha_tecnica
  for all using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );

-- ── Catalogo completo ──────────────────────────────────────────────
-- Las claves que ya existian se conservan tal cual (tienen datos y las
-- usa el codigo); el "on conflict" de abajo les corrige codigo,
-- descripcion, bloque, orden, tipo y unidad. Ojo con los codigos que
-- cambian respecto a lo que habia: clasificacion pasa a C.L (es la
-- clasificacion DGT, no la tara), carroceria a J.1, distancia_ejes a
-- F.4, longitud a F.1.5, anchura a F.5, altura a F.6, via a F.8,
-- masa_maxima_conjunto a F.3, masa_remolcable a O.1, ejes_motrices a
-- L.0, num_ruedas a L.2, modelo a D.5 y tara se queda sin codigo.
insert into tc_cat_campos_ficha_tecnica
  (codigo, clave, descripcion, categoria, orden_seccion, orden, tipo_dato, unidad, es_multiple, activo) values

  -- 1. Datos generales del documento
  ('MATRICULA',            'matricula',                   'Matrícula',                                'documento', 1,  1, 'text',    null,   false, true),
  ('CERTIFICADO_NUMERO',   'certificado_numero',          'Número de certificado',                    'documento', 1,  2, 'text',    null,   false, true),
  ('FICHA_TECNICA_NUMERO', 'ficha_tecnica_numero',        'Número de ficha técnica',                  'documento', 1,  3, 'text',    null,   false, true),
  ('FECHA_EXPEDICION',     'fecha_emision',               'Fecha de expedición',                      'documento', 1,  4, 'date',    null,   false, true),

  -- 2. Fabricante e identificación
  ('A.1',   'fabricante',                  'Fabricante',                                  'identificacion', 2,  1, 'text', null, false, true),
  ('A.2',   'direccion_fabricante',        'Dirección del fabricante',                    'identificacion', 2,  2, 'text', null, false, true),
  ('A.3',   'representante_fabricante',    'Representante del fabricante',                'identificacion', 2,  3, 'text', null, false, true),
  ('B',     'fecha_primera_matriculacion', 'Fecha de primera matriculación',              'identificacion', 2,  4, 'date', null, false, true),
  ('C.L',   'clasificacion',               'Código complementario C.L (clasificación)',   'identificacion', 2,  5, 'text', null, false, true),
  ('C.I',   'codigo_complementario_ci',    'Código complementario C.I',                   'identificacion', 2,  6, 'text', null, false, true),
  ('C.V',   'codigo_complementario_cv',    'Código complementario C.V',                   'identificacion', 2,  7, 'text', null, false, true),
  ('D.1',   'marca',                       'Marca',                                       'identificacion', 2,  8, 'text', null, false, true),
  ('D.2',   'tipo',                        'Tipo',                                        'identificacion', 2,  9, 'text', null, false, true),
  ('D.2',   'variante',                    'Variante',                                    'identificacion', 2, 10, 'text', null, false, true),
  ('D.2',   'version',                     'Versión',                                     'identificacion', 2, 11, 'text', null, false, true),
  ('D.3',   'denominacion_comercial',      'Denominación comercial',                      'identificacion', 2, 12, 'text', null, false, true),
  ('D.4',   'categoria_comercial',         'Categoría comercial',                         'identificacion', 2, 13, 'text', null, false, true),
  ('D.5',   'modelo',                      'Modelo',                                      'identificacion', 2, 14, 'text', null, false, true),
  ('D.6',   'denominacion_interna',        'Denominación interna',                        'identificacion', 2, 15, 'text', null, false, true),
  ('E',     'vin',                         'Número de bastidor (VIN)',                    'identificacion', 2, 16, 'text', null, false, true),

  -- 2b. Titular: datos personales. Se crean pero quedan INACTIVOS: no se
  -- extraen ni se muestran hasta decidir la base legal de tratamiento.
  ('C.1',   'titular',                     'Titular',                                     'titular', 3, 1, 'text', null, false, false),
  ('C.1.1', 'titular_apellidos',           'Apellidos o razón social',                    'titular', 3, 2, 'text', null, false, false),
  ('C.1.2', 'titular_nombre',              'Nombre',                                      'titular', 3, 3, 'text', null, false, false),
  ('C.2',   'titular_domicilio',           'Domicilio',                                   'titular', 3, 4, 'text', null, false, false),
  ('C.3',   'usuario_habitual',            'Usuario habitual',                            'titular', 3, 5, 'text', null, false, false),

  -- 4. Masas
  ('F.1',   'mma',                         'Masa máxima técnicamente admisible',          'masas', 4, 1, 'decimal', 'kg', false, true),
  ('F.1.1', 'mma_por_eje',                 'Masa máxima técnicamente admisible por ejes', 'masas', 4, 2, 'json',    'kg', true,  true),
  ('F.1.5', 'longitud',                    'Longitud máxima asociada',                    'masas', 4, 3, 'decimal', 'mm', false, true),
  ('F.2',   'mma_autorizada',              'Masa máxima autorizada',                      'masas', 4, 4, 'decimal', 'kg', false, true),
  ('F.2.1', 'mma_autorizada_por_eje',      'Masa máxima autorizada por ejes',             'masas', 4, 5, 'json',    'kg', true,  true),
  ('F.3',   'masa_maxima_conjunto',        'Masa máxima del conjunto',                    'masas', 4, 6, 'decimal', 'kg', false, true),
  ('F.3.1', 'masa_conjunto_autorizada',    'Masa máxima autorizada del conjunto',         'masas', 4, 7, 'decimal', 'kg', false, true),
  ('G',     'masa_orden_marcha',           'Masa en orden de marcha',                     'masas', 4, 8, 'decimal', 'kg', false, true),
  (null,    'tara',                        'Tara',                                        'masas', 4, 9, 'decimal', 'kg', false, true),

  -- 5. Dimensiones
  ('F.4',   'distancia_ejes',              'Distancia entre ejes (batalla)',              'dimensiones', 5, 1, 'decimal', 'mm', false, true),
  ('F.5',   'anchura',                     'Anchura',                                     'dimensiones', 5, 2, 'decimal', 'mm', false, true),
  ('F.6',   'altura',                      'Altura',                                      'dimensiones', 5, 3, 'decimal', 'mm', false, true),
  ('F.7',   'longitud_util',               'Longitud útil',                               'dimensiones', 5, 4, 'decimal', 'mm', false, true),
  ('F.7.1', 'longitud_carga',              'Longitud de carga',                           'dimensiones', 5, 5, 'decimal', 'mm', false, true),
  ('F.8',   'via',                         'Dimensión complementaria (vía)',              'dimensiones', 5, 6, 'decimal', 'mm', false, true),
  ('M.1',   'voladizo',                    'Voladizo delantero y trasero',                'dimensiones', 5, 7, 'json',    'mm', true,  true),
  ('M.2',   'distancia_ejes_m2',           'Distancia entre ejes',                        'dimensiones', 5, 8, 'json',    'mm', true,  true),
  ('M.3',   'distancia_ruedas',            'Distancia entre ruedas',                      'dimensiones', 5, 9, 'json',    'mm', true,  true),
  ('M.4',   'anchura_vias',                'Anchura de vías',                             'dimensiones', 5,10, 'json',    'mm', true,  true),

  -- 6. Categoría, carrocería y homologación
  ('J',     'categoria',                   'Categoría del vehículo',                      'homologacion', 6, 1, 'text', null, false, true),
  ('J.1',   'carroceria',                  'Carrocería',                                  'homologacion', 6, 2, 'text', null, false, true),
  ('J.2',   'codigo_carroceria',           'Código de carrocería',                        'homologacion', 6, 3, 'text', null, false, true),
  ('J.3',   'uso_clasificacion',           'Uso o clasificación',                         'homologacion', 6, 4, 'text', null, false, true),
  ('K',     'num_homologacion',            'Número de homologación',                      'homologacion', 6, 5, 'text', null, false, true),
  ('R',     'color',                       'Color',                                       'homologacion', 6, 6, 'text', null, false, true),
  ('Z',     'observaciones_ficha',         'Observaciones adicionales',                   'homologacion', 6, 7, 'text', null, false, true),

  -- 7. Ejes y ruedas
  ('L',     'num_ejes',                    'Número de ejes',                              'ejes', 7, 1, 'text',    null, true,  true),
  ('L.0',   'ejes_motrices',               'Ejes motrices',                               'ejes', 7, 2, 'text',    null, true,  true),
  ('L.1',   'configuracion_ejes_ficha',    'Configuración de ejes',                       'ejes', 7, 3, 'text',    null, true,  true),
  ('L.2',   'num_ruedas',                  'Número de ruedas',                            'ejes', 7, 4, 'text',    null, false, true),

  -- 8. Masas remolcables
  ('O.1',   'masa_remolcable',             'Masa remolcable con freno',                   'remolque', 8, 1, 'decimal', 'kg', false, true),
  ('O.1.1', 'masa_remolcable_compl_1',     'Masa remolcable complementaria 1',            'remolque', 8, 2, 'decimal', 'kg', false, true),
  ('O.1.2', 'carga_vertical_maxima',       'Carga vertical máxima',                       'remolque', 8, 3, 'decimal', 'kg', false, true),
  ('O.1.3', 'masa_remolcable_compl_3',     'Masa remolcable complementaria 3',            'remolque', 8, 4, 'decimal', 'kg', false, true),
  ('O.1.4', 'masa_remolcable_compl_4',     'Masa remolcable complementaria 4',            'remolque', 8, 5, 'decimal', 'kg', false, true),
  ('O.2',   'masa_remolcable_sin_freno',   'Masa remolcable sin freno',                   'remolque', 8, 6, 'decimal', 'kg', false, true),

  -- 9. Motor y combustible
  ('P.1',   'cilindrada',                  'Cilindrada',                                  'motor', 9, 1, 'decimal', 'cm3', false, true),
  ('P.1.1', 'configuracion_motor',         'Configuración del motor',                     'motor', 9, 2, 'text',    null,  false, true),
  ('P.2',   'potencia',                    'Potencia máxima',                             'motor', 9, 3, 'decimal', 'kW',  false, true),
  ('P.2.1', 'relacion_potencia_masa',      'Relación potencia y masa',                    'motor', 9, 4, 'decimal', null,  false, true),
  ('P.3',   'combustible',                 'Combustible',                                 'motor', 9, 5, 'text',    null,  false, true),
  ('P.4',   'potencia_fiscal',             'Potencia fiscal',                             'motor', 9, 6, 'decimal', 'CVF', false, true),
  ('P.5',   'tipo_motor',                  'Tipo o modelo de motor',                      'motor', 9, 7, 'text',    null,  false, true),
  ('P.5.1', 'fabricante_motor',            'Fabricante del motor',                        'motor', 9, 8, 'text',    null,  false, true),
  ('Q',     'relacion_peso_potencia',      'Relación peso y potencia',                    'motor', 9, 9, 'decimal', null,  false, true),
  (null,    'num_cilindros',               'Número de cilindros',                         'motor', 9,10, 'integer', null,  false, true),

  -- 10. Plazas y velocidad
  ('S.1',   'num_plazas_sentadas',         'Número de plazas sentadas',                   'plazas', 10, 1, 'integer', null,   false, true),
  ('S.2',   'num_plazas_pie',              'Número de plazas de pie',                     'plazas', 10, 2, 'integer', null,   false, true),
  ('T',     'velocidad_maxima',            'Velocidad máxima',                            'plazas', 10, 3, 'decimal', 'km/h', false, true),

  -- 11. Ruido y emisiones
  ('U.1',   'nivel_sonoro',                'Nivel sonoro',                                'emisiones', 11, 1, 'decimal', 'dB(A)', false, true),
  ('U.2',   'regimen_motor_ensayo',        'Régimen del motor en ensayo',                 'emisiones', 11, 2, 'decimal', 'rpm',   false, true),
  ('V.1',   'emisiones_co',                'Emisiones de CO',                             'emisiones', 11, 3, 'decimal', null,    false, true),
  ('V.2',   'emisiones_hc',                'Emisiones de HC',                             'emisiones', 11, 4, 'decimal', null,    false, true),
  ('V.3',   'emisiones_nox',               'Emisiones de NOx',                            'emisiones', 11, 5, 'decimal', null,    false, true),
  ('V.4',   'particulas',                  'Partículas',                                  'emisiones', 11, 6, 'decimal', null,    false, true),
  ('V.5',   'opacidad',                    'Opacidad',                                    'emisiones', 11, 7, 'decimal', null,    false, true),
  ('V.6',   'norma_emisiones_homologacion','Norma de emisiones',                          'emisiones', 11, 8, 'text',    null,    false, true),
  ('V.7',   'co2',                         'Emisiones de CO2',                            'emisiones', 11, 9, 'decimal', 'g/km',  false, true),
  ('V.8',   'consumo',                     'Consumo',                                     'emisiones', 11,10, 'decimal', 'l/100km', false, true),
  ('V.9',   'norma_emisiones',             'Nivel de emisiones Euro',                     'emisiones', 11,11, 'text',    null,    false, true)

on conflict (clave) do update set
  codigo        = excluded.codigo,
  descripcion   = excluded.descripcion,
  categoria     = excluded.categoria,
  orden_seccion = excluded.orden_seccion,
  orden         = excluded.orden,
  tipo_dato     = excluded.tipo_dato,
  unidad        = excluded.unidad,
  es_multiple   = excluded.es_multiple,
  activo        = excluded.activo,
  updated_at    = now();

notify pgrst, 'reload schema';

-- ── Rollback ───────────────────────────────────────────────────────
-- alter table tc_cat_campos_ficha_tecnica
--   drop column if exists categoria, drop column if exists orden_seccion,
--   drop column if exists tipo_dato, drop column if exists es_multiple,
--   drop column if exists ayuda, drop column if exists activo,
--   drop column if exists updated_at;
-- drop index if exists idx_campos_ficha_codigo;
-- drop index if exists idx_campos_ficha_categoria;
