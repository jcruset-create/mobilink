/**
 * Reglas de enrutado y pesos por central.
 *
 * Los pesos van en `connect_control_centers` y no en tabla aparte: hay
 * exactamente un juego por central y una tabla con una fila por central es una
 * columna disfrazada.
 */

import db from "../db.ts";

export async function initEnrutado(): Promise<void> {
  await db.query(`
    ALTER TABLE connect_control_centers
      ADD COLUMN IF NOT EXISTS "routingWeights" TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE connect_control_centers
      ADD COLUMN IF NOT EXISTS "routingMode" TEXT NOT NULL DEFAULT 'suggest';
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS connect_routing_rules (
      id SERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      name TEXT NOT NULL,
      "sortOrder" INTEGER NOT NULL DEFAULT 100,
      active BOOLEAN NOT NULL DEFAULT true,
      condition TEXT NOT NULL DEFAULT '{}',
      action TEXT NOT NULL DEFAULT 'preferir',
      partners TEXT NOT NULL DEFAULT '[]',
      adjustment NUMERIC(6,2) NOT NULL DEFAULT 0,
      notes TEXT,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      "updatedByUserId" INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_reglas_centro
      ON connect_routing_rules ("controlCenterId", active, "sortOrder");
  `);

  /*
   * Cada decisión de enrutado se guarda: a quién se propuso, con qué puntos y
   * qué reglas dispararon. Es lo que permite contestar «por qué se mandó a
   * éste» tres semanas después, cuando ni los pesos ni las reglas ni las
   * métricas son ya las mismas. Sin esto, reproducir la decisión es imposible
   * por definición.
   */
  await db.query(`
    CREATE TABLE IF NOT EXISTS connect_routing_decisions (
      id SERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,
      "controlCenterId" INTEGER NOT NULL,
      "assistanceId" INTEGER,
      "correlationId" TEXT,
      context TEXT NOT NULL DEFAULT '{}',
      weights TEXT NOT NULL DEFAULT '{}',
      candidates TEXT NOT NULL DEFAULT '[]',
      "rulesApplied" TEXT NOT NULL DEFAULT '[]',
      "chosenAuthorizationId" INTEGER,
      "decidedBy" TEXT NOT NULL DEFAULT 'system',
      "createdAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decisiones_centro
      ON connect_routing_decisions ("controlCenterId", "createdAtMs" DESC);
    CREATE INDEX IF NOT EXISTS idx_decisiones_asistencia
      ON connect_routing_decisions ("assistanceId");
  `);
}
