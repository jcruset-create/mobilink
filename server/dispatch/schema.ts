/**
 * Envíos entre sistemas: destinos y despachos.
 *
 * Genérico a propósito. No hay ni una columna que diga «Assist» ni «Central»:
 * el origen y el destino son datos, no estructura. Con eso la misma tabla vale
 * para Assist → Central A, Assist → Central B, Central A → Central B o Central
 * → una plataforma externa, que es justo lo que va a hacer falta.
 *
 * Vive en su propio módulo, fuera de `connect/` y de `db.ts`, porque no es de
 * ninguno de los dos: es el cable entre ellos.
 */

import db from "../db.ts";

export async function initDispatch(): Promise<void> {
  await db.query(`
    /*
     * A dónde se puede enviar. Una fila por plataforma de destino.
     *
     * OJO CON LAS CREDENCIALES: aquí NO se guarda ninguna clave. Solo el
     * NOMBRE del secreto, que se resuelve en el servidor contra las variables
     * de entorno, igual que hace el Integration Hub con los conectores de ERP.
     * Es la convención que ya existe y se respeta: una clave en una fila que
     * el panel pueda pedir acaba, tarde o temprano, en el navegador.
     */
    CREATE TABLE IF NOT EXISTS external_destinations (
      id SERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'central',   -- central | external
      "baseUrl" TEXT NOT NULL,
      "secretName" TEXT NOT NULL,
      -- Etiqueta informativa de la plataforma de destino. NO se usa para
      -- decidir nada: el tenant real lo decide la credencial en el destino,
      -- que es el único sitio donde esa decisión no se puede falsear.
      "destinationTenantLabel" TEXT,
      "ownerTenantId" TEXT,                   -- taller de Assist dueño; NULL = todos
      active BOOLEAN NOT NULL DEFAULT true,
      notes TEXT,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_external_destinations_owner
      ON external_destinations ("ownerTenantId", active);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS external_dispatches (
      id SERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,

      -- Origen
      "sourceSystem" TEXT NOT NULL,           -- assist | central
      "sourceTenantId" TEXT,
      "sourceAssistanceId" TEXT NOT NULL,
      "sourceReference" TEXT,                 -- expediente del origen

      -- Destino
      "destinationId" INTEGER NOT NULL REFERENCES external_destinations(id),
      "destinationSystem" TEXT NOT NULL DEFAULT 'central',
      "destinationTenantId" TEXT,
      "destinationCompanyId" INTEGER,
      "externalAssistanceId" TEXT,
      "externalReference" TEXT,               -- expediente del destino

      -- El hilo que ata las dos mitades de principio a fin
      "correlationId" TEXT NOT NULL,

      status TEXT NOT NULL DEFAULT 'PENDING',
      "lastEvent" TEXT,                       -- último evento estándar recibido

      "sentAtMs" BIGINT,
      "receivedAtMs" BIGINT,
      "acceptedAtMs" BIGINT,
      "rejectedAtMs" BIGINT,
      "completedAtMs" BIGINT,
      "lastSyncAtMs" BIGINT,
      "lastAttemptAtMs" BIGINT,

      "lastError" TEXT,
      "retryCount" INTEGER NOT NULL DEFAULT 0,
      "payloadSnapshot" TEXT,
      "responseSnapshot" TEXT,

      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,

      /*
       * Una asistencia no se puede enviar dos veces al mismo destino. Es la
       * primera de las dos cerraduras contra el duplicado: ésta impide que
       * salga dos veces de aquí, y la clave de idempotencia impide que el
       * destino la cree dos veces si sale igualmente.
       */
      UNIQUE ("sourceSystem", "sourceTenantId", "sourceAssistanceId", "destinationId")
    );

    CREATE INDEX IF NOT EXISTS idx_dispatches_origen
      ON external_dispatches ("sourceSystem", "sourceAssistanceId");
    CREATE INDEX IF NOT EXISTS idx_dispatches_correlacion
      ON external_dispatches ("correlationId");
    -- El worker de reintentos entra por aquí.
    CREATE INDEX IF NOT EXISTS idx_dispatches_pendientes
      ON external_dispatches (status, "lastAttemptAtMs");
  `);

  /*
   * El UNIQUE de arriba lleva "sourceTenantId", que puede ser NULL, y en
   * PostgreSQL dos NULL no chocan: sin esto, una asistencia sin taller
   * asignado podría enviarse dos veces al mismo sitio.
   */
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatches_unico_sin_tenant
      ON external_dispatches ("sourceSystem", "sourceAssistanceId", "destinationId")
      WHERE "sourceTenantId" IS NULL;
  `);

  /*
   * Historial de eventos del envío. Append-only: es lo que permite contestar
   * «¿cuándo dijo Central que iba de camino?» tres meses después, cuando el
   * estado actual ya no lo dice.
   */
  await db.query(`
    CREATE TABLE IF NOT EXISTS external_dispatch_events (
      id SERIAL PRIMARY KEY,
      "dispatchId" INTEGER NOT NULL REFERENCES external_dispatches(id) ON DELETE CASCADE,
      event TEXT NOT NULL,                    -- evento estándar
      "remoteStatus" TEXT,                    -- cómo lo llamaba el sistema remoto
      direction TEXT NOT NULL DEFAULT 'in',   -- in | out
      detail TEXT,
      "occurredAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dispatch_events_despacho
      ON external_dispatch_events ("dispatchId", id);
  `);

  /*
   * En la asistencia de Assist se deja solo el rastro mínimo para poder
   * pintar la ficha sin cruzar tablas en cada listado. La verdad del envío
   * está en external_dispatches; esto es una copia de conveniencia.
   */
  await db.query(`
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "despachoExternoId" INTEGER;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "expedienteDestino" TEXT;
  `);
}
