-- ============================================================
-- Almacén — Fase 4: cuando se añade una referencia nueva al catálogo
-- de TyreControl (tc_referencias_neumatico), enlaza automáticamente
-- los productos de almacén ya existentes que coincidan por marca +
-- modelo + medida y que todavía no tuvieran referencia asignada.
-- Así, cuando Sailun/Michelin (u otra marca) se den de alta en el
-- catálogo, sus productos de almacén ya creados quedan enlazados
-- solos, sin tener que volver a ejecutar el backfill a mano.
-- ============================================================

create or replace function tc_autoenlazar_productos_almacen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_marca text; v_modelo text; v_medida_base text; v_referencia_completa text;
begin
  select ma.nombre, mo.nombre into v_marca, v_modelo
  from tc_cat_modelos_neumatico mo
  join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
  where mo.id = new.modelo_id;

  select ts.medida, ts.referencia_completa into v_medida_base, v_referencia_completa
  from tyre_sizes ts where ts.id = new.tyre_size_id;

  update productos_neumaticos p
  set referencia_neumatico_id = new.id,
      medida = v_referencia_completa
  where p.referencia_neumatico_id is null
    and lower(p.marca) = lower(v_marca)
    and lower(coalesce(p.modelo, '')) = lower(v_modelo)
    and replace(upper(p.medida), ' ', '') = replace(upper(v_medida_base), ' ', '');

  return new;
end $$;

drop trigger if exists trg_autoenlazar_productos_almacen on tc_referencias_neumatico;
create trigger trg_autoenlazar_productos_almacen
  after insert on tc_referencias_neumatico
  for each row execute function tc_autoenlazar_productos_almacen();
