-- ============================================================
-- SEA Administración — Fase 4
-- Desglose del recibo devuelto en los expedientes de recobro:
-- nominal, gastos de devolución, total y nº de vencimiento
-- (para facturas partidas en varios vencimientos).
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

alter table adm_recovery_cases add column if not exists nominal_amount numeric(12,2);
alter table adm_recovery_cases add column if not exists return_expenses numeric(12,2);
alter table adm_recovery_cases add column if not exists installment_number text;
