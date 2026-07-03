-- ============================================================
-- Almacén — Fase 3: intenta enlazar los productos ya existentes con
-- su referencia exacta del catálogo (marca + modelo + medida, sin
-- espacios, coinciden). Solo se enlaza cuando hay una única
-- coincidencia sin ambigüedad; el resto se deja igual (normalmente
-- porque su marca/modelo aún no existen en el catálogo de TyreControl).
-- ============================================================

with candidatos as (
  select
    p.id as producto_id,
    r.id as referencia_id,
    ts.referencia_completa,
    count(*) over (partition by p.id) as coincidencias
  from productos_neumaticos p
  join tc_cat_marcas_neumatico ma on lower(ma.nombre) = lower(p.marca)
  join tc_cat_modelos_neumatico mo on mo.marca_id = ma.id and lower(mo.nombre) = lower(coalesce(p.modelo, ''))
  join tc_referencias_neumatico r on r.modelo_id = mo.id and r.activo = true
  join tyre_sizes ts on ts.id = r.tyre_size_id
  where p.referencia_neumatico_id is null
    and replace(upper(ts.medida), ' ', '') = replace(upper(p.medida), ' ', '')
)
update productos_neumaticos p
set referencia_neumatico_id = c.referencia_id,
    medida = c.referencia_completa
from candidatos c
where c.producto_id = p.id and c.coincidencias = 1;
