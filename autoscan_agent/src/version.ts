/**
 * Qué versión es más nueva, y de dónde se acepta descargarla.
 *
 * Dos preguntas pequeñas que valen su propio fichero porque las dos son
 * decisiones de seguridad, no cálculos. Una actualización es ejecutar código
 * que llega de fuera: es lo más peligroso que hace el agente, y lo único que
 * lo separa de subir un PDF.
 */

/** Tramos de "1.2.10" → [1, 2, 10]. Lo que no sea número cuenta como 0. */
function tramos(v: string): number[] {
  return (v.trim().split("+")[0] ?? "").split(".").map((n) => parseInt(n, 10) || 0);
}

/**
 * ¿`candidata` es ESTRICTAMENTE más nueva que `actual`?
 *
 * Estrictamente, y ahí está el asunto: igual no se instala —no hay nada que
 * ganar y sí un reinicio que perder— y más vieja **nunca**.
 *
 * Rechazar la más vieja no es pedantería. Sin esa comprobación, quien pudiera
 * contestar por el servidor haría que veinte mostradores volvieran a una
 * versión antigua con un fallo ya arreglado, y lo harían solos y en orden. El
 * agente no tiene forma de saber si una versión vieja es peligrosa, así que no
 * retrocede nunca: si de verdad hay que volver atrás, se hace a mano en el
 * mostrador, que es donde alguien puede mirar qué pasa.
 */
export function esMasNueva(candidata: string, actual: string): boolean {
  const c = tramos(candidata);
  const a = tramos(actual);
  for (let i = 0; i < Math.max(c.length, a.length); i++) {
    const x = c[i] || 0;
    const y = a[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * De dónde se acepta descargar, y de ningún otro sitio.
 *
 * La URL la dice el servidor de Mobilink, en el que el agente ya confía para
 * todo lo demás. Pero confiar en él para SUBIR un fichero y confiar en él para
 * EJECUTAR lo que mande no son la misma confianza: lo segundo convierte
 * cualquier fallo del servidor —o de quien se ponga en su lugar— en control
 * del PC de recepción.
 *
 * Así que la dirección se comprueba aquí contra la lista de donde la casa
 * publica de verdad, que es la misma de las APK. No arregla un GitHub
 * comprometido, que es la misma confianza que ya se le dio al instalar; cierra
 * el salto de «te engaño con una respuesta» a «te ejecuto lo que quiera».
 */
export const ANFITRIONES = ["github.com", "objects.githubusercontent.com"] as const;

/**
 * De dónde se acepta descargar. Lo estricto es el valor por defecto.
 *
 * `politica` está para las pruebas, que necesitan un servidor local sin
 * certificado. Es un parámetro opcional, no un ajuste: nadie en el agente lo
 * pasa —ni el `config.json`, ni una variable de entorno— así que en producción
 * rige `ESTRICTA` y no hay forma de aflojarla desde el mostrador.
 *
 * Lo que las pruebas comprueban con la política abierta es lo de ALREDEDOR: el
 * techo de tamaño, el 404, el guion copiado aparte. Que la de por defecto sea
 * estricta se comprueba aparte, construyendo el actualizador tal como lo
 * construye el agente.
 */
export type PoliticaDeDescarga = {
  anfitriones: readonly string[];
  exigirTls: boolean;
};

export const ESTRICTA: PoliticaDeDescarga = { anfitriones: ANFITRIONES, exigirTls: true };

export function descargaAceptable(
  url: string,
  politica: PoliticaDeDescarga = ESTRICTA
): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  /* Sin TLS no se mira siquiera el anfitrión: por HTTP lo cambia cualquiera. */
  if (politica.exigirTls && u.protocol !== "https:") return false;
  return politica.anfitriones.includes(u.hostname);
}
