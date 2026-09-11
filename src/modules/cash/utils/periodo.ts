/**
 * Tramos de fechas para los informes.
 *
 * Aquí solo hay una función, y existe porque la versión ingenua está mal de una
 * manera que no se ve:
 *
 * ```ts
 * new Date(2026, 8, 1).toISOString().slice(0, 10)   // "2026-08-31" en Madrid
 * ```
 *
 * `new Date(a, m, d)` construye la medianoche **local**, y `toISOString()` la
 * pasa a UTC: en verano español eso son las 22:00 del día ANTERIOR. El informe
 * de septiembre empezaría el 31 de agosto y se traería el gasto de un día que
 * ya está contado en el mes pasado. Nadie lo nota, porque el total sigue siendo
 * un número creíble.
 *
 * La forma correcta: leer el año y el mes con los getters **locales** —lo que
 * la persona llama «este mes» es su mes, no el de Greenwich— y construir la
 * fecha con `Date.UTC`, que no desplaza nada al pasarla a ISO.
 */

/** `2026-09-01` a partir de un `Date` ya construido en UTC. */
const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * El mes en curso, de su día 1 a su último día.
 *
 * El día 0 del mes siguiente es el último del actual, y así no hay que saberse
 * los días de cada mes ni los años bisiestos.
 */
export function mesEnCurso(hoy: Date = new Date()): { desde: string; hasta: string } {
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth();
  return {
    desde: iso(new Date(Date.UTC(anio, mes, 1))),
    hasta: iso(new Date(Date.UTC(anio, mes + 1, 0))),
  };
}
