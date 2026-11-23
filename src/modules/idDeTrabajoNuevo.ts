/**
 * El id de un trabajo creado desde el panel.
 *
 * Partes de trabajo ponía «el mayor id cargado + 1». Pero la lista cargada es
 * solo la viva (abiertos y cerrados de los últimos tres días): un trabajo
 * creado así, una vez cerrado y pasados tres días, desaparece de la lista y
 * el siguiente parte vuelve a calcular EL MISMO id. El servidor lo frena con
 * «Conflicto de ID» y no se crea nada.
 *
 * El resto del panel usa la hora en milisegundos, que no se repite. Aquí
 * también, y por encima de lo cargado por si un reloj va atrasado. Para
 * varios trabajos seguidos del mismo parte, uno más cada vez.
 */
export function idDeTrabajoNuevo(
  jobs: ReadonlyArray<{ id: number | string }>,
  ahoraMs: number = Date.now()
): number {
  const mayor = jobs.reduce((max, j) => Math.max(max, Number(j.id) || 0), 0);
  return Math.max(ahoraMs, mayor + 1);
}
