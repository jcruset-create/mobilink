-- Recepción rápida de vehículos desde la APK del taller.
-- Equivalente al bloque de server/db.ts: la aplicación lo crea sola al
-- arrancar, pero aquí queda el SQL para poder aplicarlo a mano.

CREATE TABLE IF NOT EXISTS recepciones_vehiculo (
      id BIGINT PRIMARY KEY,
      "workshopId" TEXT,
      -- Como la confirmó la persona, con guiones si los escribió así.
      matricula TEXT NOT NULL,
      -- Normalizada (mayúsculas y alfanuméricos), que es por lo que se busca.
      "matriculaNormal" TEXT NOT NULL,
      -- Lo que leyó la IA, sin tocar, y con cuánta confianza. Se guardan para
      -- poder medir después si el OCR merece la pena; nunca se usan como dato
      -- bueno sin que alguien los haya confirmado.
      "matriculaOcr" TEXT,
      "confianzaOcr" DOUBLE PRECISION,
      "clienteNombre" TEXT,
      "vehiculoId" TEXT,
      "vehiculoOrigen" TEXT,
      area TEXT,
      "plantillaKey" TEXT,
      "operacionLabel" TEXT,
      notas TEXT,
      urgente BOOLEAN NOT NULL DEFAULT FALSE,
      fotos JSONB NOT NULL DEFAULT '[]'::jsonb,
      -- pendiente | convertida | descartada
      estado TEXT NOT NULL DEFAULT 'pendiente',
      "operarioNombre" TEXT NOT NULL,
      "creadaAtMs" BIGINT NOT NULL,
      "resueltaAtMs" BIGINT,
      "resueltaPor" TEXT,
      "motivoDescarte" TEXT,
      "jobId" BIGINT,
      -- Borrado lógico, como en jobs.
      "deletedAtMs" BIGINT
    );

    CREATE INDEX IF NOT EXISTS recepciones_vehiculo_estado_idx
      ON recepciones_vehiculo(estado, "creadaAtMs" DESC);
    CREATE INDEX IF NOT EXISTS recepciones_vehiculo_matricula_idx
      ON recepciones_vehiculo("matriculaNormal");
    CREATE INDEX IF NOT EXISTS recepciones_vehiculo_workshop_idx
      ON recepciones_vehiculo("workshopId");

    -- El camino de vuelta: desde el trabajo, a la recepción y sus fotos.
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS "recepcionId" BIGINT DEFAULT NULL;

-- Cuentakilómetros al entrar, añadido después de la primera entrega.
ALTER TABLE recepciones_vehiculo
  ADD COLUMN IF NOT EXISTS kilometros INTEGER DEFAULT NULL;
ALTER TABLE recepciones_vehiculo
  ADD COLUMN IF NOT EXISTS "kilometrosOcr" INTEGER DEFAULT NULL;
ALTER TABLE recepciones_vehiculo
  ADD COLUMN IF NOT EXISTS "confianzaKilometrosOcr" DOUBLE PRECISION DEFAULT NULL;

-- Enlace con la cita de la agenda de la que salió la recepción.
ALTER TABLE recepciones_vehiculo
  ADD COLUMN IF NOT EXISTS "scheduledJobId" BIGINT DEFAULT NULL;

-- Teléfono del cliente, apuntado en el patio.
ALTER TABLE recepciones_vehiculo
  ADD COLUMN IF NOT EXISTS "clienteTelefono" TEXT DEFAULT NULL;
