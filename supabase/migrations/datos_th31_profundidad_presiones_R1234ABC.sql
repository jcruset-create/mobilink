-- ============================================================
-- DATOS (no esquema) — Rellenar mm de neumáticos nuevos + presiones.
--
-- Motivo: en la pantalla de "Cambiar neumático" los neumáticos NUEVOS del
-- modelo Hankook TH31+ salían "— mm" (sin medición todavía y sin profundidad
-- de dibujo en el catálogo) y todas las posiciones salían "— bar" (sin presión
-- objetivo configurada).
--
-- Ejecutar por partes. Lanza primero cada SELECT de verificación y, si el
-- listado es correcto, ejecuta el UPDATE/INSERT de debajo.
-- ============================================================

-- ── 1) Profundidad de dibujo del Hankook TH31+ = 16 mm ───────
-- (spec del 385/65R22.5 160K; se aplica al modelo en el catálogo, así que
--  cualquier neumático nuevo de ese modelo mostrará 16 mm hasta que se mida)

-- VERIFICA qué referencias coincide:
select r.id, ma.nombre AS marca, mo.nombre AS modelo, ts.medida, r.profundidad_dibujo_mm, r.presion_maxima_bar
from tc_referencias_neumatico r
join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
join tc_cat_marcas_neumatico  ma on ma.id = mo.marca_id
left join tyre_sizes ts on ts.id = r.tyre_size_id
where ma.nombre ilike 'hankook' and mo.nombre ilike 'th31%';

-- Si el listado es correcto, aplica (solo rellena las que estén vacías):
update tc_referencias_neumatico r
set profundidad_dibujo_mm = 16
from tc_cat_modelos_neumatico mo
join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
where r.modelo_id = mo.id
  and ma.nombre ilike 'hankook' and mo.nombre ilike 'th31%'
  and r.profundidad_dibujo_mm is null;

-- (OPCIONAL) presión máxima del catálogo = 9.0 bar para ese modelo. Con esto
-- las tarjetas mostrarían 9.0 bar como último recurso aunque no haya presión
-- objetivo por eje. Descomenta si lo quieres a nivel de modelo:
-- update tc_referencias_neumatico r
-- set presion_maxima_bar = 9.0
-- from tc_cat_modelos_neumatico mo
-- join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
-- where r.modelo_id = mo.id
--   and ma.nombre ilike 'hankook' and mo.nombre ilike 'th31%'
--   and r.presion_maxima_bar is null;

-- ── 2) Presiones objetivo por eje del vehículo R1234ABC ──────
-- ⚠️  9.0 bar es un valor de REFERENCIA. Cámbialo por vuestra presión real de
--     trabajo (depende de la carga por eje) antes de ejecutar si procede.

-- VERIFICA el vehículo y sus ejes:
select v.id, v.matricula, v.empresa_id from tc_vehiculos v where v.matricula = 'R1234ABC';

-- Inserta la presión objetivo para los ejes 1, 2 y 3 (si no existe ya):
insert into tc_presiones_objetivo (vehiculo_id, eje, presion_objetivo_bar, margen_bar, empresa_id)
select v.id, e.eje, 9.0, 0.5, v.empresa_id
from tc_vehiculos v
cross join (values (1),(2),(3)) as e(eje)
where v.matricula = 'R1234ABC'
  and not exists (
    select 1 from tc_presiones_objetivo p where p.vehiculo_id = v.id and p.eje = e.eje
  );
