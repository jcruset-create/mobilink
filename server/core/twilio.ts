/**
 * El cliente de Twilio y las dos cosas que hacen falta para hablarle.
 *
 * Estaba todo dentro de `server/index.ts` —el cliente en una constante de
 * módulo, la normalización del teléfono y el número emisor en sendas funciones
 * sueltas— y desde allí no se podía usar: importar `index.ts` desde un worker
 * arrastraría las casi diecinueve mil líneas de la aplicación entera, con sus
 * rutas y sus temporizadores.
 *
 * Así que se saca aquí y `index.ts` lo importa. Es lo mismo que había, en un
 * sitio donde se puede reutilizar; NO es un segundo cliente.
 *
 * ── Sin credenciales no revienta el arranque ────────────────────────────────
 *
 * El cliente se construye la primera vez que se pide, no al cargar el módulo.
 * En una instalación sin Twilio configurado —y en las pruebas— nadie lo pide y
 * no pasa nada. Antes se construía siempre, y solo funcionaba porque el SDK
 * tolera credenciales vacías.
 */

import twilio from "twilio";

export type ClienteTwilio = ReturnType<typeof twilio>;

let cliente: ClienteTwilio | null = null;

/** `true` si hay con qué autenticarse. */
export function hayCredencialesTwilio(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

export function clienteTwilio(): ClienteTwilio {
  if (!cliente) {
    cliente = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return cliente;
}

/** Solo para pruebas: olvida el cliente construido. */
export function olvidarClienteTwilio(): void {
  cliente = null;
}

/**
 * El número desde el que se escribe.
 *
 * El valor de reserva es el de siempre; se conserva tal cual estaba en
 * `index.ts` para no cambiar de emisor por un refactor.
 */
export function numeroWhatsAppEmisor(): string {
  return (
    process.env.TWILIO_WHATSAPP_FROM ||
    process.env.TWILIO_WHATSAPP_NUMBER ||
    "whatsapp:+34610473079"
  );
}

/**
 * A E.164, asumiendo España cuando no se dice otra cosa.
 *
 * Nueve dígitos son un número español sin prefijo; once que empiezan por 34 ya
 * lo llevan; y lo que venga con «+» se respeta, que puede ser de fuera.
 *
 * Es la misma función que había en `index.ts` —`normalizeSpanishPhone`—, con
 * el mismo comportamiento: cambiarla ahora movería a quién se le escribe.
 */
export function aE164(telefono: string): string {
  const digitos = String(telefono || "").replace(/\D/g, "");
  if (!digitos) return "";
  if (digitos.startsWith("34") && digitos.length === 11) return `+${digitos}`;
  if (digitos.length === 9) return `+34${digitos}`;
  if (String(telefono).trim().startsWith("+")) return String(telefono).trim();
  return `+${digitos}`;
}

/** Cómo se escribe un destinatario de WhatsApp para Twilio. */
export const aWhatsApp = (telefono: string): string => `whatsapp:${aE164(telefono)}`;

/**
 * El teléfono, tapado, para poder escribirlo en un log.
 *
 * Deja ver el prefijo y el último dígito: bastante para reconocer una línea
 * cuando se está mirando un caso concreto, insuficiente para reconstruirla.
 */
export function enmascararTelefono(telefono: string | null | undefined): string {
  const s = String(telefono ?? "");
  if (s.length < 5) return "***";
  return `${s.slice(0, 4)}${"*".repeat(s.length - 5)}${s.slice(-1)}`;
}

/* ── Firma de los callbacks ──────────────────────────────────────────────── */

/**
 * Las URL con las que Twilio pudo haber firmado esta petición.
 *
 * La firma se calcula sobre la URL EXACTA que Twilio llamó, y el servicio
 * responde por varios nombres a la vez —el dominio propio y el `.onrender.com`
 * heredado—, así que se prueban todos en vez de fijar uno: cambiar de dominio
 * no debe depender de acertar con una constante.
 *
 * Es el mismo criterio que ya usa `/api/whatsapp/inbound`.
 */
export function urlsDeFirma(
  cabeceras: { host?: string | null; reenviado?: string | null },
  ruta: string,
): string[] {
  const hostLlamado = cabeceras.reenviado || cabeceras.host;
  const candidatos = [
    process.env.PUBLIC_APP_URL,
    hostLlamado ? `https://${hostLlamado}` : "",
    "https://app.mobilink.es",
    "https://sea-tarragona.onrender.com",
  ]
    .map((u) => String(u || "").trim().replace(/\/+$/, ""))
    .filter((u) => /^https?:\/\//i.test(u));
  return [...new Set(candidatos)].map((u) => `${u}${ruta}`);
}

/**
 * ¿La firma de este callback es de Twilio?
 *
 * Devuelve `false` cuando no hay `TWILIO_AUTH_TOKEN` o no viene cabecera de
 * firma, y quien llama decide qué hacer. Aquí NO se decide «pasar igualmente»:
 * un callback de estado mueve el estado de una entrega, y aceptar uno anónimo
 * dejaría que cualquiera dijera que un mensaje se entregó.
 */
export function firmaTwilioValida(p: {
  firma: string | undefined;
  urls: string[];
  cuerpo: Record<string, unknown>;
}): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  if (!authToken || !p.firma) return false;
  return p.urls.some((u) => twilio.validateRequest(authToken, p.firma as string, u, p.cuerpo));
}
