/**
 * El adaptador de envío. Lo único de Satisfaction que habla con Twilio.
 *
 * Está separado del worker a propósito: así las pruebas pueden simular un
 * éxito, un rechazo, una caída y —sobre todo— la respuesta que nunca llega,
 * sin mandar un solo WhatsApp de verdad.
 *
 * ── Content Templates, no texto libre ───────────────────────────────────────
 *
 * WhatsApp solo deja abrir conversación con una plantilla aprobada por Meta.
 * Aquí no se redacta ningún mensaje: se manda el `contentSid` que venga de
 * entorno y sus variables. El texto vive en la plantilla aprobada, y este
 * código no sabe —ni tiene por qué saber— qué dice.
 *
 * ── Lo que va en las variables ──────────────────────────────────────────────
 *
 * Lo mínimo: al conductor, matrícula y enlace; al cliente, referencia y enlace.
 * Ni teléfono, ni tenant, ni identificadores internos, ni nada del expediente
 * de calidad. Lo que viaja en un WhatsApp acaba en la copia de seguridad del
 * móvil de alguien.
 */

import {
  aWhatsApp, clienteTwilio, hayCredencialesTwilio, numeroWhatsAppEmisor,
} from "../core/twilio.ts";
import type { RolDestinatario, TipoMensaje } from "./dominio.ts";

/* ── Plantillas ──────────────────────────────────────────────────────────── */

/**
 * De dónde sale el Content SID de cada mensaje.
 *
 * Los nombres siguen la convención que ya usa la casa —`TWILIO_TEMPLATE_*`,
 * como `TWILIO_TEMPLATE_ASIGNADA`—. Los valores son de entorno: aquí no hay
 * ningún SID escrito, ni inventado, ni de ejemplo.
 */
export const VARIABLES_PLANTILLA: Record<RolDestinatario, Record<TipoMensaje, string>> = {
  DRIVER: {
    INITIAL: "TWILIO_TEMPLATE_SATISFACTION_DRIVER",
    REMINDER: "TWILIO_TEMPLATE_SATISFACTION_REMINDER_DRIVER",
  },
  CUSTOMER: {
    INITIAL: "TWILIO_TEMPLATE_SATISFACTION_CUSTOMER",
    REMINDER: "TWILIO_TEMPLATE_SATISFACTION_REMINDER_CUSTOMER",
  },
};

/** El motivo con el que se registra que faltaba la plantilla. */
export const MOTIVO_SIN_PLANTILLA: Record<RolDestinatario, Record<TipoMensaje, string>> = {
  DRIVER: {
    INITIAL: "no_template_satisfaction_driver",
    REMINDER: "no_template_satisfaction_reminder_driver",
  },
  CUSTOMER: {
    INITIAL: "no_template_satisfaction_customer",
    REMINDER: "no_template_satisfaction_reminder_customer",
  },
};

export function contentSidDe(rol: RolDestinatario, tipo: TipoMensaje): string | null {
  const sid = String(process.env[VARIABLES_PLANTILLA[rol][tipo]] ?? "").trim();
  return sid || null;
}

/* ── Envío ───────────────────────────────────────────────────────────────── */

export type PeticionEnvio = {
  rol: RolDestinatario;
  tipo: TipoMensaje;
  /** Ya en E.164 o como lo diera el destinatario: se normaliza aquí. */
  telefono: string;
  /** La URL pública completa. No se escribe en ningún log. */
  url: string;
  /** Matrícula para el conductor; referencia para el cliente. */
  referencia: string;
  /** Adónde debe avisar Twilio de los cambios de estado. */
  statusCallback?: string | null;
};

/**
 * Qué pasó al intentar mandarlo.
 *
 *  · `aceptado`   — Twilio lo cogió y devolvió un SID. **No** quiere decir que
 *                   llegara al teléfono.
 *  · `rechazado`  — dijo que no, con un código. Puede ser definitivo o no.
 *  · `desconocido`— la petición salió y no volvió respuesta. Ver más abajo.
 *  · `sin_configurar` — ni se intentó: falta plantilla, credencial o URL.
 */
export type ResultadoEnvio =
  | { estado: "aceptado"; sid: string }
  | { estado: "rechazado"; codigo: string; mensaje: string; permanente: boolean }
  | { estado: "desconocido"; mensaje: string }
  | { estado: "sin_configurar"; motivo: string };

export type Adaptador = { enviar(p: PeticionEnvio): Promise<ResultadoEnvio> };

