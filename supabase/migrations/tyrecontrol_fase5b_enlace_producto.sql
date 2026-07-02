-- ============================================================
-- SEA TyreControl — Fase 5b: enlace tc_neumaticos ↔ productos_neumaticos
-- El almacén ya tiene un catálogo real: productos_neumaticos
-- (id, empresa_id, marca, modelo, medida, dot, activo).
-- Enlazamos cada neumático de TyreControl a su producto de catálogo
-- para poder identificar el producto_id al escribir movimientos_stock
-- en una fase posterior (montaje = SALIDA, devolución = ENTRADA).
-- ============================================================

alter table tc_neumaticos
  add constraint fk_tc_neu_almacen_producto
  foreign key (almacen_producto_id) references productos_neumaticos(id) on delete set null;

create index if not exists idx_tc_neu_almacen_producto on tc_neumaticos (almacen_producto_id);

-- Vista de solo lectura del catálogo, filtrada al cliente de almacén
-- enlazado con la empresa de TyreControl del usuario (o global si admin SEA).
create or replace view tc_productos_almacen as
  select p.id, p.empresa_id as empresa_id_almacen, p.marca, p.modelo, p.medida, p.dot, p.activo
  from productos_neumaticos p
  where tc_is_admin();

grant select on tc_productos_almacen to authenticated;
