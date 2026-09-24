-- ============================================================
-- Mobilink TyreControl — Catálogo Continental, fase 2, lote 02:
-- las 15 REFERENCIAS (modelo + medida + índices)
--
-- La marca, las 7 medidas y los 9 modelos ya los cargó
-- tyrecontrol_catalogo_continental_lote02.sql. Lo que faltaba es el
-- nivel de abajo: la referencia concreta que el técnico monta, con su
-- índice de carga, símbolo de velocidad, PR y etiqueta europea.
--
-- Origen: catalogo_neumaticos_fase2_continental_lote02.xlsx, pestaña
-- «Referencias Continental». Los datos se transcriben tal cual; un
-- `null` significa QUE NO CONSTA en el Excel, no cero ni «no aplica»,
-- así que no se rellena por inferencia.
--
-- Dimensiones, carga máxima y presión NO se cargan: siguen pendientes
-- de extraer del Technical Data Book oficial y no se inventan.
--
-- OJO con el 3PMSF: no es uniforme dentro de un modelo. El Conti Hybrid HT3
-- lo lleva en 385/65R22.5 y NO en 385/55R19.5 ni 445/45R19.5, pero el
-- catálogo solo tenía la casilla a nivel de MODELO y lo daba por bueno en las
-- tres. Aquí baja al nivel de la referencia, que es donde el dato es cierto.
--
-- Idempotente.
-- ============================================================

-- ── 1. Sitio para los datos que hoy no tienen columna ───────────────────────
--
-- Sin esto habría que tirar información del Excel. El doble marcado es el
-- caso claro: un 385/55R22.5 «160K / 158L» es UN neumático con DOS
-- homologaciones, no dos productos, así que no puede ser una segunda fila
-- de tyre_sizes — saldría duplicado en el catálogo del técnico.
alter table tc_referencias_neumatico
  add column if not exists m_s                     boolean,
  add column if not exists tres_pmsf               boolean,
  add column if not exists marcado_secundario      text,
  add column if not exists ean                     text,
  add column if not exists codigo_fabricante       text,
  add column if not exists verificacion_estado     text,
  add column if not exists fuente_oficial_url      text,
  add column if not exists fuente_corroboracion_url text,
  add column if not exists verificacion_notas      text;

comment on column tc_referencias_neumatico.tres_pmsf is
  'Marcado 3PMSF de ESTA medida. tc_cat_modelos_neumatico.tres_pmsf es del '
  'modelo entero y se queda corto: el Conti Hybrid HT3 lo lleva en '
  '385/65R22.5 pero NO en 385/55R19.5 ni en 445/45R19.5, y 3PMSF es un '
  'marcado invernal legal — darlo por bueno donde no lo hay no es un detalle '
  'cosmético. Manda esta columna cuando esté informada.';
comment on column tc_referencias_neumatico.marcado_secundario is
  'Segunda homologación del mismo neumático (doble marcado), p. ej. 158L '
  'cuando el principal es 160K. No es otro producto.';
comment on column tc_referencias_neumatico.verificacion_estado is
  'Alcance de la comprobación en origen. spec_corroborated_model_pending_'
  'official_page = la ficha oficial del modelo no se llegó a capturar.';

-- ── 2. Medidas con índice (tyre_sizes) ──────────────────────────────────────
-- Una fila por marcado PRINCIPAL. El secundario va en la referencia.
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'315/70R22.5 156/150L','315/70R22.5',315,70,22.5,'156','150','L'
  from tc_cat_medidas_neumatico where valor='315/70R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'315/70R22.5 154/150L','315/70R22.5',315,70,22.5,'154','150','L'
  from tc_cat_medidas_neumatico where valor='315/70R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'385/55R22.5 160K','385/55R22.5',385,55,22.5,'160',null,'K'
  from tc_cat_medidas_neumatico where valor='385/55R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'295/80R22.5 152/148M','295/80R22.5',295,80,22.5,'152','148','M'
  from tc_cat_medidas_neumatico where valor='295/80R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'315/80R22.5 156/150L','315/80R22.5',315,80,22.5,'156','150','L'
  from tc_cat_medidas_neumatico where valor='315/80R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'295/80R22.5 154/149M','295/80R22.5',295,80,22.5,'154','149','M'
  from tc_cat_medidas_neumatico where valor='295/80R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'385/65R22.5 160K','385/65R22.5',385,65,22.5,'160',null,'K'
  from tc_cat_medidas_neumatico where valor='385/65R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'385/65R22.5 164K','385/65R22.5',385,65,22.5,'164',null,'K'
  from tc_cat_medidas_neumatico where valor='385/65R22.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'385/55R19.5 156J','385/55R19.5',385,55,19.5,'156',null,'J'
  from tc_cat_medidas_neumatico where valor='385/55R19.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'445/45R19.5 160J','445/45R19.5',445,45,19.5,'160',null,'J'
  from tc_cat_medidas_neumatico where valor='445/45R19.5' on conflict (referencia_completa) do nothing;
