/**
 * El callback de estado de Twilio para las encuestas.
 *
 * ── Por qué una ruta propia ─────────────────────────────────────────────────
 *
 * Ya existe `/api/whatsapp/status`, pero solo sabe mover el WhatsApp de
 * seguimiento de una asistencia y, sobre todo, **acepta callbacks aunque la
 * firma no sea válida**: se limita a avisar por consola y sigue. Para el
 * seguimiento eso como mucho ensucia un campo informativo. Aquí no: quien
 * consiguiera colar un callback movería el estado de una entrega y, con él, lo
 * que la ficha y las métricas dicen que le pasó a un cliente. Se exige firma.
 *
 * ── Qué se acepta ───────────────────────────────────────────────────────────
 *
 * Solo lo que Twilio manda de verdad: el SID del mensaje y su estado. El SID no
 * se cree por venir escrito —se busca en la tabla— y el estado tiene que estar
 * en la lista de los que Twilio usa. Lo demás se ignora.
 *
 * Siempre 200 mientras la firma sea válida, incluso si el SID no es nuestro:
 * responder 4xx haría que Twilio reintentara un callback que nunca va a
 * aplicar. Un callback repetido es inocuo.
 */

import { Router, urlencoded, type Request } from "express";

import { firmaTwilioValida, urlsDeFirma } from "../core/twilio.ts";
import { aplicarEstadoProveedor } from "./envio.ts";
import { RUTA_CALLBACK } from "./urlPublica.ts";

export function createSatisfactionCallbackRouter(): Router {
  const router = Router();
  // Twilio manda `application/x-www-form-urlencoded`, no JSON.
  router.use(urlencoded({ extended: false, limit: "16kb" }));

  router.post("/", async (req: Request, res) => {
    const cuerpo = (req.body ?? {}) as Record<string, unknown>;
    const valida = firmaTwilioValida({
      firma: req.headers["x-twilio-signature"] as string | undefined,
      urls: urlsDeFirma(
        { host: req.get("host"), reenviado: req.get("x-forwarded-host") },
        RUTA_CALLBACK,
      ),
      cuerpo,
    });
    if (!valida) {
      // 403 y ni se mira el cuerpo. No se dice por qué: quien esté probando
      // firmas no tiene por qué saber si falla el token o la URL.
      console.warn("[Satisfaction] callback con firma inválida, rechazado");
      return res.status(403).send("forbidden");
    }

    const sid = String(cuerpo.MessageSid ?? cuerpo.SmsSid ?? "").trim();
    const estado = String(cuerpo.MessageStatus ?? cuerpo.SmsStatus ?? "").trim();
    const errorCode = cuerpo.ErrorCode == null ? null : String(cuerpo.ErrorCode);
    if (!sid || !estado) return res.status(200).send("ok");

    try {
      const r = await aplicarEstadoProveedor({ sid, estadoTwilio: estado, errorCode });
      if (!r.aplicado && r.motivo !== "sid_desconocido") {
        console.log(`[Satisfaction] callback ${estado} no aplicado: ${r.motivo}`);
      }
    } catch (e: unknown) {
      console.error("[Satisfaction] callback:", (e as Error)?.message);
    }
    return res.status(200).send("ok");
  });

  return router;
}
