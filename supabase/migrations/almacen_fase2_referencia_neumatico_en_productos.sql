-- ============================================================
-- Almacén — Fase 2: enlaza cada producto de neumático con su
-- referencia exacta del catálogo de TyreControl (tc_referencias_neumatico:
-- modelo + medida + índice de carga/velocidad), no solo con el texto
-- libre marca/modelo/medida. Permite abrir la ficha técnica completa
-- (con etiqueta europea) desde la lista de Productos del almacén.
-- ============================================================

alter table productos_neumaticos
  add column if not exists referencia_neumatico_id uuid references tc_referencias_neumatico(id) on delete set null;

create index if not exists idx_productos_neumaticos_referencia on productos_neumaticos (referencia_neumatico_id);
