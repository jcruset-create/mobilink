/**
 * Extrae el enlace de mapa que un cliente manda por WhatsApp para decir dónde
 * está.
 *
 * Está aquí y no dentro del webhook por una razón concreta: el patrón anterior
 * tenía un fallo de seguridad que solo se ve escribiéndole pruebas, y dentro de
 * `server/index.ts` no hay forma de probarlo sin arrancar medio servidor.
 *
 * El fallo era este:
 *
 *     /https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|…)[^\s]*​/i
 *
 * Tras la alternación venía `[^\s]*`, que no cierra el host. Así que
 * `https://maps.app.goo.gl.atacante.tld/x` cumplía el patrón, y el servidor
 * acababa pidiendo esa URL y siguiéndole las redirecciones. El arreglo es el
 * `(?=[/?#]|$)`: después del dominio permitido solo puede venir el final de la
 * URL o el principio de la ruta, nunca más etiquetas de dominio.
 *
 * El patrón es la primera barrera. La segunda, que es la que de verdad manda,
 * es la lista blanca de hosts de `fetchSeguro`.
 */

/** Dominios de los que un enlace de ubicación puede venir legítimamente. */
const DOMINIOS = [
  "maps\\.app\\.goo\\.gl",
  "goo\\.gl",
  "maps\\.google\\.com",
  "www\\.google\\.com",
  "google\\.com",
  "share\\.google",
].join("|");

export const PATRON_ENLACE_MAPA = new RegExp(
  `https?://(?:${DOMINIOS})(?=[/?#]|$)[^\\s]*`,
  "i"
);

/** El primer enlace de mapa del texto, o null si no hay ninguno válido. */
export function extraerEnlaceMapa(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = String(texto).match(PATRON_ENLACE_MAPA);
  return m ? m[0] : null;
}
