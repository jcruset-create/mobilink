-- Recepciones · el aviso a recepción de que falta el PDF del albarán
--
-- Gemelo de `initRecepciones()` en server/recepciones/schema.ts, que ya lo
-- aplica solo al arrancar. Esto es para pegarlo en el SQL Editor de Supabase
-- si se quiere adelantar.
--
-- Hay dos clases de aviso: el que va a quien espera la mercancía cuando llega,
-- y el que va a recepción cuando un albarán entra sin su PDF. El segundo no
-- tiene recepción detrás, así que esa columna deja de ser obligatoria.

ALTER TABLE rcp_avisos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'MATERIAL_RECIBIDO';
ALTER TABLE rcp_avisos ALTER COLUMN recepcion_id DROP NOT NULL;
