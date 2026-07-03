-- ============================================================
-- SEA TyreControl — Fase 18: datos técnicos reales para 5
-- referencias Hankook, obtenidos de fichas de distribuidor oficial
-- (Heuver.com, datos que replican la ficha técnica del fabricante).
-- Solo se rellenan los campos confirmados directamente en la fuente;
-- el resto de referencias quedan sin tocar (NULL) por no tener dato
-- confirmado — no se inventa ningún valor.
--
-- Fuentes (consultadas 2026-07-03):
-- https://www.heuver.com/webshop/product/10006031/385-65r22-5-hankook-smart-flex-ah51-164k-24pr-tl-m-s-3pmsf
-- https://www.heuver.com/webshop/product/10006059/315-70r22-5-hankook-smart-flex-dh51-154-150l-18pr-tl-m-s-3pmsf
-- https://www.heuver.com/webshop/product/10006002/295-80r22-5-hankook-smart-flex-dh51-152-148m-tl-m-s-3pmsf
-- https://www.heuver.com/webshop/product/10001830/385-55r22-5-hankook-smart-flex-th31-160k-18pr-tl-m-s-3pmsf
-- https://www.heuver.com/webshop/product/10002862/445-45r19-5-hankook-smart-flex-th31-160j-22pr-tl-3pmsf
-- ============================================================

-- AH51 385/65 R22.5 164K: 14 mm dibujo, 71.91 kg, 9 bar
update tc_referencias_neumatico r
set profundidad_dibujo_mm = 14, peso_kg = 71.91, presion_maxima_bar = 9
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'AH51' and ts.indice_carga_simple = '164' and ts.indice_carga_doble is null and ts.codigo_velocidad = 'K';

-- DH51 315/70 R22.5 154/150L: 17.6 mm dibujo, 64.87 kg, 9 bar
update tc_referencias_neumatico r
set profundidad_dibujo_mm = 17.6, peso_kg = 64.87, presion_maxima_bar = 9
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'DH51' and ts.indice_carga_simple = '154' and ts.indice_carga_doble = '150' and ts.codigo_velocidad = 'L'
  and ts.medida = '315/70 R22.5';

-- DH51 295/80 R22.5 152/148M: 18.2 mm dibujo, 66.03 kg, 8.5 bar
update tc_referencias_neumatico r
set profundidad_dibujo_mm = 18.2, peso_kg = 66.03, presion_maxima_bar = 8.5
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'DH51' and ts.indice_carga_simple = '152' and ts.indice_carga_doble = '148' and ts.codigo_velocidad = 'M'
  and ts.medida = '295/80 R22.5';

-- TH31+ 385/55 R22.5 160K: 14.6 mm dibujo, 65.81 kg, 9 bar
update tc_referencias_neumatico r
set profundidad_dibujo_mm = 14.6, peso_kg = 65.81, presion_maxima_bar = 9
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'TH31+' and ts.indice_carga_simple = '160' and ts.indice_carga_doble is null and ts.codigo_velocidad = 'K'
  and ts.medida = '385/55 R22.5';

-- TH31+ 445/45 R19.5 160J: 13.1 mm dibujo, 63.31 kg, 9 bar
update tc_referencias_neumatico r
set profundidad_dibujo_mm = 13.1, peso_kg = 63.31, presion_maxima_bar = 9
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'TH31+' and ts.indice_carga_simple = '160' and ts.indice_carga_doble is null and ts.codigo_velocidad = 'J'
  and ts.medida = '445/45 R19.5';
