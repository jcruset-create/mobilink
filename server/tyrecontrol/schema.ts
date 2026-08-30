/**
 * Lo que Assist necesita guardar para sincronizar una reparación.
 *
 * Son columnas en `roadside_assistances` y no una tabla aparte porque describen
 * ESA asistencia: qué operación fue y sobre qué rueda. Una tabla con una fila
 * por asistencia es una columna con pasos de más.
 *
 * Todas admiten nulo: una asistencia que no toca neumáticos —la mayoría— las
 * deja vacías y no cambia nada para ella.
 */

import db from "../db.ts";

export async function initTyreControlAssist(): Promise<void> {
  await db.query(`
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "tcOperacion" TEXT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "tcTipoReparacion" TEXT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "tcResultadoReparacion" TEXT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "tcPosicionCodigo" TEXT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "tcNeumaticoId" TEXT;
  `);

  /*
   * El resultado de la sincronización, para que la oficina lo vea sin cruzar
   * tablas en cada listado. La verdad está en `integration_operations`; esto es
   * una copia de conveniencia, como el rastro del despacho externo.
   */
  await db.query(`
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "tcSyncEstado" TEXT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "tcSyncMotivo" TEXT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "tcSyncAtMs" BIGINT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "tcOperacionTcId" TEXT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "tcIncidenciaId" TEXT;
  `);
}
