-- Recepciones · el móvil de las observaciones del albarán
--
-- Gemelo de `initRecepciones()` en server/recepciones/schema.ts, que ya lo
-- aplica solo al arrancar. Esto es para pegarlo en el SQL Editor de Supabase
-- si se quiere adelantar.
--
-- El albarán del proveedor trae, tras la línea de gestión de NFU, para quién
-- viene la mercancía: «TALLER», «JORGE PLANA» o «PEDRO 610473077». Cuando esa
-- observación lleva un móvil, el número se guarda en su propia columna: en
-- medio de una frase no sirve para avisar a nadie, y aparte sí.

ALTER TABLE rcp_albaranes ADD COLUMN IF NOT EXISTS telefono_contacto TEXT;
