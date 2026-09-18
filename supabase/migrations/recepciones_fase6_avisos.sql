-- Recepciones · el aviso por WhatsApp al recibir la mercancía
--
-- Gemelo de `initRecepciones()` en server/recepciones/schema.ts, que ya lo
-- aplica solo al arrancar. Esto es para pegarlo en el SQL Editor de Supabase
-- si se quiere adelantar.
--
-- Al cerrar una recepción OK se avisa por WhatsApp a quien figura en las
-- observaciones del albarán, si dejó su móvil. Cada intento deja fila: a
-- quién, cuándo, con qué resultado y por qué no, si no salió.

CREATE TABLE IF NOT EXISTS rcp_avisos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  recepcion_id UUID NOT NULL REFERENCES rcp_recepciones(id) ON DELETE CASCADE,
  albaran_id UUID NOT NULL REFERENCES rcp_albaranes(id),
  canal TEXT NOT NULL DEFAULT 'WHATSAPP' CHECK (canal IN ('WHATSAPP')),
  destinatario TEXT,
  telefono TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('ENVIADO','OMITIDO','ERROR')),
  motivo TEXT,
  referencia_externa TEXT,
  creado_por UUID,
  creado_nombre TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rcp_avisos_recepcion_idx ON rcp_avisos(recepcion_id);
CREATE INDEX IF NOT EXISTS rcp_avisos_fecha_idx ON rcp_avisos(empresa_id, created_at DESC);
