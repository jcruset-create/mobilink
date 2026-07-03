-- ============================================================
-- Almacén — Fase 5: sincroniza el catálogo completo de TyreControl
-- como productos de almacén de "Empresa principal", y automatiza
-- que cada referencia nueva que se cree en el catálogo genere ya
-- su producto de almacén correspondiente, sin alta manual.
-- ============================================================

-- ── 1. Backfill: crea el producto que falte para cada referencia ─
-- activa del catálogo, en la empresa "Empresa principal".
insert into productos_neumaticos (empresa_id, marca, modelo, medida, dot, activo, referencia_neumatico_id)
select e.id, ma.nombre, mo.nombre, ts.referencia_completa, null, true, r.id
from tc_referencias_neumatico r
join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
join tc_cat_marcas_neumatico ma on ma.id = mo.marca_id
join tyre_sizes ts on ts.id = r.tyre_size_id
cross join (select id from empresas where nombre = 'Empresa principal') e
where r.activo = true
  and not exists (
    select 1 from productos_neumaticos p
    where p.referencia_neumatico_id = r.id and p.empresa_id = e.id
  );

-- ── 2. A partir de ahora: cada referencia nueva del catálogo crea ─
-- automáticamente su producto en "Empresa principal", además de
-- seguir enlazando productos ya existentes de otras empresas que
-- coincidan por marca+modelo+medida (comportamiento de la Fase 4).
create or replace function tc_autoenlazar_productos_almacen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_marca text; v_modelo text; v_medida_base text; v_referencia_completa text; v_empresa_principal uuid;
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

  select id into v_empresa_principal from empresas where nombre = 'Empresa principal';
  if v_empresa_principal is not null and not exists (
    select 1 from productos_neumaticos where referencia_neumatico_id = new.id and empresa_id = v_empresa_principal
  ) then
    insert into productos_neumaticos (empresa_id, marca, modelo, medida, activo, referencia_neumatico_id)
    values (v_empresa_principal, v_marca, v_modelo, v_referencia_completa, true, new.id);
  end if;

  return new;
end $$;
