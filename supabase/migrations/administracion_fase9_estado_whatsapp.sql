-- ============================================================
-- SEA Administración — Fase 9
-- Estado de entrega de los WhatsApp de recobros (enviado /
-- entregado / leído) vía callbacks de Twilio.
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

alter table adm_notificaciones add column if not exists twilio_sid text;
alter table adm_notificaciones add column if not exists twilio_status text;

create index if not exists idx_adm_notif_twilio_sid on adm_notificaciones (twilio_sid);
