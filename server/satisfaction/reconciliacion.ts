/**
 * Qué hacer con un intento del que no se supo la respuesta.
 *
 * Si la petición sale y la conexión muere antes de que vuelva nada, hay dos
 * mundos posibles: Twilio la aceptó y el WhatsApp está en camino, o no llegó a
 * registrarla. Asumir lo segundo y reenviar es lo cómodo, y es exactamente lo
 * que no se puede hacer: en la mitad de los casos el destinatario recibiría dos
 * mensajes iguales.
 *
 * ── Cómo se sale de la duda ─────────────────────────────────────────────────
 *
 * Preguntándole al proveedor. La API de Twilio permite listar los mensajes
 * enviados a un número a partir de una fecha, y con eso se puede ver si el
 * intento llegó a registrarse. No es una clave de idempotencia —Twilio no
 * ofrece una para esto— pero sí es información real del proveedor y no una
 * conjetura: se busca por destinatario y ventana de tiempo, que es lo que hay.
 *
 * ── Y si no se puede preguntar ──────────────────────────────────────────────
 *
 * El intento se queda `UNKNOWN` y se vuelve a mirar en la siguiente pasada. NO
 * se reenvía por si acaso. La regla de la casa para este caso es explícita:
 * antes una encuesta sin mandar que un WhatsApp duplicado.
 */

import pool from "../db.ts";
import { aE164, clienteTwilio, hayCredencialesTwilio } from "../core/twilio.ts";

/**
 * Cuánto se espera antes de intentar aclararlo.
 *
 * Un minuto. Lo justo para que el mensaje aparezca en la API de Twilio si
 * llegó a registrarse, sin dejar la encuesta parada un cuarto de hora.
 */
export const ESPERA_RECONCILIACION_MS = 60_000;

/** Cómo se pregunta. Inyectable para poder probarlo sin salir a la red. */
export type Buscador = (p: {
  telefono: string; desdeMs: number;
}) => Promise<{ sid: string; status: string }[]>;

export const buscadorTwilio: Buscador = async ({ telefono, desdeMs }) => {
  const mensajes = await clienteTwilio().messages.list({
    to: `whatsapp:${aE164(telefono)}`,
    dateSentAfter: new Date(desdeMs),
    limit: 20,
  });
  return mensajes.map((m) => ({ sid: String(m.sid), status: String(m.status ?? "") }));
};

export type ResultadoReconciliacion =
  | { estado: "confirmado"; deliveryId: number; sid: string }
  | { estado: "no_se_mando"; deliveryId: number }
  | { estado: "sigue_en_duda"; deliveryId: number; motivo: string };

/**
 * Resuelve los intentos ambiguos que ya han tenido tiempo de aparecer.
 *
 * Si el mensaje está en Twilio, se adopta su SID y la entrega pasa a lo que
 * diga el proveedor: a partir de ahí el callback hace el resto. Si no está, el
 * intento se da por no enviado y la encuesta vuelve a la cola —esta vez sí, sin
 * riesgo de duplicar, porque se ha comprobado que no salió—.
 */
