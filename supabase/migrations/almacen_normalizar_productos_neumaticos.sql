-- ============================================================
-- Almacén — normaliza los productos de neumáticos creados antes de
-- exigir selección del catálogo, para que su "medida" case con el
-- formato de tc_cat_medidas_neumatico (sin espacio, ej. "315/70R22.5"),
-- y elimina el duplicado exacto de Sailun SDL1.
-- ============================================================

-- "295/80R22-5" -> "295/80R22.5" (guion por error de tecleo, no punto)
update productos_neumaticos set medida = '295/80R22.5'
where medida = '295/80R22-5';

-- "315/70 R22.5" -> "315/70R22.5" (sin espacio, formato del catálogo)
update productos_neumaticos set medida = '315/70R22.5'
where medida = '315/70 R22.5';

-- Asegura que las medidas usadas ya existen en el catálogo compartido
insert into tc_cat_medidas_neumatico (valor)
select distinct medida from productos_neumaticos
where medida in ('295/80R22.5', '315/70R22.5')
on conflict (valor) do nothing;

-- Elimina el duplicado exacto de Sailun SDL1 154L 315/70R22.5,
-- conservando el registro más antiguo.
delete from productos_neumaticos p
where p.marca = 'Sailun' and p.modelo = 'SDL1 154L' and p.medida = '315/70R22.5'
  and p.id <> (
    select id from productos_neumaticos
    where marca = 'Sailun' and modelo = 'SDL1 154L' and medida = '315/70R22.5'
    order by id limit 1
  );
