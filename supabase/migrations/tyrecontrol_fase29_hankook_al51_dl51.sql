-- ============================================================
-- SEA TyreControl — Fase 29: nuevos modelos Hankook AL51 (dirección)
-- y DL51 (tracción), distintos de AL50/DL50 ya existentes, con datos
-- oficiales completos (incluida etiqueta europea) aportados por el
-- usuario.
-- ============================================================

-- ── 1. Modelos nuevos ────────────────────────────────────────────
insert into tc_cat_modelos_neumatico (marca_id, nombre, gama, eje_recomendado, aplicacion, tipo_vehiculo, m_s, tres_pmsf)
select m.id, v.nombre, 'SmartFlex', v.eje, 'larga_distancia', 'camion', true, true
from tc_cat_marcas_neumatico m
cross join (values ('AL51', 'direccion'), ('DL51', 'traccion')) as v(nombre, eje)
where m.nombre = 'Hankook'
on conflict (marca_id, nombre) do update set
  gama = excluded.gama, eje_recomendado = excluded.eje_recomendado, aplicacion = excluded.aplicacion,
  tipo_vehiculo = excluded.tipo_vehiculo, m_s = excluded.m_s, tres_pmsf = excluded.tres_pmsf;

-- ── 2. Medida que podría faltar en tyre_sizes (315/80 R22.5 156/150L) ─
insert into tc_cat_medidas_neumatico (valor) values ('315/80R22.5') on conflict (valor) do nothing;
insert into tyre_sizes (medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad, referencia_completa)
values ('315/80 R22.5', 315, 80, 22.5, '156', '150', 'L', '315/80 R22.5 156/150L')
on conflict (referencia_completa) do nothing;
update tyre_sizes t set medida_id = c.id from tc_cat_medidas_neumatico c
  where t.medida_id is null and c.valor = replace(t.medida, ' ', '');

-- ── 3. Referencias de AL51 y DL51 con datos oficiales completos ──
with datos(modelo, medida, carga_s, carga_d, codigo, ply, seccion, rodadura, dibujo, diam, radio, rr, grip, ruido, clase, air_psi, carga_max) as (
  values
    ('AL51', '295/80 R22.5', '154', '149', 'M', 18, 300, 230, 13.6, 1045, 486, 'B', 'C', 70, 'A', 123, 3750),
    ('AL51', '315/70 R22.5', '156', '150', 'L', 20, 314, 270, 14.1, 1008, 471, 'B', 'B', 72, 'A', 131, 4000),
    ('AL51', '385/65 R22.5', '160', null,  'K', 20, 382, 308, 13.1, 1067, 496, 'B', 'B', 70, 'A', 131, 4500),
    ('DL51', '295/80 R22.5', '154', '149', 'M', 18, 300, 266, 16.5, 1052, 489, 'C', 'C', 73, 'A', 123, 3750),
    ('DL51', '315/70 R22.5', '154', '150', 'L', 18, 314, 290, 15,   1010, 472, 'C', 'B', 73, 'A', 131, 3750),
    ('DL51', '315/80 R22.5', '156', '150', 'L', 20, 310, 280, 17,   1078, 501, 'C', 'B', 73, 'A', 123, 4000)
)
insert into tc_referencias_neumatico (
  modelo_id, tyre_size_id, referencia_completa, ply, ancho_seccion_mm, anchura_rodadura_mm,
  radio_carga_mm, profundidad_dibujo_mm, diametro_exterior_mm, carga_maxima_kg, presion_maxima_bar,
  etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase
)
select mo.id, ts.id, 'Hankook ' || d.modelo || ' ' || ts.referencia_completa, d.ply, d.seccion, d.rodadura,
  d.radio, d.dibujo, d.diam, d.carga_max, round(d.air_psi * 0.0689476::numeric, 2),
  d.rr, d.grip, d.ruido, d.clase
from datos d
join tc_cat_marcas_neumatico ma on ma.nombre = 'Hankook'
join tc_cat_modelos_neumatico mo on mo.marca_id = ma.id and mo.nombre = d.modelo
join tyre_sizes ts on ts.medida = d.medida and ts.indice_carga_simple = d.carga_s
  and coalesce(ts.indice_carga_doble, '') = coalesce(d.carga_d, '') and ts.codigo_velocidad = d.codigo
on conflict (modelo_id, tyre_size_id) do update set
  ply = excluded.ply, ancho_seccion_mm = excluded.ancho_seccion_mm, anchura_rodadura_mm = excluded.anchura_rodadura_mm,
  radio_carga_mm = excluded.radio_carga_mm, profundidad_dibujo_mm = excluded.profundidad_dibujo_mm,
  diametro_exterior_mm = excluded.diametro_exterior_mm, carga_maxima_kg = excluded.carga_maxima_kg,
  presion_maxima_bar = excluded.presion_maxima_bar, etiqueta_rr = excluded.etiqueta_rr,
  etiqueta_grip_humedo = excluded.etiqueta_grip_humedo, etiqueta_ruido_db = excluded.etiqueta_ruido_db,
  etiqueta_ruido_clase = excluded.etiqueta_ruido_clase, activo = true;
