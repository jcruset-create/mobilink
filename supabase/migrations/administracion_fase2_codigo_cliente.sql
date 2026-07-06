-- ============================================================
-- SEA Administración — Fase 2
-- Añade el número de cliente (código de la gestión, ej. 100506).
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

alter table adm_customers add column if not exists customer_code text;

create index if not exists idx_adm_customers_code on adm_customers (customer_code);
