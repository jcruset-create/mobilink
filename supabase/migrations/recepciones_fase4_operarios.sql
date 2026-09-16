-- Recepciones · el operario que cuenta firma con su PIN
--
-- Gemelo de `initRecepciones()` en server/recepciones/schema.ts, que ya lo
-- aplica solo al arrancar. Esto es para pegarlo en el SQL Editor de Supabase
-- si se quiere adelantar.
--
-- Quien cuenta la mercancía casi nunca es quien tiene la sesión abierta: el
-- tablet del muelle lo abre un encargado y por él pasan cinco personas. El
-- padrón de operarios y su PIN son lo que firma la recepción; la sesión se
-- sigue guardando aparte, en `recibido_por`.

CREATE TABLE IF NOT EXISTS rcp_operarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  centro_id UUID,
  nombre TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  creado_por UUID,
  creado_nombre TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre)
);
CREATE INDEX IF NOT EXISTS rcp_operarios_centro_idx ON rcp_operarios(empresa_id, centro_id) WHERE activo;

ALTER TABLE rcp_recepciones ADD COLUMN IF NOT EXISTS operario_id UUID;
ALTER TABLE rcp_recepciones ADD COLUMN IF NOT EXISTS operario_nombre TEXT;
