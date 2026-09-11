-- Partes de trabajo: correspondencias de artículo y campos nuevos del trabajo.
--
-- El servidor las crea solo al arrancar (server/db.ts, CREATE TABLE / ALTER
-- TABLE IF NOT EXISTS); este fichero es el equivalente para aplicarlo a mano en
-- el SQL editor de Supabase.

-- Qué es cada artículo del parte: una entrada rápida del taller o material.
-- "templateKey" = '__material__' marca el material, que no genera tarea.
CREATE TABLE IF NOT EXISTS erp_articulo_plantilla (
  id            SERIAL PRIMARY KEY,
  "workshopId"  TEXT NOT NULL DEFAULT '',
  clave         TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  descripcion   TEXT NOT NULL DEFAULT '',
  "createdAtMs" BIGINT NOT NULL,
  "updatedAtMs" BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS erp_articulo_plantilla_unica
  ON erp_articulo_plantilla ("workshopId", clave);

-- Enlace del trabajo con el parte del que salió, y cantidad y minutos por
-- unidad, que hasta ahora vivían solo en memoria del navegador.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS "ptNumero" TEXT DEFAULT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS "unitMinutes" INTEGER DEFAULT NULL;
