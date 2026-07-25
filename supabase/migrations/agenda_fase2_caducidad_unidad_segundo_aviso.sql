-- Agenda · Fase 2 recordatorios de caducidad:
-- nº de unidad, fecha de aviso ajustada a día laborable y segundo aviso a 7 días.
-- (initDb() del servidor aplica estos mismos cambios de forma idempotente.)

ALTER TABLE recordatorios_caducidad
  ADD COLUMN IF NOT EXISTS unidad TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS dias_antelacion2 INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS fecha_aviso2 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS whatsapp2_estado TEXT NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS sms2_estado TEXT NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS whatsapp2_sid TEXT,
  ADD COLUMN IF NOT EXISTS sms2_sid TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp2_enviado_en_ms BIGINT,
  ADD COLUMN IF NOT EXISTS sms2_enviado_en_ms BIGINT;
