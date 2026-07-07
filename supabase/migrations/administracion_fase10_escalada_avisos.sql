-- ============================================================
-- SEA Administración — Fase 10
-- Escalada completa de avisos de recobro por WhatsApp:
--   1) Recibo devuelto (con IBAN)
--   2) Recordatorio simple
--   3) Aviso previo de traslado a Crédito y Caución
--   4) Confirmación de traslado a Crédito y Caución
-- Añade los nuevos estados y el canal específico del aviso 1
-- (el aviso 2 reutiliza el canal 'whatsapp_deudor' ya existente).
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

alter table adm_notificaciones drop constraint if exists adm_notificaciones_canal_check;
alter table adm_notificaciones add constraint adm_notificaciones_canal_check
  check (canal in ('whatsapp_deudor','whatsapp_deudor_aviso1','email_deudor','whatsapp_interno','resumen_interno'));

alter table adm_recovery_cases drop constraint if exists adm_recovery_cases_status_check;
alter table adm_recovery_cases add constraint adm_recovery_cases_status_check
  check (status in ('pendiente','primer_aviso','segundo_aviso','llamada_realizada',
                     'compromiso_pago','pago_parcial','pago_recibido',
                     'aviso_credito_caucion','trasladado_credito_caucion','cerrado'));
