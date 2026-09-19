-- Recepciones · el PDF adjunto se guarda con su correo
--
-- Gemelo de `initRecepciones()` en server/recepciones/schema.ts, que ya lo
-- aplica solo al arrancar. Esto es para pegarlo en el SQL Editor de Supabase
-- si se quiere adelantar.
--
-- Hay proveedores (INSA TURBO) que no cuentan nada en el cuerpo del correo y
-- mandan la entrega en el PDF adjunto. Si ese correo queda en revisión, el
-- adjunto tiene que sobrevivir: sin esto, «Reprocesar» vuelve a mirar un
-- correo vacío y falla igual.

ALTER TABLE rcp_documentos ADD COLUMN IF NOT EXISTS correo_id UUID;
CREATE INDEX IF NOT EXISTS rcp_documentos_correo_idx ON rcp_documentos(correo_id);
