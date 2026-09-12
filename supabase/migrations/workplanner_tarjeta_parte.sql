-- Lo que trae el parte de trabajo y hasta ahora se perdía.
--
-- El servidor las crea solas al arrancar (server/db.ts, ALTER TABLE ... IF NOT
-- EXISTS); este fichero es el equivalente para aplicarlo a mano en el SQL
-- editor de Supabase.
--
--  · includedTasks: el resto de servicios del parte, la mano de obra que va
--    dentro del mismo trabajo. Vivía SOLO en memoria del navegador, así que al
--    primer refresco desaparecía.
--  · materiales: lo que hay que montar. Solo sobrevivía como una frase suelta
--    dentro del motivo, ni consultable ni imputable.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS "includedTasks" JSONB DEFAULT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS materiales JSONB DEFAULT NULL;
