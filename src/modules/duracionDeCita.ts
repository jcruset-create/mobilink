/**
 * Minutos que se guardan en una cita de la agenda.
 *
 * ── El fallo que arregla ────────────────────────────────────────────────────
 *
 * El cuadro «Duración prevista» se rellena solo al elegir plantilla, cantidad
 * o tareas, y se puede cambiar a mano. El cambio se veía en «Fin previsto»,
 * pero al guardar se calculaban otra vez los minutos de la plantilla y la
 * cita volvía a los 30 de siempre. Alguien tecleaba 180, guardaba, y en el
 * calendario seguía ocupando media hora.
 *
 * ── La regla ────────────────────────────────────────────────────────────────
 *
 * Lo tecleado manda sobre la plantilla. Si alguien lo ha cambiado es porque
 * esta cita no es la estándar. Si el cuadro está vacío o no es un número, la
 * plantilla; y si tampoco, el valor por defecto. Nunca menos de 15 minutos:
 * una cita de 0 minutos no se ve en el calendario.
 */

export const MINIMO_MINUTOS_CITA = 15;

function minutosValidos(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function minutosDeLaCita(
  tecleados: unknown,
  deLaPlantilla: unknown,
  porDefecto = 45
): number {
  const elegido = minutosValidos(tecleados) ?? minutosValidos(deLaPlantilla) ?? porDefecto;
  return Math.max(MINIMO_MINUTOS_CITA, elegido);
}