insert into tyre_sizes (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad)
  select id,'385/55R22.5 162K','385/55R22.5',385,55,22.5,'162',null,'K'
  from tc_cat_medidas_neumatico where valor='385/55R22.5' on conflict (referencia_completa) do nothing;

-- ── 3. Referencias (modelo + medida) ────────────────────────────────────────
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HS5 315/70R22.5 156/150L', 20,
    true, true, 'C', 'B', 70, 'A',
    '154/150M', '4019238046120', '05126270000', 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-hs5/', 'https://www.internationaltyres.com/product/315-70-r-22-5-continental-hybrid-hs5-156-150l-154-150m/', 'Official Continental product page confirms model/position/retreadability; size and label corroborated by distributor.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '315/70R22.5 156/150L'
  where mo.nombre = 'Conti Hybrid HS5'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HD5 315/70R22.5 154/150L', 18,
    true, true, 'C', 'C', 76, null,
    '152/148M', '4019238046137', null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-hd5/', 'https://www.neumaticos.es/continental-conti-hybrid-hd5-315-70-r22.5-154-150l--16429212', 'Official Continental page confirms model and application; size, EAN and EU label corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '315/70R22.5 154/150L'
  where mo.nombre = 'Conti Hybrid HD5'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HS5 385/55R22.5 160K', 20,
    true, true, null, null, null, null,
    '158L', null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-hs5/', 'https://www.muchoneumatico.com/neumaticos/125579-38555r22_5-160k158l-conti-hybrid-hs5.html', 'Model official; size and dual marking corroborated by Spanish distributor.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/55R22.5 160K'
  where mo.nombre = 'Conti Hybrid HS5'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HD5 295/80R22.5 152/148M', 16,
    true, true, null, null, null, null,
    null, null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-hd5/', 'https://www.neumaticoslider.es/neumatico-camion/continental/conti-hybrid-hd5/295-80-r22-5-152-148m-1689921', 'Model official; size, PR and 3PMSF corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '295/80R22.5 152/148M'
  where mo.nombre = 'Conti Hybrid HD5'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti EcoRegional HS3 315/80R22.5 156/150L', 20,
    true, true, 'C', 'B', 70, null,
    '154/150M', '4019238035766', null, 'model_official_spec_corroborated',
    'https://www.continental-tires.com/products/truck/tires/conti-ecoregional-hs3/', 'https://www.neumaticos-online.es/rshop/neumaticos/Continental/Conti-EcoRegional-HS3/315-80-R22-5-156-150L-20PR-doble-marcado-154-150M/R-421096', 'Official product page confirms model; size and markings corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '315/80R22.5 156/150L'
  where mo.nombre = 'Conti EcoRegional HS3'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HS3+ 295/80R22.5 154/149M', 16,
    true, true, 'C', 'B', 70, 'A',
    null, '4019238051391', '0512565', 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-hs3-plus/', 'https://www.autodoc.es/neumaticos/continental/295-80-r22_5', 'Official Spanish product page confirms model; detailed size, EAN and label corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '295/80R22.5 154/149M'
  where mo.nombre = 'Conti Hybrid HS3+'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HD3 295/80R22.5 152/148M', null,
    true, true, null, null, null, null,
    null, null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-hd3/', 'https://www.muchoneumatico.com/neumaticos/55629-29580r22_5-152148m-conti-hybrid-hd3.html', 'Official Spanish page confirms model; size corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '295/80R22.5 152/148M'
  where mo.nombre = 'Conti Hybrid HD3'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT3 385/65R22.5 160K', 20,
    true, true, null, null, null, null,
    '158L', null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-ht3/', 'https://www.neumaticos-online.es/rshop/neumaticos/Continental/Conti-Hybrid-HT3/385-65-R22-5-160K-20PR-doble-marcado-158L/R-430378', 'Official product page confirms model and trailer application; size/marking corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/65R22.5 160K'
  where mo.nombre = 'Conti Hybrid HT3'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT3+ 385/65R22.5 164K', null,
    true, true, null, null, 70, null,
    '158L', null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-ht3-plus/', 'https://www.muchoneumatico.com/neumaticos/121328-38565r22_5-164k158l-conti-hybrid-ht3.html', 'Official page confirms 3PMSF and application; size and dual marking corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/65R22.5 164K'
  where mo.nombre = 'Conti Hybrid HT3+'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT3 385/55R19.5 156J', null,
    true, false, 'B', 'C', 70, 'A',
    null, '4019238820492', '0532112', 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-ht3/', 'https://www.autodoc.co.uk/tyres/continental/385-55-r19_5', 'Official model page plus market specification corroboration.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/55R19.5 156J'
  where mo.nombre = 'Conti Hybrid HT3'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT3+ 385/55R19.5 156J', null,
    true, true, null, null, null, null,
    null, null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-ht3-plus/', 'https://www.1001neumaticos.com/continental-conti-hybrid-ht3-plus-385-55-r195-156-j-28085640-pn', 'Official model page; size corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/55R19.5 156J'
  where mo.nombre = 'Conti Hybrid HT3+'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT3 445/45R19.5 160J', 22,
    true, false, 'B', 'C', 72, 'B',
    null, '4019238558784', '0531024000', 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-ht3/', 'https://www.centralepneus.fr/pneu-camion/continental/hybrid-ht3/445-45-r19-5-160j-1404846', 'Official model page; size, PR, EAN and label corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '445/45R19.5 160J'
  where mo.nombre = 'Conti Hybrid HT3'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT3+ 445/45R19.5 160J', null,
    true, true, null, null, null, null,
    null, null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-hybrid-ht3-plus/', 'https://www.bigtyres.co.uk/tyres/brands/continental/hybrid-ht3-plus/445-45r19-5-continental-hybrid-ht3-tl-trailer-160j-3pmsf-m-s', 'Official model page; size and 3PMSF corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '445/45R19.5 160J'
  where mo.nombre = 'Conti Hybrid HT3+'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Eco HS5 385/55R22.5 162K', null,
    true, true, null, null, null, null,
    null, null, null, 'model_official_spec_corroborated',
    'https://www.continental-neumaticos.es/products/truck/tires/conti-eco-hs-5/', 'https://tecnotyres.com/continental-conti-eco-hs5-385-55-r22-5-162k/', 'Official model page; size corroborated.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/55R22.5 162K'
  where mo.nombre = 'Conti Eco HS5'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, ply,
    m_s, tres_pmsf, etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
    marcado_secundario, ean, codigo_fabricante, verificacion_estado,
    fuente_oficial_url, fuente_corroboracion_url, verificacion_notas)
  select mo.id, ts.id, 'Continental Conti Hybrid HT5 385/55R22.5 160K', 20,
    true, true, null, null, null, null,
    '158L', null, null, 'spec_corroborated_model_pending_official_page',
    'https://www.continental-tires.com/content/dam/conti-tires-cms/continental/market-content/be/truck/fr---nl/Continental__TechnicalDataBook_03_24__Screen_EN.pdf.coredownload.pdf', 'https://www.neumaticoslider.es/neumatico-camion/continental/conti-hybrid-ht5/385-55-r22-5-160k-158l-1909225', 'Reference visible in European market; direct official product page not captured in this pass.'
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id and ma.nombre = 'Continental'
  join tyre_sizes ts on ts.referencia_completa = '385/55R22.5 160K'
  where mo.nombre = 'Conti Hybrid HT5'
  on conflict (modelo_id, tyre_size_id) do update set
    ply=excluded.ply, m_s=excluded.m_s, tres_pmsf=excluded.tres_pmsf,
    etiqueta_rr=excluded.etiqueta_rr,
    etiqueta_grip_humedo=excluded.etiqueta_grip_humedo,
    etiqueta_ruido_db=excluded.etiqueta_ruido_db,
    etiqueta_ruido_clase=excluded.etiqueta_ruido_clase,
    marcado_secundario=excluded.marcado_secundario, ean=excluded.ean,
    codigo_fabricante=excluded.codigo_fabricante,
    verificacion_estado=excluded.verificacion_estado,
    fuente_oficial_url=excluded.fuente_oficial_url,
    fuente_corroboracion_url=excluded.fuente_corroboracion_url,
    verificacion_notas=excluded.verificacion_notas;

-- ── 4. Comprobación ─────────────────────────────────────────────────────────
-- Si algún modelo o alguna medida no existiera, el join no habría insertado
-- nada y el lote quedaría a medias sin que nadie se enterara.
do $$
declare n int; pendiente int;
begin
  select count(*) into n
    from tc_referencias_neumatico r
    join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
    join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
   where ma.nombre = 'Continental' and r.referencia_completa like 'Continental %';
  if n < 15 then
    raise exception 'Solo % referencias Continental de las 15 del lote: falta algún modelo o medida', n;
  end if;
  select count(*) into pendiente from tc_referencias_neumatico
   where verificacion_estado = 'spec_corroborated_model_pending_official_page';
  raise notice 'Referencias Continental del lote 02: % (de las que % siguen sin ficha oficial capturada)', n, pendiente;
end $$;
