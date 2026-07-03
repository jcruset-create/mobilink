-- ============================================================
-- SEA TyreControl — Fase 21: completa AL50/DL50 con las medidas
-- del catálogo oficial que en la Fase 20 quedaron pendientes por
-- ambigüedad de extracción, y que ahora se han podido leer con
-- claridad releyendo el bloque completo de la tabla (pág. 16-17).
-- ============================================================

-- Medidas nuevas que faltan en tyre_sizes
insert into tc_cat_medidas_neumatico (valor) values ('355/50R22.5'), ('385/55R22.5'), ('315/80R22.5')
  on conflict (valor) do nothing;

insert into tyre_sizes (medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad, referencia_completa)
values
  ('355/50 R22.5', 355, 50, 22.5, '156', '150', 'L', '355/50 R22.5 156/150L'),
  ('385/55 R22.5', 385, 55, 22.5, '156', '150', 'L', '385/55 R22.5 156/150L 154/150M')
on conflict (referencia_completa) do nothing;

update tyre_sizes t set medida_id = c.id
  from tc_cat_medidas_neumatico c
  where t.medida_id is null and c.valor = replace(t.medida, ' ', '');

-- AL50 355/50 R22.5 156/150L: Ply20, 131 psi (9.03 bar), carga 4000 kg,
-- diam 1003mm, dibujo 11.6mm
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, diametro_exterior_mm, profundidad_dibujo_mm, presion_maxima_bar, carga_maxima_kg)
select m.id, ts.id, 'Hankook AL50 ' || ts.referencia_completa, 1003, 11.6, 9, 4000
from tc_cat_modelos_neumatico m, tyre_sizes ts
where m.nombre = 'AL50' and ts.medida = '355/50 R22.5' and ts.indice_carga_simple = '156' and ts.indice_carga_doble = '150' and ts.codigo_velocidad = 'L'
on conflict (modelo_id, tyre_size_id) do nothing;

-- AL50 385/55 R22.5 156/150L (154/150M): Ply20, 123 psi (8.5 bar), carga 4500 kg,
-- diam 1070mm, dibujo 13.1mm
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, diametro_exterior_mm, profundidad_dibujo_mm, presion_maxima_bar, carga_maxima_kg)
select m.id, ts.id, 'Hankook AL50 ' || ts.referencia_completa, 1070, 13.1, 8.5, 4500
from tc_cat_modelos_neumatico m, tyre_sizes ts
where m.nombre = 'AL50' and ts.medida = '385/55 R22.5' and ts.indice_carga_simple = '156' and ts.indice_carga_doble = '150' and ts.codigo_velocidad = 'L'
on conflict (modelo_id, tyre_size_id) do nothing;

-- DL50 315/80 R22.5 156/150L (154/150M): Ply20, 123 psi (8.5 bar),
-- diam 1074mm, dibujo 15mm
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, diametro_exterior_mm, profundidad_dibujo_mm, presion_maxima_bar)
select m.id, ts.id, 'Hankook DL50 ' || ts.referencia_completa, 1074, 15, 8.5
from tc_cat_modelos_neumatico m, tyre_sizes ts
where m.nombre = 'DL50' and ts.medida = '315/80 R22.5' and ts.indice_carga_simple = '156' and ts.indice_carga_doble = '150' and ts.codigo_velocidad = 'L'
on conflict (modelo_id, tyre_size_id) do nothing;

-- ============================================================
-- Sigue sin tocarse: TH31+ en 435/50R19.5 y 445/45R19.5. Al releer el
-- catálogo, esas dos medidas con índice 164J aparecen bajo el modelo
-- "TH31" (no "TH31+") — el TH31+ real, en la página consultada, solo
-- lista una medida (385/65R22.5). Es decir, el problema podría no ser
-- solo el índice de carga (160J vs 164J) sino que esas dos medidas ni
-- siquiera pertenezcan a TH31+. No se corrige hasta confirmarlo mejor.
-- ============================================================
