-- ============================================================
-- SEA TyreControl — Fase 31: más detalle del tipo de llanta
--   · material (aluminio/hierro), medida (ya existían)
--   · número de agujeros, centrada/desplazada, tapacubo sí/no
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

alter table tc_tipos_llanta
  add column if not exists agujeros int,
  add column if not exists centrado text,       -- 'centrada' | 'desplazada'
  add column if not exists tapacubo boolean not null default false;

alter table tc_tipos_llanta drop constraint if exists chk_llanta_centrado;
alter table tc_tipos_llanta add constraint chk_llanta_centrado
  check (centrado is null or centrado in ('centrada','desplazada'));

-- La combinación material+medida ya no es única (puede haber variantes
-- por agujeros/offset/tapacubo). Se elimina esa restricción.
alter table tc_tipos_llanta drop constraint if exists tc_tipos_llanta_material_medida_key;
