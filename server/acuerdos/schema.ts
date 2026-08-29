/**
 * Columnas nuevas del acuerdo comercial, sobre la tabla que ya existía.
 *
 * Todo es `ADD COLUMN IF NOT EXISTS` con valor por defecto, así que un registro
 * antiguo sigue siendo válido sin tocarlo: sin zonas pactadas cubre todo, sin
 * horario es 24 h, sin límites no hay tope. Es la lectura correcta de un
 * acuerdo que se firmó cuando estos campos no existían — nadie acordó una
 * restricción que nadie escribió.
 */

import db from "../db.ts";

export async function initAcuerdos(): Promise<void> {
  await db.query(`
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS coverage TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS schedule TEXT NOT NULL DEFAULT '{"veinticuatroHoras":true}';
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR';
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS "quoteThreshold" NUMERIC(14,4);
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS "maxAmount" NUMERIC(14,4);
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS "quoteRequired" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS "requiredDocuments" TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS "cancelFreeMin" INTEGER;
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS "cancelFee" NUMERIC(14,4);
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS "cancelFeeIsPercent" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS "billingConfig" TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS "updatedByUserId" INTEGER;
  `);

  /*
   * El destino externo al que se despacha, si el partner es otra plataforma.
   * Va aquí y no en `external_destinations` porque quien tiene el acuerdo es
   * el centro: la misma plataforma destino puede estar pactada por dos centros
   * en condiciones distintas.
   */
  await db.query(`
    ALTER TABLE connect_provider_authorizations
      ADD COLUMN IF NOT EXISTS "destinationId" INTEGER;
    CREATE INDEX IF NOT EXISTS idx_auth_destino
      ON connect_provider_authorizations ("destinationId");
    CREATE INDEX IF NOT EXISTS idx_auth_centro_estado
      ON connect_provider_authorizations ("controlCenterId", status);
  `);

  /*
   * Presupuestos. Tabla propia y no columnas en la asistencia porque un
   * servicio puede pedir presupuesto a VARIOS partners antes de encargar, y
   * porque hay que conservar los que no se aceptaron: es lo que justifica la
   * elección cuando alguien la pregunta seis meses después.
   */
  await db.query(`
    CREATE TABLE IF NOT EXISTS connect_quotes (
      id SERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,
      "controlCenterId" INTEGER NOT NULL,
      "assistanceId" INTEGER NOT NULL,
      "authorizationId" INTEGER,
      "dispatchId" INTEGER,
      "correlationId" TEXT,
      status TEXT NOT NULL DEFAULT 'REQUESTED',
      amount NUMERIC(14,4),
      currency TEXT NOT NULL DEFAULT 'EUR',
      taxes NUMERIC(14,4),
      concept TEXT,
      "etaMin" INTEGER,
      "validUntilMs" BIGINT,
      "rejectReason" TEXT,
      "requestedAtMs" BIGINT NOT NULL,
      "quotedAtMs" BIGINT,
      "decidedAtMs" BIGINT,
      "decidedByUserId" INTEGER,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_quotes_asistencia
      ON connect_quotes ("controlCenterId", "assistanceId");
    CREATE INDEX IF NOT EXISTS idx_quotes_correlacion
      ON connect_quotes ("correlationId");
  `);

  /*
   * Un presupuesto por partner y asistencia: si el mismo partner contesta dos
   * veces es una corrección de su oferta, no una segunda oferta. Parcial
   * porque los presupuestos sin acuerdo (partner puntual) no se agrupan.
   */
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_unico
      ON connect_quotes ("assistanceId", "authorizationId")
      WHERE "authorizationId" IS NOT NULL
  `).catch((e) => {
    console.warn("[Acuerdos] índice único de presupuestos no creado:", (e as any)?.message);
  });
}
