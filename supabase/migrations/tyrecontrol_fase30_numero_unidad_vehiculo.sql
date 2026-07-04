-- ============================================================
-- SEA TyreControl — Fase 30: número de unidad de flota en el
-- vehículo (opcional, distinto de la matrícula), para poder
-- identificarlo/buscarlo como lo hace la propia empresa
-- internamente (ej. matrícula 1234ABC, unidad 1025).
-- ============================================================

alter table tc_vehiculos add column if not exists numero_unidad text;
create index if not exists idx_tc_vehiculos_numero_unidad on tc_vehiculos (numero_unidad);
