/**
 * Correo del expediente: hilo de mensajes y control de recordatorios.
 *
 * Dos tablas y una razón para cada una.
 *
 * `assistance_messages` guarda el hilo. Existe aunque ya hubiera
 * `connect_communications` porque aquélla es de Central, guarda un texto suelto
 * y no tiene dónde poner un Message-ID: sin él no se puede enganchar una
 * respuesta cuyo remitente ha reescrito el asunto, que es la mitad de los casos.
 *
 * `assistance_reminders` lleva la cuenta de lo que ya se ha pedido. Es lo que
 * impide el fallo que más molesta a un taller: recibir por cuarta vez la
 * petición de un albarán que mandó el martes.
 */

import db from "../db.ts";

export async function initCorreo(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS assistance_messages (
      id BIGSERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,

      -- La misma terna que el diario y los documentos.
      "sourceSystem" TEXT NOT NULL,
      "tenantId" TEXT,
      "assistanceId" TEXT,               -- NULL: entrante sin clasificar
      "correlationId" TEXT,

      direccion TEXT NOT NULL,           -- saliente | entrante
      motivo TEXT,                       -- solicitud_albaran, recordatorio_factura…

      "fromAddr" TEXT,
      "toAddr" TEXT,
      asunto TEXT,
      cuerpo TEXT,

      /*
       * El identificador del mensaje y a cuáles responde. Son las cabeceras que
       * permiten reconocer una respuesta aunque el asunto venga reescrito.
       */
      "messageId" TEXT,
      "inReplyTo" TEXT,
      referencias TEXT NOT NULL DEFAULT '[]',

      "adjuntos" INTEGER NOT NULL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'enviado',   -- enviado | fallido | recibido
      error TEXT,

      "occurredAtMs" BIGINT NOT NULL,
      "createdAtMs" BIGINT NOT NULL
    );

    -- El hilo de una asistencia, en orden.
    CREATE INDEX IF NOT EXISTS idx_mensajes_asistencia
      ON assistance_messages ("sourceSystem", "assistanceId", "occurredAtMs");
    -- El enganche por cabecera: se busca por el Message-ID de los salientes.
    CREATE INDEX IF NOT EXISTS idx_mensajes_messageid
      ON assistance_messages ("messageId");
    -- La bandeja de sin clasificar.
    CREATE INDEX IF NOT EXISTS idx_mensajes_sin_clasificar
      ON assistance_messages (direccion, "occurredAtMs" DESC)
      WHERE "assistanceId" IS NULL;

    /*
     * Un correo entrante no se procesa dos veces. El buzón se lee cada pocos
     * minutos y un reinicio a mitad de tanda haría releer los mismos mensajes.
     */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mensajes_entrante_unico
      ON assistance_messages ("messageId")
      WHERE direccion = 'entrante' AND "messageId" IS NOT NULL;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS assistance_reminders (
      id BIGSERIAL PRIMARY KEY,
      "sourceSystem" TEXT NOT NULL,
      "tenantId" TEXT,
      "assistanceId" TEXT NOT NULL,
      motivo TEXT NOT NULL,              -- albaran | factura

      intentos INTEGER NOT NULL DEFAULT 0,
      "ultimoEnvioMs" BIGINT,
      "proximoEnvioMs" BIGINT,
      "resueltoAtMs" BIGINT,             -- llegó lo que se pedía
      "destinatario" TEXT,
      "ultimoError" TEXT,

      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,

      /*
       * Una fila por asistencia y motivo. Es la garantía contra el recordatorio
       * duplicado, y tiene que estar en la base: dos pasadas del worker a la vez
       * pasarían las dos por un «¿ya se mandó?».
       */
      UNIQUE ("sourceSystem", "assistanceId", motivo)
    );

    -- Por aquí entra el worker: lo pendiente cuya espera ya venció.
    CREATE INDEX IF NOT EXISTS idx_recordatorios_pendientes
      ON assistance_reminders ("proximoEnvioMs")
      WHERE "resueltoAtMs" IS NULL;
  `);
}
