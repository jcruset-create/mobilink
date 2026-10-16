/**
 * Qué adjunto de WhatsApp se le puede enseñar al navegador, y cuál no.
 *
 * ── El cartel de «Inicia la sesión · api.twilio.com» ────────────────────────
 *
 * Cada mensaje con adjunto guarda dos direcciones: la COPIA nuestra —subida a
 * Supabase al recibirlo— y la ORIGINAL de Twilio. El panel usaba «la copia, y
 * si no hay, la original», y la original de Twilio exige usuario y contraseña:
 * al abrirla, el navegador hace lo único que sabe hacer con un 401, que es
 * pedirle las credenciales al que está delante. De ahí el cartel pidiendo las
 * credenciales de Twilio a un operador que no las tiene ni debe tenerlas.
 *
 * Esas credenciales son del servidor. Enseñar esa URL al navegador no puede
 * funcionar nunca, así que no se enseña: cuando no hay copia se dice que no la
 * hay, que es la verdad y además explica por qué no se ve la foto.
 *
 * ── Y la copia, ¿por qué falta? ─────────────────────────────────────────────
 *
 * Porque la subida a Supabase falló al recibir el mensaje. El webhook lo
 * intenta y, si no puede, lo anota en el log y sigue: perder el mensaje entero
 * por no poder guardar la foto sería peor. Pero entonces del adjunto solo
 * queda la dirección de Twilio, y eso es lo que el panel no puede abrir.
 */

/** Las direcciones de Twilio, que piden usuario y contraseña. */
export function esDeTwilio(url: unknown): boolean {
  const texto = String(url ?? "");
  return /^https?:\/\/[^/]*\btwilio\.com\//i.test(texto);
}

export type AdjuntoDelMensaje = {
  media_stored_url?: string | null;
  media_url?: string | null;
};

/**
 * La dirección que se le puede dar al navegador, o `null` con el motivo.
 *
 * Se devuelve el motivo y no solo `null` porque un hueco sin explicación es lo
 * que hace que alguien dé por perdida una foto que en realidad sigue en el
 * WhatsApp del que la mandó.
 */
export function adjuntoVisible(msg: AdjuntoDelMensaje): {
  url: string | null;
  motivo: string | null;
} {
  const copia = String(msg?.media_stored_url ?? "").trim();
  if (copia && !esDeTwilio(copia)) return { url: copia, motivo: null };

  const original = String(msg?.media_url ?? "").trim();
  if (!original) return { url: null, motivo: null };

  if (esDeTwilio(original)) {
    return {
      url: null,
      motivo:
        "No se guardó copia de este adjunto, y el original de WhatsApp no se " +
        "puede abrir desde aquí. Sigue en la conversación de WhatsApp.",
    };
  }

  return { url: original, motivo: null };
}