export async function reconciliarAmbiguos(
  buscador: Buscador = buscadorTwilio, ahoraMs = Date.now(), tope = 10,
): Promise<ResultadoReconciliacion[]> {
  const pendientes = await pool.query(
    `SELECT d.id, d."surveyInstanceId", d.recipient, d."unknownAtMs", d."messageType",
            i.status AS "estadoEncuesta", i."expiresAtMs"
       FROM survey_deliveries d
       JOIN survey_instances i ON i.id = d."surveyInstanceId"
      WHERE d.status = 'UNKNOWN'
        AND d."providerMessageId" IS NULL
        AND d."unknownAtMs" IS NOT NULL
        AND d."unknownAtMs" <= $1
      ORDER BY d."unknownAtMs"
      LIMIT $2`,
    [ahoraMs - ESPERA_RECONCILIACION_MS, tope],
  );

  const salida: ResultadoReconciliacion[] = [];
  for (const d of pendientes.rows) {
    const deliveryId = Number(d.id);
    const telefono = String(d.recipient ?? "");
    if (!telefono) {
      salida.push({ estado: "sigue_en_duda", deliveryId, motivo: "sin_destinatario" });
      continue;
    }
    if (!hayCredencialesTwilio()) {
      salida.push({ estado: "sigue_en_duda", deliveryId, motivo: "no_twilio_credentials" });
      continue;
    }

    let encontrados: { sid: string; status: string }[];
    try {
      // Se busca desde un poco antes del intento: los relojes no van a la par.
      encontrados = await buscador({ telefono, desdeMs: Number(d.unknownAtMs) - 120_000 });
    } catch (e: unknown) {
      salida.push({
        estado: "sigue_en_duda", deliveryId,
        motivo: `proveedor_no_responde: ${(e as Error)?.message ?? ""}`.slice(0, 120),
      });
      continue;
    }

    /*
     * Se descartan los SID que ya son de otra entrega nuestra. Si no, un
     * recordatorio adoptaría el SID del mensaje inicial y los dos apuntarían al
     * mismo envío.
     */
    const libres = await sinDueño(encontrados.map((m) => m.sid));
    const candidato = encontrados.find((m) => libres.has(m.sid));

    if (candidato) {
      await pool.query(
        `UPDATE survey_deliveries
            SET "providerMessageId" = $2, status = 'SENT',
                "sentAtMs" = COALESCE("sentAtMs", $3)
          WHERE id = $1 AND status = 'UNKNOWN'`,
        [deliveryId, candidato.sid, ahoraMs],
      );
      if (String(d.messageType) === "INITIAL") {
        await pool.query(
          `UPDATE survey_instances
              SET status = 'SENT', "sentAtMs" = COALESCE("sentAtMs", $2),
                  "initialSentAtMs" = COALESCE("initialSentAtMs", $2),
                  "blockedReason" = NULL, "blockedAtMs" = NULL, "sendClaimedAtMs" = NULL
            WHERE id = $1 AND status = 'QUEUED'`,
          [Number(d.surveyInstanceId), ahoraMs],
        );
      }
      console.log(`[Satisfaction] reconciliado: el intento ${deliveryId} SÍ se había mandado`);
      salida.push({ estado: "confirmado", deliveryId, sid: candidato.sid });
      continue;
    }

    // No aparece en el proveedor: no salió. Ahora sí se puede reintentar.
    await pool.query(
      `UPDATE survey_deliveries SET status = 'FAILED', "failedAtMs" = $2,
              "errorCode" = 'not_found_at_provider'
        WHERE id = $1 AND status = 'UNKNOWN'`,
      [deliveryId, ahoraMs],
    );
    await pool.query(
      `UPDATE survey_instances
          SET "blockedReason" = NULL, "blockedAtMs" = NULL, "sendClaimedAtMs" = NULL,
              "nextAttemptAtMs" = $2
        WHERE id = $1 AND status = 'QUEUED'`,
      [Number(d.surveyInstanceId), ahoraMs],
    );
    console.log(`[Satisfaction] reconciliado: el intento ${deliveryId} NO llegó a mandarse`);
    salida.push({ estado: "no_se_mando", deliveryId });
  }
  return salida;
}

/** De una lista de SID, los que no están ya asignados a una entrega nuestra. */
async function sinDueño(sids: string[]): Promise<Set<string>> {
  if (!sids.length) return new Set();
  const r = await pool.query(
    `SELECT "providerMessageId" FROM survey_deliveries WHERE "providerMessageId" = ANY($1)`,
    [sids],
  );
  const ocupados = new Set(r.rows.map((f) => String(f.providerMessageId)));
  return new Set(sids.filter((s) => !ocupados.has(s)));
}
