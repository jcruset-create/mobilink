-- ============================================================
-- SEA TyreControl — Normalización de medidas (quita espacios)
-- Une variantes tipo "385/65 R22.5" con "385/65R22.5". Ejecutar una vez.
-- ============================================================

-- 1. Neumáticos: quita espacios de la medida (texto libre)
update tc_neumaticos
  set medida = regexp_replace(medida, '\s', '', 'g')
  where medida is not null and medida ~ '\s';

-- 2. Catálogo de medidas: normaliza el valor si no genera un duplicado
update tc_cat_medidas_neumatico c
  set valor = regexp_replace(valor, '\s', '', 'g')
  where valor ~ '\s'
    and not exists (
      select 1 from tc_cat_medidas_neumatico c2
      where c2.id <> c.id and c2.valor = regexp_replace(c.valor, '\s', '', 'g')
    );

-- 3. Si existía el duplicado espaciado en el catálogo y nadie lo referencia,
--    elimínalo (los vehículos/tyre_sizes referencian por medida_id).
delete from tc_cat_medidas_neumatico c
  where c.valor ~ '\s'
    and exists (select 1 from tc_cat_medidas_neumatico c2 where c2.valor = regexp_replace(c.valor, '\s', '', 'g'))
    and not exists (select 1 from tc_vehiculos v where v.medida_id = c.id)
    and not exists (select 1 from tyre_sizes t where t.medida_id = c.id);
