/**
 * Normalización de matrículas, en un solo sitio.
 *
 * Había tres copias de la misma regla: `normalizePlateText` y
 * `normalizarMatricula` en `server/index.ts`, y otra en el conector de
 * histórico. Tres copias de una comparación es como se acaba encontrando un
 * vehículo por una vía y no por otra, según por dónde entre la matrícula.
 *
 * La regla es la de siempre —mayúsculas y solo alfanuméricos—, aquí escrita
 * una vez. `normalizePlateText` de `index.ts` pasa a delegar en ésta.
 */

/** `1234-ABC`, `1234 abc` y `1234ABC` son la misma matrícula. */
export function normalizarMatricula(valor: unknown): string {
  return String(valor ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Patrón para buscar en la base sin traerse la tabla entera.
 *
 * ── El problema ─────────────────────────────────────────────────────────────
 *
 * `tc_vehiculos.matricula` NO está normalizada: la misma matrícula puede estar
 * guardada como `1234ABC`, `1234-ABC` o `1234 ABC`. Comparar por igualdad no
 * vale, y en TyreControl no se puede añadir una columna normalizada porque no
 * se toca.
 *
 * ── Lo que se hacía ─────────────────────────────────────────────────────────
 *
 * Traer 2.000 vehículos y comparar en JavaScript. Además de mover datos que no
 * se necesitan, con una flota mayor **dejaba de encontrar vehículos sin dar
 * ningún error**: el peor tipo de fallo.
 *
 * ── Lo que se hace ──────────────────────────────────────────────────────────
 *
 * Se intercala un comodín entre cada carácter: `1234ABC` → `1%2%3%4%A%B%C`.
 * Eso lo filtra el servidor, encaja con cualquier separador y deja un puñado
 * de filas. La coincidencia exacta se confirma después normalizando, porque el
 * patrón también admitiría `1X2X3X4XAXBXC`.
 *
 * Va anclado por la izquierda (sin `%` inicial) a propósito: así descarta las
 * matrículas que empiezan por otra cosa sin tener que mirarlas.
 */
export function patronBusquedaMatricula(matricula: string): string | null {
  const limpia = normalizarMatricula(matricula);
  if (limpia.length < 4) return null;   // demasiado corta: traería media tabla
  return `${limpia.split("").join("%")}%`;
}

/** ¿Es esta fila la matrícula buscada, de verdad y no solo por el patrón? */
export function coincideMatricula(guardada: unknown, buscada: string): boolean {
  const objetivo = normalizarMatricula(buscada);
  return objetivo !== "" && normalizarMatricula(guardada) === objetivo;
}
