-- ============================================================
-- SEA TyreControl — Fase 19: datos técnicos OFICIALES de Hankook
-- (2025 TBR Catalog EU, aportado por el usuario). Sustituye/refina
-- los datos de la Fase 18 (sacados de un distribuidor) por los del
-- propio catálogo del fabricante, allí donde coinciden exactamente
-- con una referencia ya existente en tc_referencias_neumatico.
--
-- Presión: el catálogo la da en PSI, se convierte a bar (1 psi =
-- 0.0689476 bar). Peso (kg): el catálogo oficial NO incluye peso —
-- se conserva el de la Fase 18 (fuente distribuidor) donde ya existía.
-- ============================================================

-- AH51 295/80 R22.5 154/149M: diam 1048mm, dibujo 15mm, radio 488mm, 8.5 bar, 4000 kg
update tc_referencias_neumatico r
set diametro_exterior_mm = 1048, profundidad_dibujo_mm = 15, presion_maxima_bar = 8.5, carga_maxima_kg = 4000
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'AH51' and ts.medida = '295/80 R22.5' and ts.indice_carga_simple = '154' and ts.indice_carga_doble = '149' and ts.codigo_velocidad = 'M';

-- AH51 315/60 R22.5 154/148L: diam 947mm, dibujo 12.1mm, 9 bar, 4000 kg
update tc_referencias_neumatico r
set diametro_exterior_mm = 947, profundidad_dibujo_mm = 12.1, presion_maxima_bar = 9, carga_maxima_kg = 4000
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'AH51' and ts.medida = '315/60 R22.5' and ts.indice_carga_simple = '154' and ts.indice_carga_doble = '148' and ts.codigo_velocidad = 'L';

-- AH51 315/70 R22.5 156/150L: diam 1010mm, dibujo 15mm, 9 bar, 4500 kg
update tc_referencias_neumatico r
set diametro_exterior_mm = 1010, profundidad_dibujo_mm = 15, presion_maxima_bar = 9, carga_maxima_kg = 4500
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'AH51' and ts.medida = '315/70 R22.5' and ts.indice_carga_simple = '156' and ts.indice_carga_doble = '150' and ts.codigo_velocidad = 'L';

-- AH51 385/65 R22.5 164K: diam 1068mm, dibujo 14.1mm, 9 bar (refina Fase 18: mantiene peso 71.91kg del distribuidor)
update tc_referencias_neumatico r
set diametro_exterior_mm = 1068, profundidad_dibujo_mm = 14.1, presion_maxima_bar = 9
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'AH51' and ts.medida = '385/65 R22.5' and ts.indice_carga_simple = '164' and ts.indice_carga_doble is null and ts.codigo_velocidad = 'K';

-- DH51 295/80 R22.5 152/148M: diam 1056mm, dibujo 18.4mm, 8.5 bar, 4000 kg (refina Fase 18)
update tc_referencias_neumatico r
set diametro_exterior_mm = 1056, profundidad_dibujo_mm = 18.4, presion_maxima_bar = 8.5, carga_maxima_kg = 4000
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'DH51' and ts.medida = '295/80 R22.5' and ts.indice_carga_simple = '152' and ts.indice_carga_doble = '148' and ts.codigo_velocidad = 'M';

-- DH51 315/70 R22.5 154/150L: diam 1015.6mm, dibujo 17.8mm, 9 bar (refina Fase 18)
update tc_referencias_neumatico r
set diametro_exterior_mm = 1015.6, profundidad_dibujo_mm = 17.8, presion_maxima_bar = 9
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'DH51' and ts.medida = '315/70 R22.5' and ts.indice_carga_simple = '154' and ts.indice_carga_doble = '150' and ts.codigo_velocidad = 'L';

-- TH31+ 385/55 R22.5 160K: diam 1000mm, dibujo 14.6mm, 9 bar (refina Fase 18)
update tc_referencias_neumatico r
set diametro_exterior_mm = 1000, profundidad_dibujo_mm = 14.6, presion_maxima_bar = 9
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'TH31+' and ts.medida = '385/55 R22.5' and ts.indice_carga_simple = '160' and ts.indice_carga_doble is null and ts.codigo_velocidad = 'K';
