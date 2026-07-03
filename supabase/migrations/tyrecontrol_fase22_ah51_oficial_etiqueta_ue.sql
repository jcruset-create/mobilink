-- ============================================================
-- SEA TyreControl — Fase 22: tabla oficial completa de AH51
-- (aportada por el usuario) + campos de la etiqueta europea del
-- neumático (resistencia a la rodadura, agarre en mojado, ruido).
-- ============================================================

-- ── 1. Campos nuevos en tc_referencias_neumatico ────────────────
alter table tc_referencias_neumatico
  add column if not exists ply                 integer,
  add column if not exists ancho_seccion_mm     numeric,
  add column if not exists anchura_rodadura_mm  numeric,
  add column if not exists radio_carga_mm       numeric,
  add column if not exists etiqueta_rr          text,
  add column if not exists etiqueta_grip_humedo text,
  add column if not exists etiqueta_ruido_db    numeric,
  add column if not exists etiqueta_ruido_clase text;

alter table tc_referencias_neumatico drop constraint if exists chk_ref_etiqueta_rr;
alter table tc_referencias_neumatico add constraint chk_ref_etiqueta_rr
  check (etiqueta_rr is null or etiqueta_rr in ('A','B','C','D','E','F','G'));
alter table tc_referencias_neumatico drop constraint if exists chk_ref_etiqueta_grip;
alter table tc_referencias_neumatico add constraint chk_ref_etiqueta_grip
  check (etiqueta_grip_humedo is null or etiqueta_grip_humedo in ('A','B','C','D','E','F','G'));

-- ── 2. AH51 lleva M+S y 3PMSF en todas sus medidas (confirmado) ─
update tc_cat_modelos_neumatico set m_s = true, tres_pmsf = true where nombre = 'AH51';

-- ── 3. Desactivar combinaciones de AH51 que no existen en la ────
-- tabla oficial completa (aportada por el usuario)
update tc_referencias_neumatico r set activo = false
from tc_cat_modelos_neumatico m, tyre_sizes ts
where r.modelo_id = m.id and r.tyre_size_id = ts.id and m.nombre = 'AH51'
  and (
    (ts.medida = '295/80 R22.5' and ts.indice_carga_simple in ('152')) or
    (ts.medida = '315/70 R22.5' and ts.indice_carga_simple = '154') or
    (ts.medida = '315/80 R22.5' and ts.indice_carga_simple = '154' and ts.codigo_velocidad = 'L') or
    (ts.medida = '315/80 R22.5' and ts.indice_carga_simple = '156' and ts.codigo_velocidad = 'K') or
    (ts.medida = '385/55 R22.5' and ts.codigo_velocidad in ('J','L') and ts.indice_carga_doble is null) or
    (ts.medida = '385/65 R22.5' and ts.indice_carga_simple = '160' and ts.codigo_velocidad = 'J') or
    (ts.medida = '435/50 R19.5') or
    (ts.medida = '445/45 R19.5')
  );

-- ── 4. Medida que falta en tyre_sizes (355/50R22.5 156K, sin dual) ─
insert into tyre_sizes (medida, ancho, perfil, diametro_llanta, indice_carga_simple, indice_carga_doble, codigo_velocidad, referencia_completa)
values ('355/50 R22.5', 355, 50, 22.5, '156', null, 'K', '355/50 R22.5 156K')
on conflict (referencia_completa) do nothing;

update tyre_sizes t set medida_id = c.id
  from tc_cat_medidas_neumatico c
  where t.medida_id is null and c.valor = replace(t.medida, ' ', '');

