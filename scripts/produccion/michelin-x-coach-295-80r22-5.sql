-- Michelin X COACH Z y X COACH D en 295/80R22.5, al catálogo.
--
-- ── Qué se da de alta ───────────────────────────────────────────────────────
--
--   · El MODELO «X COACH Z» de Michelin: multiposición, vale delante y detrás.
--   · El MODELO «X COACH D» de Michelin: eje motriz.
--   · La MEDIDA CON ÍNDICES «295/80R22.5 154/150M», que no existía.
--   · Su REFERENCIA, con la etiqueta europea.
--
-- Ojo con las dos tablas de medidas, que no son la misma:
--
--   tc_cat_medidas_neumatico  la medida pelada: 295/80R22.5. YA EXISTE.
--   tyre_sizes                medida + índices + velocidad: 295/80R22.5
--                             154/150M. NO existía — hay 152/148L, 152/148M y
--                             154/149M, pero no la 154/150M que llevan estas
--                             dos. Se crea aquí.
--
-- `tc_referencias_neumatico.tyre_size_id` apunta a la SEGUNDA, no a la
-- primera. Es la parte del esquema que más fácil se confunde.
--
-- ── Por qué estos dos y no los cuatro ───────────────────────────────────────
--
-- Michelin tiene cuatro Coach en esta medida y no son intercambiables:
--
--   X COACH Z    154/150M   multiposición
--   X COACH D    154/150M   tracción
--   X COACH XD   152/148M   tracción  ← MENOS carga que las otras
--   X COACH HL Z 154/149M   carga alta
--
-- Se dan de alta las dos que se pidieron. Las otras dos no, para que nadie
-- escoja por error la XD creyendo que carga lo mismo que la D.
--
-- ── De dónde salen los datos, y qué NO se ha podido comprobar ───────────────
--
-- Desde esta sesión no se puede abrir ni la web de Michelin ni la base EPREL
-- de la UE: las dos están fuera de los dominios de red permitidos. Los datos
-- vienen de resultados de búsqueda que citan esas fichas y de distribuidores.
-- Por eso las referencias quedan como `spec_corroborated_model_pending_official_page`
-- y no como `model_official_spec_corroborated`, que es lo que llevan las de
-- Continental: cuando alguien abra la ficha oficial y lo confirme, se sube el
-- estado y ya está.
--
-- Dos datos se dejan VACÍOS a propósito, porque las fuentes no coinciden y un
-- número inventado en un catálogo se arrastra durante años:
--
--   · `profundidad_dibujo_mm`: un distribuidor da 18/32" (14,3 mm) para la Z,
--     pero no se ha podido corroborar en ninguna otra parte. Importa, porque
--     de la profundidad de origen cuelga el cálculo de desgaste.
--   · `etiqueta_ruido_clase` de la Z: un distribuidor dice A y otro dice B
--     para los mismos 71 dB. Los decibelios sí coinciden, así que van.
--
-- Nada de esto impide usar el neumático: la ficha se completa cuando se tenga
-- el dato bueno.
--
-- ── Se puede lanzar dos veces ───────────────────────────────────────────────
--
-- Todo va con ON CONFLICT sobre los índices únicos que ya existen
-- (`marca_id, nombre` en modelos; `modelo_id, tyre_size_id` en referencias).
-- Lanzarlo de nuevo actualiza, no duplica.

begin;

-- ── 0. La medida con índices, si no está ────────────────────────────────────
--
-- 154 = 3.750 kg por rueda en simple, 150 = 3.350 kg en gemelado, M = 130
-- km/h. Son los de la tabla ISO de índices de carga, no un dato de Michelin.

insert into tyre_sizes
  (medida_id, referencia_completa, medida, ancho, perfil, diametro_llanta,
   indice_carga_simple, indice_carga_doble, codigo_velocidad, activo)
values
  ((select id from tc_cat_medidas_neumatico where valor = '295/80R22.5'),
   '295/80R22.5 154/150M', '295/80R22.5', 295, 80, 22.5,
   '154', '150', 'M', true)
on conflict (referencia_completa) do update
  set activo = excluded.activo;

-- ── Los dos modelos ─────────────────────────────────────────────────────────
--
-- Los dos campos de clasificación son vocabulario CERRADO por CHECK, aunque el
-- editor del panel los pinte como texto libre:
--
--   chk_modelo_tipo_vehiculo: camion, autobus, turismo, furgoneta, agricola,
--                             otr, industrial, carretillas_elevadoras,
--                             multisegmento
--   chk_modelo_eje:           direccion, traccion, remolque, mixto
--
-- Así que «autobus», que es el término de la lista, y no «autocar». Los
-- modelos de autocar de Bridgestone que ya hay dicen «camion», que parece un
-- valor por defecto arrastrado más que una decisión.
--
-- La Z es multiposición → «mixto», igual que las X MULTI Z.

insert into tc_cat_modelos_neumatico
  (marca_id, nombre, activo, eje_recomendado, aplicacion, tipo_vehiculo,
   m_s, tres_pmsf, reesculturable, recauchutable)
values
  ((select id from tc_cat_marcas_neumatico where nombre = 'Michelin'),
   'X COACH Z', true, 'mixto', 'Larga distancia autocar', 'autobus',
   true, true, true, true),
  ((select id from tc_cat_marcas_neumatico where nombre = 'Michelin'),
   'X COACH D', true, 'traccion', 'Larga distancia autocar', 'autobus',
   true, true, true, true)
