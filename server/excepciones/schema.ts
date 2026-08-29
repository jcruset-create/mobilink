/**
 * Costes de la asistencia en Assist, y la aprobación de las desviaciones.
 *
 * Central ya tenía todo esto en `connect_assistance_pricings`, con compra,
 * venta y margen en NUMERIC y su motor de tarifas detrás. Assist no tenía
 * ninguno: los importes vivían en la cabeza de quien facturaba.
 *
 * Aquí se añaden los cuatro a la propia asistencia y no en una tabla aparte,
 * porque en Assist son cuatro números por servicio, no un cálculo con reglas y
 * versiones. El día que Assist tenga tarifario, esto se moverá a su sitio.
 *
 * NUMERIC, nunca coma flotante: `0.1 + 0.2` no es `0.3` y en una factura eso
 * se ve. Es la misma regla que ya sigue el motor de Central.
 */

import db from "../db.ts";

export async function initExcepciones(): Promise<void> {
  await db.query(`
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "costePrevisto" NUMERIC(14,4);
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "costeAcordado" NUMERIC(14,4);
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "costeFinal" NUMERIC(14,4);
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "importeVenta" NUMERIC(14,4);
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'EUR';

    /*
     * La aprobación de una desviación es una decisión con nombre y fecha: es lo
     * que se mira cuando alguien pregunta quién autorizó pagar 200 € de más.
     */
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "desviacionAprobadaAtMs" BIGINT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "desviacionAprobadaPor" TEXT;

    -- Referencias que pide el cliente para poder pagar. Sin ellas, la factura
    -- vuelve rechazada y el servicio ya está hecho.
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "pedidoCliente" TEXT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "centroCoste" TEXT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "referenciaFactura" TEXT;

    /*
     * Lo que la plataforma externa dice que nos va a facturar. Es SU precio de
     * venta, que para nosotros es coste; llega por la integración y no se
     * calcula aquí.
     */
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "importeDestino" NUMERIC(14,4);
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "conceptoDestino" TEXT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "impuestosDestino" NUMERIC(14,4);
  `);

  // La bandeja entra por aquí: lo finalizado sin cerrar administrativamente.
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_roadside_bandeja
      ON roadside_assistances (status, "estadoAdmin");
  `);
}
