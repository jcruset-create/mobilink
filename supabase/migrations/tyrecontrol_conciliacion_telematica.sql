-- ============================================================
-- TyreControl — un vehículo puede nacer de la conciliación telemática
--
-- La conciliación con un proveedor de telemática (Movertis, Webfleet…) puede
-- encontrar vehículos que están en la plataforma y no en TyreControl. Cuando
-- una persona decide traerlos, el vehículo nace igual que el que se da de alta
-- desde la tablet: PENDIENTE DE VALIDAR y con su procedencia apuntada, para
-- que un administrador le complete marca, modelo, tipo y configuración de ejes
-- desde la pantalla de validación que ya existe.
--
-- ── Por qué 'telematica' y no 'movertis' ────────────────────────────────────
--
-- Porque la conciliación es genérica y el proveedor es un detalle. Con
-- 'movertis' habría que ampliar este CHECK cada vez que se añada uno, y la
-- columna acabaría contando dos cosas distintas: de dónde vino el vehículo y
-- de qué plataforma. De qué cuenta y qué proveedor lo trajeron ya queda escrito
-- en `integration_mappings`, que es su sitio.
--
-- Cambio ADITIVO: solo amplía los valores admitidos. Nada de lo que ya hay en
-- la tabla los viola, y ninguna fila se toca.
-- Idempotente: reejecutable sin efectos secundarios.
-- ============================================================

alter table tc_vehiculos drop constraint if exists chk_veh_creado_desde;
alter table tc_vehiculos add constraint chk_veh_creado_desde
  check (creado_desde is null or creado_desde in ('panel','tablet','importacion','telematica'));

comment on column tc_vehiculos.creado_desde is
  'De dónde salió el alta: panel | tablet | importacion | telematica. '
  'Con «telematica», el vehículo lo trajo la pantalla de conciliación desde '
  'un proveedor externo y nació pendiente de validar; el proveedor y la cuenta '
  'concretos están en integration_mappings.';

-- Comprobación: nada existente se queda fuera del CHECK nuevo.
--   select distinct creado_desde from tc_vehiculos;
