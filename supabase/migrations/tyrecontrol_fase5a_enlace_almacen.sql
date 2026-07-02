-- ============================================================
-- SEA TyreControl — Fase 5a: enlace tc_empresas ↔ clientes (almacén)
-- Confirmado: una empresa de TyreControl (tc_empresas) es el MISMO
-- cliente que en el módulo de almacén (tabla `clientes`).
-- Este paso SOLO añade el enlace y una vista de apoyo para elegirlo
-- desde la ficha de empresa. NO escribe en movimientos_stock todavía
-- (pendiente de definir cómo se identifica el producto de almacén
-- al montar un neumático, ya que `movimientos_stock` no tiene un
-- catálogo de productos, solo producto_id + texto libre histórico).
-- ============================================================

alter table tc_empresas
  add column if not exists cliente_almacen_id uuid references clientes(id) on delete set null;

create index if not exists idx_tc_empresas_cliente_almacen on tc_empresas (cliente_almacen_id);

comment on column tc_empresas.cliente_almacen_id is
  'Enlace al cliente equivalente en el módulo de almacén (tabla clientes). Mismo cliente, dos apps.';

-- Vista de solo lectura para el selector de enlace en la ficha de empresa.
-- Solo visible para administradores de TyreControl (evita filtrar la
-- cartera de clientes del almacén a usuarios cliente/operador).
create or replace view tc_clientes_almacen as
  select id, empresa_id as empresa_id_almacen, codigo, nombre, nif, telefono, email, activo
  from clientes
  where tc_is_admin();

grant select on tc_clientes_almacen to authenticated;
