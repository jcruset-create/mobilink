-- Agenda · Fase 1: recordatorios de caducidad de tacógrafo
-- Nota: el servidor también crea esta tabla de forma idempotente en initDb()
-- (server/db.ts). Esta migración documenta el esquema y sirve para crearla
-- a mano en el SQL editor de Supabase si se prefiere.
--
-- Fechas en TEXT 'YYYY-MM-DD' (convención del resto de la agenda:
-- agenda_date_reminders, scheduled_tech_statuses). Comparación lexicográfica válida.
--
-- Estados generales: PENDIENTE, LISTO_PARA_AVISAR (calculado, no persistido),
-- AVISADO, RESPONDIDO, CONVERTIDO_EN_CITA, CADUCADO, CANCELADO, ERROR_ENVIO.
-- Estados por canal: pendiente, enviado, entregado, leido, error, omitido.

CREATE TABLE IF NOT EXISTS recordatorios_caducidad (
  id BIGSERIAL PRIMARY KEY,
  "workshopId" TEXT,
  cliente_nombre TEXT NOT NULL DEFAULT '',
  vehiculo TEXT NOT NULL DEFAULT '',
  matricula TEXT NOT NULL DEFAULT '',
  telefono TEXT NOT NULL DEFAULT '',

  tipo_caducidad TEXT NOT NULL DEFAULT 'tacografo',
  fecha_caducidad TEXT NOT NULL,
  dias_antelacion INTEGER NOT NULL DEFAULT 15,
  fecha_aviso TEXT NOT NULL,

  enviar_whatsapp BOOLEAN NOT NULL DEFAULT true,
  enviar_sms BOOLEAN NOT NULL DEFAULT true,

  estado TEXT NOT NULL DEFAULT 'PENDIENTE',
  whatsapp_estado TEXT NOT NULL DEFAULT 'pendiente',
  sms_estado TEXT NOT NULL DEFAULT 'pendiente',

  whatsapp_sid TEXT,
  sms_sid TEXT,
  whatsapp_enviado_en_ms BIGINT,
  sms_enviado_en_ms BIGINT,
  ultimo_error TEXT,

  cita_id BIGINT,
  observaciones TEXT NOT NULL DEFAULT '',

  creado_en_ms BIGINT NOT NULL,
  actualizado_en_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS recordatorios_caducidad_estado_idx
  ON recordatorios_caducidad(estado);
CREATE INDEX IF NOT EXISTS recordatorios_caducidad_fecha_aviso_idx
  ON recordatorios_caducidad(fecha_aviso);
CREATE INDEX IF NOT EXISTS recordatorios_caducidad_matricula_idx
  ON recordatorios_caducidad(matricula);

-- Evita duplicados activos para el mismo vehículo + tipo + fecha de caducidad.
CREATE UNIQUE INDEX IF NOT EXISTS recordatorios_caducidad_unico_idx
  ON recordatorios_caducidad(matricula, tipo_caducidad, fecha_caducidad)
  WHERE estado NOT IN ('CANCELADO', 'CADUCADO');
