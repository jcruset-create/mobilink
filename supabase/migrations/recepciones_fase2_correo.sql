-- ============================================================
-- Mobilink Recepciones — fase 2: los correos del proveedor (Soledad).
--
-- Equivalente en código: server/recepciones/schema.ts (initRecepciones), que
-- es la fuente de verdad y se ejecuta en cada arranque. Este fichero es para
-- pegarlo en el SQL Editor de Supabase si hace falta prepararlo a mano.
-- Idempotente. Va después de recepciones_fase1.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS rcp_correos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  proveedor_id UUID REFERENCES rcp_proveedores(id) ON DELETE SET NULL,
  message_id TEXT NOT NULL,
  in_reply_to TEXT,
  hash_contenido TEXT,
  asunto TEXT NOT NULL DEFAULT '',
  remitente TEXT,
  fecha TIMESTAMPTZ,
  texto TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'DESCONOCIDO' CHECK (tipo IN ('PEDIDO','ALBARAN','DESCONOCIDO')),
  resultado TEXT NOT NULL DEFAULT 'RECIBIDO'
    CHECK (resultado IN ('RECIBIDO','PROCESADO','DUPLICADO','IGNORADO','PENDIENTE_REVISION','ERROR')),
  motivo TEXT,
  datos_extraidos JSONB,
  avisos TEXT[] NOT NULL DEFAULT '{}',
  pedido_id UUID REFERENCES rcp_pedidos(id) ON DELETE SET NULL,
  albaran_id UUID REFERENCES rcp_albaranes(id) ON DELETE SET NULL,
  origen TEXT NOT NULL DEFAULT 'buzon' CHECK (origen IN ('buzon','eml','api')),
  intentos INTEGER NOT NULL DEFAULT 0,
  procesado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, message_id)
);
CREATE INDEX IF NOT EXISTS rcp_correos_resultado_idx ON rcp_correos(empresa_id, resultado, created_at DESC);
CREATE INDEX IF NOT EXISTS rcp_correos_fecha_idx ON rcp_correos(empresa_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rcp_buzon_pasadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  iniciada_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminada_at TIMESTAMPTZ,
  correos INTEGER NOT NULL DEFAULT 0,
  procesados INTEGER NOT NULL DEFAULT 0,
  ignorados INTEGER NOT NULL DEFAULT 0,
  errores INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  detalle JSONB NOT NULL DEFAULT '[]',
  origen TEXT NOT NULL DEFAULT 'temporizador' CHECK (origen IN ('temporizador','manual','historico','eml'))
);
CREATE INDEX IF NOT EXISTS rcp_buzon_pasadas_idx ON rcp_buzon_pasadas(empresa_id, iniciada_at DESC);

CREATE TABLE IF NOT EXISTS rcp_config (
  empresa_id UUID NOT NULL,
  clave TEXT NOT NULL,
  valor TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, clave)
);

ALTER TABLE rcp_pedidos ADD COLUMN IF NOT EXISTS destino_texto TEXT;
ALTER TABLE rcp_pedidos ADD COLUMN IF NOT EXISTS cliente_proveedor TEXT;
