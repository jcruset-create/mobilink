-- Añade campos del conductor a roadside_assistances para firma digital
ALTER TABLE roadside_assistances ADD COLUMN IF NOT EXISTS "conductorNombre" TEXT DEFAULT NULL;
ALTER TABLE roadside_assistances ADD COLUMN IF NOT EXISTS "conductorDni" TEXT DEFAULT NULL;
ALTER TABLE roadside_assistances ADD COLUMN IF NOT EXISTS "inicioReparacionAtMs" BIGINT DEFAULT NULL;
