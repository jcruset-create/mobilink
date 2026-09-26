/**
 * El envío de la solicitud de confirmación.
 *
 * ── Sin plantilla no se manda nada ──────────────────────────────────────────
 *
 * `TWILIO_CONTENT_SID_CONFIRMACION_CITA` es obligatoria y NO cae a
 * `TWILIO_CONTENT_SID`. La plantilla vieja no tiene botones: un mensaje que
 * pide confirmar sin manera de confirmar es peor que no mandar nada, porque el
 * cliente contesta con texto libre, nadie lo interpreta y la cita se queda
 * igual de sin confirmar pero con el cliente creyendo que ya avisó.
 *
 * Cuando falta, `enviarConfirmacion` devuelve `sin-plantilla`: no se manda, no
 * se marca nada, y el bucle lo reintentará en la siguiente vuelta. Es decir,
 * en cuanto se configure la variable, las citas que estén en ventana salen
 * solas sin tocar nada.
 *
 * ── Los estados de entrega hay que PEDIRLOS ─────────────────────────────────
 *
 * Twilio no manda `delivered`/`read` si no le dices a dónde. Los WhatsApp de la
 * agenda nunca han llevado `statusCallback` —solo los de asistencias—, así que
 * hasta ahora de estos mensajes no se sabía nada después de salir. Se añade
 * aquí.
 */

import {
  aE164,
  clienteTwilio,
  hayCredencialesTwilio,
  numeroWhatsAppEmisor,
} from "../core/twilio.ts";
import { WORKSHOPS, DEFAULT_WORKSHOP_ID } from "../../src/modules/workshops.ts";

/** Lo que hizo falta y no estaba, o el mensaje que salió. */
export type ResultadoEnvio =
  | { estado: "enviado"; sid: string; telefono: string; contentSid: string }
  | { estado: "sin-plantilla" }
  | { estado: "sin-telefono" }
  | { estado: "sin-twilio" };

/** El nombre del taller como se le dice al cliente. */
export function nombreDelTaller(workshopId: unknown): string {
  const id = String(workshopId ?? "") || DEFAULT_WORKSHOP_ID;
  const taller = WORKSHOPS.find((w) => w.id === id);
  return taller?.name ?? WORKSHOPS[0].name;
}

/** La fecha como se lee en un WhatsApp: 27/09/2026. */
export function fechaParaElCliente(fecha: unknown): string {
  const v = String(fecha ?? "").trim();
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

/**
 * Las seis variables de `confirmacion_cita_taller_v1`, en su orden.
 *
 * Puro y exportado para poder comprobar en un test que van donde van: un
 * desajuste aquí manda al cliente la matrícula donde debería ir la hora, y eso
 * no lo caza ningún typecheck porque son todas cadenas.
 */
export function variablesDeConfirmacion(cita: {
  customerName?: unknown;
  workshopId?: unknown;
  date?: unknown;
  startTime?: unknown;
  plate?: unknown;
}, motivo: string): Record<string, string> {
  return {
    "1": String(cita.customerName ?? "").trim() || "cliente",
    "2": nombreDelTaller(cita.workshopId),
    "3": fechaParaElCliente(cita.date),
    "4": String(cita.startTime ?? "").trim() || "-",
    "5": String(cita.plate ?? "").trim() || "-",
    "6": motivo || "revisión",
  };
}

/**
 * A dónde tiene que llamar Twilio para contarnos qué pasa con el mensaje.
 *
 * NO se usa `getPublicAppBaseUrl()`, que es la URL de cara al CLIENTE y cae al
 * dominio comercial: sirve para un enlace que se le enseña a alguien, no para
 * decirle a Twilio dónde estamos. El callback tiene que llegar a ESTE
 * servicio, y si apunta a otro sitio los estados no llegan nunca y la ficha se
 * queda en «enviado» para siempre sin que nada falle de forma visible.
 *
 * Es además el mismo valor que ya acepta la comprobación de firma
 * (`urlsDeFirma` en core/twilio.ts): PUBLIC_APP_URL si está, y si no el host
 * que sirve la aplicación.
 */
export function urlBaseParaCallbacks(): string {
  const configurada = String(process.env.PUBLIC_APP_URL ?? "").trim();
  if (/^https?:\/\//i.test(configurada)) return configurada.replace(/\/+$/, "");
  return "https://sea-tarragona.onrender.com";
}

/**
 * Avisa al arrancar si los callbacks van a ir a un sitio dudoso.
 *
 * No bloquea: el servidor tiene que levantar igual. Pero un `statusCallback`
 * que apunte a donde no debe es el fallo más difícil de diagnosticar de todo
 * esto —los estados no llegan nunca y la ficha se queda en «Enviado» para
 * siempre, sin que nada falle de forma visible—, así que al menos queda dicho
 * en el arranque.
 */
export function avisarSiLosCallbacksVanADudoso(): void {
  const configurada = String(process.env.PUBLIC_APP_URL ?? "").trim();
  const url = `${urlBaseParaCallbacks()}/api/whatsapp/status`;

  if (!configurada) {
    console.warn(
      `[Citas] PUBLIC_APP_URL no está configurada. Los estados de WhatsApp ` +
        `se pedirán a ${url} — comprueba que ese dominio es el que sirve esta ` +
        `aplicación y que Twilio puede alcanzarlo.`
    );
    return;
  }
  if (!/^https:\/\//i.test(configurada)) {
    console.warn(
      `[Citas] PUBLIC_APP_URL no es una URL https válida ("${configurada}"). ` +
        `Los estados de WhatsApp se pedirán a ${url}.`
    );
    return;
  }
  console.log(`[Citas] estados de WhatsApp: ${url}`);
}

/** El Content SID de la confirmación, o vacío si no está configurado. */
export function contentSidDeConfirmacion(): string {
  return String(process.env.TWILIO_CONTENT_SID_CONFIRMACION_CITA ?? "").trim();
}

/**
 * Manda la solicitud de confirmación.
 *
 * No escribe en la base: de eso se encarga quien llama, y solo si esto
 * devolvió `enviado`. Así no hay forma de marcar como enviada una cita cuyo
 * mensaje no llegó a salir.
 */
export async function enviarConfirmacion(
  cita: Record<string, any>,
  opciones: { motivo: string; urlBase?: string }
): Promise<ResultadoEnvio> {
  const contentSid = contentSidDeConfirmacion();
  if (!contentSid) return { estado: "sin-plantilla" };

  const telefono = aE164(String(cita.customerPhone ?? ""));
  if (!telefono || telefono === "+") return { estado: "sin-telefono" };

  // `clienteTwilio()` siempre construye un cliente, con credenciales o sin
  // ellas, así que preguntar por el cliente no sirve de nada: hay que
  // preguntar por las credenciales antes.
  if (!hayCredencialesTwilio()) return { estado: "sin-twilio" };
  const cliente = clienteTwilio();

  const mensaje = await cliente.messages.create({
    from: numeroWhatsAppEmisor(),
    to: `whatsapp:${telefono}`,
    contentSid,
    contentVariables: JSON.stringify(variablesDeConfirmacion(cita, opciones.motivo)),
    // Sin esto Twilio no avisa de nada: ni entregado, ni leído, ni fallido.
    statusCallback: `${(opciones.urlBase ?? urlBaseParaCallbacks()).replace(/\/+$/, "")}/api/whatsapp/status`,
  });

  return {
    estado: "enviado",
    sid: mensaje.sid,
    telefono,
    contentSid,
  };
}
