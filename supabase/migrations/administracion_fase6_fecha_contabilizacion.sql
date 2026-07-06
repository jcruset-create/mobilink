-- ============================================================
-- SEA Administración — Fase 6
-- Fecha de contabilización de la devolución en los expedientes
-- de recobro (distinta de la fecha de la factura).
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

alter table adm_recovery_cases add column if not exists accounting_date date;