/**
 * Los códigos de Twilio que no van a mejorar por insistir.
 *
 * Número mal escrito, línea sin WhatsApp, destinatario que ha bloqueado al
 * remitente: reintentar cuatro veces no arregla ninguno, solo gasta cuota y
 * ensucia la tabla. La lista es corta a propósito —solo lo que se sabe seguro—
 * y lo que no esté aquí se trata como transitorio, que es lo prudente: como
 * mucho se reintenta de más.
 */
export const CODIGOS_PERMANENTES = new Set([
  "21211", // 'To' no es un número válido
  "21408", // sin permiso para enviar a esa región
  "21610", // el destinatario se dio de baja
  "21614", // no puede recibir WhatsApp/SMS
  "63003", // no se pudo resolver el destinatario
  "63024", // parámetros del mensaje inválidos
  "63032", // el destinatario ha bloqueado al remitente
  "21617", // cuerpo demasiado largo
]);

/**
 * ¿Es un error del que no se sabe si llegó a enviarse?
 *
 * Un timeout o una conexión cortada dejan la duda: Twilio pudo aceptar el
 * mensaje y perderse la respuesta por el camino. Eso NO es un fallo, es una
 * incógnita, y tratarla como fallo llevaría a mandar un segundo WhatsApp.
 */
function esAmbiguo(e: { code?: unknown; status?: unknown; message?: string }): boolean {
  const codigo = String((e as { code?: unknown }).code ?? "");
  if (["ETIMEDOUT", "ECONNRESET", "ECONNABORTED", "EPIPE", "ENETUNREACH"].includes(codigo)) {
    return true;
  }
  const http = Number((e as { status?: unknown }).status);
  // 5xx es del lado de Twilio: pudo haberlo registrado antes de caerse.
  if (Number.isFinite(http) && http >= 500) return true;
  return /timeout|socket hang up|network/i.test(String(e?.message ?? ""));
}

/**
 * El mensaje de error, limpio.
 *
 * Nunca se guarda el error entero: puede traer la petición completa —con la
 * URL, y en la URL va el token— y las cabeceras, que llevan la credencial.
 */
export function sanearError(mensaje: unknown, limite = 300): string {
  return String(mensaje ?? "")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\b(?:AC|SK|SM|MM|HX)[0-9a-f]{16,}\b/gi, "[sid]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limite);
}

/**
 * Las variables del Content Template.
 *
 * Dos, numeradas 1 y 2, en el orden en el que aparecen en el texto conceptual:
 * primero de qué servicio se habla —matrícula o referencia— y después el
 * enlace. Si la plantilla aprobada acaba teniendo otra numeración, se cambia
 * aquí y en ningún otro sitio.
 */
export function variablesDe(p: { referencia: string; url: string }): Record<string, string> {
  return { "1": p.referencia, "2": p.url };
}

/** El adaptador de verdad. El único sitio del módulo que sale a la red. */
export const adaptadorTwilio: Adaptador = {
  async enviar(p: PeticionEnvio): Promise<ResultadoEnvio> {
    if (!hayCredencialesTwilio()) {
      return { estado: "sin_configurar", motivo: "no_twilio_credentials" };
    }
    const contentSid = contentSidDe(p.rol, p.tipo);
    if (!contentSid) {
      return { estado: "sin_configurar", motivo: MOTIVO_SIN_PLANTILLA[p.rol][p.tipo] };
    }
    if (!p.telefono) return { estado: "sin_configurar", motivo: "no_recipient" };
    if (!p.url) return { estado: "sin_configurar", motivo: "no_public_base_url" };

    try {
      const mensaje = await clienteTwilio().messages.create({
        from: numeroWhatsAppEmisor(),
        to: aWhatsApp(p.telefono),
        contentSid,
        contentVariables: JSON.stringify(variablesDe(p)),
        ...(p.statusCallback ? { statusCallback: p.statusCallback } : {}),
      });
      const sid = String(mensaje?.sid ?? "");
      /*
       * Sin SID no se puede decir que se aceptó: no habría con qué casar el
       * callback ni con qué reconciliar. Se trata como incógnita.
       */
      if (!sid) return { estado: "desconocido", mensaje: "Twilio no devolvió SID" };
      return { estado: "aceptado", sid };
    } catch (e: unknown) {
      const err = e as { code?: unknown; status?: unknown; message?: string };
      if (esAmbiguo(err)) return { estado: "desconocido", mensaje: sanearError(err.message) };
      const codigo = String(err.code ?? err.status ?? "desconocido");
      return {
        estado: "rechazado",
        codigo,
        mensaje: sanearError(err.message),
        permanente: CODIGOS_PERMANENTES.has(codigo),
      };
    }
  },
};
