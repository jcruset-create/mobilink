/**
 * La URL que se manda por WhatsApp.
 *
 * El repositorio ya construye enlaces públicos —seguimiento e informe— con
 * `getPublicAppBaseUrl(req, …)`, que mira `PUBLIC_APP_URL`, luego lo que
 * proponga el cliente y por último el dominio canónico. Aquí no hay `req`: el
 * worker manda desde un temporizador, sin nadie al otro lado.
 *
 * Así que se usa la misma fuente sin la parte que depende de la petición:
 * `PUBLIC_APP_URL` si es un dominio real. Deducirla de la cabecera `Host` no es
 * una opción —no hay petición— y quedarse con `sea-tarragona.onrender.com`
 * mandaría al cliente un enlace con el nombre interno del servicio.
 */

/** Hosts que no valen de cara al cliente. Mismo criterio que `index.ts`. */
const INTERNO = /onrender\.com|localhost|127\.0\.0\.1|tu-app/i;

/** El dominio de siempre, el mismo que usan seguimiento e informe. */
const CANONICO = "https://mobilink-solutions.com";

/**
 * La base pública, o `null` si no hay ninguna utilizable.
 *
 * `null` no es un fallo silencioso: quien llama registra el bloqueo y NO manda
 * nada. Es mejor una encuesta sin enviar que un WhatsApp con un enlace que no
 * abre.
 */
export function baseUrlPublica(): string | null {
  const configurada = String(process.env.PUBLIC_APP_URL ?? "").trim();
  if (/^https?:\/\//i.test(configurada) && !INTERNO.test(configurada)) {
    return configurada.replace(/\/+$/, "");
  }
  return CANONICO;
}

/** `{base}/valoracion/{token}` — la ruta que sirve la miniweb de 1D. */
export function urlDeValoracion(token: string): string | null {
  const base = baseUrlPublica();
  if (!base || !token) return null;
  return `${base}/valoracion/${token}`;
}

/**
 * Adónde avisa Twilio de los cambios de estado.
 *
 * Ruta propia y no la de `/api/whatsapp/status`, que solo sabe actualizar el
 * WhatsApp de seguimiento de una asistencia y además acepta callbacks sin
 * firma válida. El de Satisfaction la exige.
 */
export const RUTA_CALLBACK = "/api/satisfaction/whatsapp/status";

export function urlDeCallback(): string | null {
  const base = baseUrlPublica();
  return base ? `${base}${RUTA_CALLBACK}` : null;
}