on conflict (marca_id, nombre) do update
  set activo          = excluded.activo,
      eje_recomendado = excluded.eje_recomendado,
      aplicacion      = excluded.aplicacion,
      tipo_vehiculo   = excluded.tipo_vehiculo,
      m_s             = excluded.m_s,
      tres_pmsf       = excluded.tres_pmsf,
      reesculturable  = excluded.reesculturable,
      recauchutable   = excluded.recauchutable;

-- ── Las dos referencias en 295/80R22.5 ──────────────────────────────────────
--
-- Ojo a la etiqueta: NO son iguales. La de tracción gasta más y suena más, que
-- es lo normal en un dibujo de tracción, pero conviene verlo escrito antes de
-- que alguien compare las dos y piense que hay una errata.
--
--   X COACH Z   rodadura C · mojado B · 71 dB
--   X COACH D   rodadura D · mojado C · 75 dB

insert into tc_referencias_neumatico
  (modelo_id, tyre_size_id, referencia_completa, activo,
   m_s, tres_pmsf,
   etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase,
   ean, verificacion_estado, fuente_oficial_url, fuente_corroboracion_url,
   verificacion_notas)
values
  ((select mo.id from tc_cat_modelos_neumatico mo
      join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
     where ma.nombre = 'Michelin' and mo.nombre = 'X COACH Z'),
   (select id from tyre_sizes where referencia_completa = '295/80R22.5 154/150M'),
   'Michelin X COACH Z 295/80R22.5 154/150M', true,
   true, true,
   'C', 'B', 71, null,
   '3528708562912', 'spec_corroborated_model_pending_official_page',
   'https://pro.michelin.es/neumaticos/michelin-x-coach-d-xd-z',
   'https://www.heuver.com/webshop/product/b29580225mimxoz00/295-80r22-5-michelin-x-coach-z-154-150m-tl-m-s-3pmsf',
   'Índices 154/150M. Multiposición. Datos tomados de búsquedas que citan la '
   'ficha de Michelin y de distribuidores: desde la sesión no se pudo abrir ni '
   'michelin.es ni eprel.ec.europa.eu (fuera de los dominios de red '
   'permitidos). Clase de ruido SIN PONER: un distribuidor dice A y otro B '
   'para los mismos 71 dB. Profundidad de dibujo SIN PONER: se vio 18/32" '
   '(14,3 mm) en un solo sitio, sin corroborar.'),

  ((select mo.id from tc_cat_modelos_neumatico mo
      join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
     where ma.nombre = 'Michelin' and mo.nombre = 'X COACH D'),
   (select id from tyre_sizes where referencia_completa = '295/80R22.5 154/150M'),
   'Michelin X COACH D 295/80R22.5 154/150M', true,
   true, true,
   'D', 'C', 75, 'B',
   '3528703335986', 'spec_corroborated_model_pending_official_page',
   'https://pro.michelin.es/neumaticos/michelin-x-coach-d-xd-z',
   'https://www.rsu.de/p/michelin-x-coach-d-vg-ti-295-80r22-5-154-150-m-9427066',
   'Índices 154/150M. Tracción. Datos tomados de búsquedas que citan la ficha '
   'de Michelin y de distribuidores: desde la sesión no se pudo abrir ni '
   'michelin.es ni eprel.ec.europa.eu (fuera de los dominios de red '
   'permitidos). Profundidad de dibujo SIN PONER: no se encontró dato fiable.')
on conflict (modelo_id, tyre_size_id) do update
  set referencia_completa    = excluded.referencia_completa,
      activo                 = excluded.activo,
      m_s                    = excluded.m_s,
      tres_pmsf              = excluded.tres_pmsf,
      etiqueta_rr            = excluded.etiqueta_rr,
      etiqueta_grip_humedo   = excluded.etiqueta_grip_humedo,
      etiqueta_ruido_db      = excluded.etiqueta_ruido_db,
      etiqueta_ruido_clase   = excluded.etiqueta_ruido_clase,
      ean                    = excluded.ean,
      verificacion_estado    = excluded.verificacion_estado,
      fuente_oficial_url     = excluded.fuente_oficial_url,
      fuente_corroboracion_url = excluded.fuente_corroboracion_url,
      verificacion_notas     = excluded.verificacion_notas,
      updated_at             = now();

commit;

-- ── Comprobación ────────────────────────────────────────────────────────────
--
-- Tienen que salir DOS filas, con su medida y su etiqueta. Si sale una, o
-- alguna columna va vacía donde no debería, algo no ha entrado.

select ma.nombre                         as marca,
       mo.nombre                         as modelo,
       mo.eje_recomendado,
       mo.tipo_vehiculo,
       ts.referencia_completa            as medida_con_indices,
       r.referencia_completa,
       r.etiqueta_rr                     as rodadura,
       r.etiqueta_grip_humedo            as mojado,
       r.etiqueta_ruido_db               as ruido_db,
       coalesce(r.etiqueta_ruido_clase, '(sin dato)') as ruido_clase,
       coalesce(r.profundidad_dibujo_mm::text, '(sin dato)') as profundidad_mm,
       r.ean,
       r.verificacion_estado
  from tc_referencias_neumatico r
  join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
  join tc_cat_marcas_neumatico ma  on ma.id = mo.marca_id
  join tyre_sizes ts               on ts.id = r.tyre_size_id
 where ma.nombre = 'Michelin' and mo.nombre in ('X COACH Z', 'X COACH D')
 order by mo.nombre;