-- ── 5. Referencias reales de AH51 con todos los datos oficiales ──
-- (crea las que faltan, actualiza las que ya existían)
with datos(medida, carga_s, carga_d, codigo, ply, load_s, load_d, air_s, air_d, diam, seccion, rodadura, dibujo, radio, rr, grip, ruido, clase, carga_max) as (
  values
    ('275/70 R22.5', '148', '145', 'M', 16, 3150, 2900::numeric, 131, 131, 958, 279, 232, 14.6, 450, 'C', 'C', 72, 'A', 3150),
    ('295/80 R22.5', '154', '149', 'M', 18, 3750, 3250::numeric, 123, 131, 1048, 300, 246, 15, 488, 'C', 'B', 72, 'A', 3750),
    ('315/60 R22.5', '154', '148', 'L', 20, 3750, 3150::numeric, 131, 131, 947, 316, 280, 12.1, 445, 'C', 'B', 72, 'A', 3750),
    ('315/70 R22.5', '156', '150', 'L', 20, 4000, 3350::numeric, 131, 131, 1010, 314, 270, 15, 472, 'C', 'B', 72, 'A', 4000),
    ('315/80 R22.5', '156', '150', 'L', 20, 4000, 3350::numeric, 123, 123, 1077, 310, 260, 16.5, 500, 'C', 'B', 72, 'A', 4000),
    ('315/80 R22.5', '154', '150', 'M', 20, 4000, 3350::numeric, 123, 123, 1077, 310, 260, 16.5, 500, 'C', 'B', 72, 'A', 4000),
    ('355/50 R22.5', '156', null, 'K', 18, 4000, null, 131, null, 933, 360, 306, 13.1, 439, 'B', 'B', 70, 'A', 4000),
    ('385/55 R22.5', '160', null, 'K', 20, 4500, null, 131, null, 998, 382, 324, 14.1, 467, 'B', 'B', 70, 'A', 4500),
    ('385/55 R22.5', '158', null, 'L', 20, 4500, null, 131, null, 998, 382, 324, 14.1, 467, 'B', 'B', 70, 'A', 4500),
    ('385/65 R22.5', '160', null, 'K', 20, 4500, null, 131, null, 1068, 382, 308, 14.1, 496, 'B', 'B', 70, 'A', 4500),
    ('385/65 R22.5', '158', null, 'L', 20, 4500, null, 131, null, 1068, 382, 308, 14.1, 496, 'B', 'B', 70, 'A', 4500),
    ('385/65 R22.5', '164', null, 'K', 24, 5000, null, 131, null, 1068, 382, 308, 14.1, 496, 'B', 'B', 70, 'A', 5000)
)
insert into tc_referencias_neumatico (
  modelo_id, tyre_size_id, referencia_completa, ply, ancho_seccion_mm, anchura_rodadura_mm,
  radio_carga_mm, profundidad_dibujo_mm, diametro_exterior_mm, carga_maxima_kg, presion_maxima_bar,
  etiqueta_rr, etiqueta_grip_humedo, etiqueta_ruido_db, etiqueta_ruido_clase
)
select m.id, ts.id, 'Hankook AH51 ' || ts.referencia_completa, d.ply, d.seccion, d.rodadura,
  d.radio, d.dibujo, d.diam, d.carga_max, round(d.air_s * 0.0689476::numeric, 2),
  d.rr, d.grip, d.ruido, d.clase
from datos d
join tc_cat_modelos_neumatico m on m.nombre = 'AH51'
join tyre_sizes ts on ts.medida = d.medida and ts.indice_carga_simple = d.carga_s
  and coalesce(ts.indice_carga_doble, '') = coalesce(d.carga_d, '') and ts.codigo_velocidad = d.codigo
on conflict (modelo_id, tyre_size_id) do update set
  ply = excluded.ply, ancho_seccion_mm = excluded.ancho_seccion_mm, anchura_rodadura_mm = excluded.anchura_rodadura_mm,
  radio_carga_mm = excluded.radio_carga_mm, profundidad_dibujo_mm = excluded.profundidad_dibujo_mm,
  diametro_exterior_mm = excluded.diametro_exterior_mm, carga_maxima_kg = excluded.carga_maxima_kg,
  presion_maxima_bar = excluded.presion_maxima_bar, etiqueta_rr = excluded.etiqueta_rr,
  etiqueta_grip_humedo = excluded.etiqueta_grip_humedo, etiqueta_ruido_db = excluded.etiqueta_ruido_db,
  etiqueta_ruido_clase = excluded.etiqueta_ruido_clase, activo = true;
