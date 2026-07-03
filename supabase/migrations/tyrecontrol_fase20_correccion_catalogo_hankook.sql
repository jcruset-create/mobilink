-- ============================================================
-- SEA TyreControl — Fase 20: corrección del catálogo Hankook según
-- el catálogo técnico oficial 2025 TBR EU (no según los cruces
-- genéricos de la Fase 17, que asumían combinaciones que en
-- realidad el fabricante no comercializa para esos modelos).
-- ============================================================

-- ── 1. Desactivar combinaciones que NO existen realmente ───────
-- TH31+ no se fabrica en 13R22.5 ni 12R22.5 (no aparecen en el catálogo).
update tc_referencias_neumatico r set activo = false
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'TH31+' and ts.medida in ('13 R22.5', '12 R22.5');

-- AL50 no se fabrica en 295/80, 275/70 ni 245/70 (el catálogo solo
-- lista 295/60, 315/60, 315/70, 315/80, 355/50 y 385/55 R22.5).
update tc_referencias_neumatico r set activo = false
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'AL50' and ts.medida in ('295/80 R22.5', '275/70 R22.5', '245/70 R19.5');

-- DL50 no se fabrica en 295/80, 305/70, 265/70 ni 285/70 (el catálogo
-- solo lista 295/60, 315/60, 315/70 y 315/80 R22.5).
update tc_referencias_neumatico r set activo = false
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id
  and m.nombre = 'DL50' and ts.medida in ('295/80 R22.5', '305/70 R22.5', '265/70 R19.5', '285/70 R19.5');

-- ── 2. Medidas reales confirmadas que faltaban en tyre_sizes ────
insert into tc_cat_medidas_neumatico (valor) values ('315/70R22.5'), ('315/60R22.5'), ('275/70R22.5')
  on conflict (valor) do nothing;

insert into tyre_sizes (medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad, referencia_completa)
values
  ('315/70 R22.5', 315, 70, 22.5, '154', '148', 'L', '315/70 R22.5 154/148L'),
  ('315/60 R22.5', 315, 60, 22.5, '152', '148', 'L', '315/60 R22.5 152/148L'),
  ('275/70 R22.5', 275, 70, 22.5, '148', '145', 'M', '275/70 R22.5 148/145M')
on conflict (referencia_completa) do nothing;

update tyre_sizes t set medida_id = c.id
  from tc_cat_medidas_neumatico c
  where t.medida_id is null and c.valor = replace(t.medida, ' ', '');

-- ── 3. Nuevas referencias reales (con datos oficiales de fábrica) ─
-- AH51 275/70 R22.5 148/145M: diam 958mm, dibujo 14.6mm, 9 bar, 3750 kg
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, diametro_exterior_mm, profundidad_dibujo_mm, presion_maxima_bar, carga_maxima_kg)
select m.id, ts.id, 'Hankook AH51 ' || ts.referencia_completa, 958, 14.6, 9, 3750
from tc_cat_modelos_neumatico m, tyre_sizes ts
where m.nombre = 'AH51' and ts.medida = '275/70 R22.5' and ts.indice_carga_simple = '148' and ts.indice_carga_doble = '145' and ts.codigo_velocidad = 'M'
on conflict (modelo_id, tyre_size_id) do nothing;

-- AL50 315/70 R22.5 154/148L: diam 943mm, dibujo 10.7mm, 9 bar, 4000 kg
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, diametro_exterior_mm, profundidad_dibujo_mm, presion_maxima_bar, carga_maxima_kg)
select m.id, ts.id, 'Hankook AL50 ' || ts.referencia_completa, 943, 10.7, 9, 4000
from tc_cat_modelos_neumatico m, tyre_sizes ts
where m.nombre = 'AL50' and ts.medida = '315/70 R22.5' and ts.indice_carga_simple = '154' and ts.indice_carga_doble = '148' and ts.codigo_velocidad = 'L'
on conflict (modelo_id, tyre_size_id) do nothing;

-- DL50 315/60 R22.5 152/148L: diam 950mm, dibujo 13.6mm, 9 bar, 3750 kg
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, diametro_exterior_mm, profundidad_dibujo_mm, presion_maxima_bar, carga_maxima_kg)
select m.id, ts.id, 'Hankook DL50 ' || ts.referencia_completa, 950, 13.6, 9, 3750
from tc_cat_modelos_neumatico m, tyre_sizes ts
where m.nombre = 'DL50' and ts.medida = '315/60 R22.5' and ts.indice_carga_simple = '152' and ts.indice_carga_doble = '148' and ts.codigo_velocidad = 'L'
on conflict (modelo_id, tyre_size_id) do nothing;

-- DL50 315/70 R22.5 154/150L: diam 1005mm, dibujo 12.6mm, 9 bar (combinación ya existía en tyre_sizes)
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, diametro_exterior_mm, profundidad_dibujo_mm, presion_maxima_bar)
select m.id, ts.id, 'Hankook DL50 ' || ts.referencia_completa, 1005, 12.6, 9
from tc_cat_modelos_neumatico m, tyre_sizes ts
where m.nombre = 'DL50' and ts.medida = '315/70 R22.5' and ts.indice_carga_simple = '154' and ts.indice_carga_doble = '150' and ts.codigo_velocidad = 'L'
on conflict (modelo_id, tyre_size_id) do nothing;

-- AL50 295/60 R22.5 150/147L: diam 916mm, dibujo 11.2mm, 9 bar
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, diametro_exterior_mm, profundidad_dibujo_mm, presion_maxima_bar)
select m.id, ts.id, 'Hankook AL50 ' || ts.referencia_completa, 916, 11.2, 9
from tc_cat_modelos_neumatico m, tyre_sizes ts
where m.nombre = 'AL50' and ts.medida = '295/60 R22.5' and ts.indice_carga_simple = '150' and ts.indice_carga_doble = '147' and ts.codigo_velocidad = 'L'
on conflict (modelo_id, tyre_size_id) do nothing;

-- DL50 295/60 R22.5 150/147L: diam 917mm, dibujo 13.1mm, 9 bar
insert into tc_referencias_neumatico (modelo_id, tyre_size_id, referencia_completa, diametro_exterior_mm, profundidad_dibujo_mm, presion_maxima_bar)
select m.id, ts.id, 'Hankook DL50 ' || ts.referencia_completa, 917, 13.1, 9
from tc_cat_modelos_neumatico m, tyre_sizes ts
where m.nombre = 'DL50' and ts.medida = '295/60 R22.5' and ts.indice_carga_simple = '150' and ts.indice_carga_doble = '147' and ts.codigo_velocidad = 'L'
on conflict (modelo_id, tyre_size_id) do nothing;

-- ============================================================
-- Pendiente (no incluido por ambigüedad en el texto extraído del
-- PDF, para no arriesgar datos incorrectos): AL50/DL50 en 315/80 R22.5
-- y 355/50/385/55 R22.5 — el catálogo las menciona pero la tabla se
-- desordenó al extraer el texto y no puedo confirmar con certeza los
-- números exactos de esas filas. También quedan sin corregir
-- 435/50 R19.5 y 445/45 R19.5 de TH31+: el catálogo oficial dice
-- índice de carga 164J, pero la ficha ya cargada usa 160J (de un
-- distribuidor) — puede que ambas variantes existan realmente, así
-- que no se sobrescribe sin confirmación.
-- ============================================================
