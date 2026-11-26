/**
 * ¿Llegó el SMS del enlace? — la parte que no toca nada.
 *
 * Twilio contesta dos veces a un SMS. La primera, al mandarlo: «aceptado», con
 * un identificador (`SM…`). La segunda, más tarde y solo si se le pregunta:
 * qué pasó con él en la operadora. Core se quedaba con la primera y pintaba
 * «Enlace enviado» aunque el mensaje no hubiera llegado nunca al móvil.
 *
 * Aquí está la traducción de lo que dice Twilio a lo que entiende quien mira
 * la lista de empleados. Sin base de datos y sin red: se prueba sola.
 */

/** Lo que se guarda. */
export type Entrega = "en_camino" | "entregado" | "no_entregado";

/**
 * Lo que se enseña. `sin_confirmar` no se guarda: es un «en camino» que ya
 * lleva demasiado rato así, y eso depende de cuándo se mire.
 */
export type EntregaEnLista = Entrega | "sin_confirmar";

/**
 * El `status` de un mensaje de Twilio → nuestra entrega.
 *
 * `null` si es un estado que no conocemos: no se inventa una entrega.
 */
export function entregaDeTwilio(status: string | null | undefined): Entrega | null {
  switch (String(status ?? "").trim().toLowerCase()) {
    case "delivered":
    case "read":
      return "entregado";
    case "undelivered":
    case "failed":
    case "canceled":
      return "no_entregado";
    case "accepted":
    case "scheduled":
    case "queued":
    case "sending":
    case "sent":
      return "en_camino";
    default:
      return null;
  }
}

/** Entregado o no entregado ya no cambian: no hace falta volver a preguntar. */
export const esFinal = (entrega: string | null | undefined): boolean =>
  entrega === "entregado" || entrega === "no_entregado";

/**
 * Los códigos de error de Twilio que salen en un SMS de verdad, en cristiano.
 *
 * Solo los que se conocen con seguridad. Para el resto se enseña el código y
 * el texto que dé Twilio: mejor un mensaje en inglés que uno inventado.
 */
const MOTIVOS: Record<number, string> = {
  21610: "Ese móvil pidió no recibir más mensajes de este remitente (respondió STOP).",
  30001: "Twilio tenía la cola llena y no llegó a enviarlo.",
  30002: "La cuenta de Twilio está suspendida.",
  30003: "El móvil está apagado o sin cobertura.",
  30004: "El móvil o su operadora bloquean los mensajes de este remitente.",
  30005: "Ese número no existe o ya no está en servicio.",
  30006: "Ese número no puede recibir SMS (es un fijo o la operadora no es alcanzable).",
  30007: "La operadora lo ha filtrado como mensaje no deseado.",
  30008: "La operadora no lo ha entregado y no dice por qué.",
  30010: "El mensaje cuesta más que el máximo permitido en la cuenta de Twilio.",
};

/** Por qué no llegó, para enseñarlo bajo el aviso. `null` si no hay nada que decir. */
export function motivoDeEntrega(codigo: number | null | undefined, detalle?: string | null): string | null {
  const texto = (codigo != null && MOTIVOS[codigo]) || String(detalle ?? "").trim() || null;
  if (codigo == null) return texto;
  return texto ? `${texto} (código ${codigo} de Twilio)` : `Código ${codigo} de Twilio.`;
}

/** Un SMS tarda segundos. Pasado este rato sin confirmación, ya no es «en camino». */
export const MARGEN_EN_CAMINO_MS = 15 * 60_000;

/** Cada cuánto se le vuelve a preguntar a Twilio por uno que sigue sin resolverse. */
const PAUSA_RECIENTE_MS = 30_000;
const PAUSA_VIEJO_MS = 10 * 60_000;

/**
 * ¿Hay que preguntarle a Twilio por este mensaje ahora?
 *
 * La lista de empleados se abre muchas veces: no se pregunta por lo que ya
 * tiene respuesta definitiva, y por lo que no, con calma —cada medio minuto
 * mientras es reciente y cada diez cuando ya lleva un rato atascado—.
 */
export function tocaPreguntar(p: {
  entrega: string | null;
  enviadoAtMs: number;
  preguntadoAtMs: number | null;
  ahoraMs: number;
}): boolean {
  if (esFinal(p.entrega)) return false;
  if (p.preguntadoAtMs == null) return true;
  const reciente = p.ahoraMs - p.enviadoAtMs < MARGEN_EN_CAMINO_MS;
  return p.ahoraMs - p.preguntadoAtMs >= (reciente ? PAUSA_RECIENTE_MS : PAUSA_VIEJO_MS);
}

/** Lo guardado → lo que se pinta. Sin respuesta todavía es «en camino». */
export function entregaEnLista(entrega: string | null, enviadoAtMs: number, ahoraMs: number): EntregaEnLista {
  if (entrega === "entregado" || entrega === "no_entregado") return entrega;
  return ahoraMs - enviadoAtMs >= MARGEN_EN_CAMINO_MS ? "sin_confirmar" : "en_camino";
}
