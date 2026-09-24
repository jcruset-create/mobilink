/**
 * Qué fichero se acepta como parte de trabajo.
 *
 * Va aparte del router para poder probarlo sin arrancar medio servidor: el
 * router importa Supabase, que se niega a cargarse sin credenciales, y esto es
 * una comprobación que conviene tener cubierta porque es la que decide qué
 * llega al modelo y cuánto cuesta.
 */

/**
 * Tope del fichero que se acepta.
 *
 * Un parte escaneado a 300 ppp ronda los 300 KB y uno a 600 ppp puede irse a
 * 3 MB. Ocho es holgado para un parte de varias hojas y corta el envío de un
 * PDF de cien páginas, que no es un parte y costaría una fortuna en tokens.
 */
export const MAX_BYTES = 8 * 1024 * 1024;

export const TIPOS = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];

/** Qué hay dentro de un data: URI, sin fiarse de lo que diga la cabecera. */
export function comprobarFichero(dataUri: string): { ok: true; tipo: string; bytes: number } | { ok: false; error: string } {
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUri ?? "");
  if (!m) return { ok: false, error: "El fichero no ha llegado bien" };
  const tipo = m[1].toLowerCase();
  if (!TIPOS.includes(tipo)) {
    return { ok: false, error: "Solo se admiten PDF o una foto del parte" };
  }
  // El base64 ocupa 4/3 de lo que pesa: se calcula sin decodificarlo.
  const limpio = m[2].replace(/\s/g, "");
  const bytes = Math.floor((limpio.length * 3) / 4);
  if (bytes > MAX_BYTES) {
    return { ok: false, error: `El fichero pesa más de ${Math.round(MAX_BYTES / 1024 / 1024)} MB` };
  }
  return { ok: true, tipo, bytes };
}
