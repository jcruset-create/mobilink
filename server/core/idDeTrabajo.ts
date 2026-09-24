/**
 * De dónde sale el id de un trabajo nuevo.
 *
 * Un solo sitio, porque ya se ha hecho mal de dos maneras distintas en dos
 * ficheros distintos:
 *
 *  1. El navegador lo calculaba como «el mayor de los trabajos que veo, más
 *     uno». Con la lista vacía —o filtrada por taller, o con todo cerrado—
 *     eso da 1, el 1 ya existe, y sale clave duplicada.
 *  2. Se cambió a `Date.now()`. Peor: `jobs.id` es SERIAL, o sea INTEGER de
 *     cuatro bytes, y el máximo que admite es 2.147.483.647. Un `Date.now()`
 *     anda por 1.758.000.000.000, mil veces más. Postgres lo rechaza con
 *     «integer out of range» y se lleva por delante la operación entera.
 *
 * La regla buena es la primera, pero preguntándosela a la BASE y no a lo que
 * el navegador alcance a ver. Y no depende del tipo de la columna: si algún
 * día pasa a BIGINT, esto sigue valiendo.
 *
 * ── Por qué no se usa la secuencia del SERIAL ───────────────────────────────
 *
 * Porque no se usa en ninguna parte: todos los altas escriben el id a mano, así
 * que la secuencia se quedó donde estaba mientras la tabla crecía. Un
 * `DEFAULT` devolvería números que ya existen. Arreglarla es un `setval` que
 * no toca a nadie... y que hay que decidir aparte, no de tapadillo dentro de
 * un arreglo de otra cosa.
 */

/** Lo mínimo que se necesita de `pg`: una conexión o el pool, da igual. */
export interface Consultante {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

/** El siguiente id libre, según la propia tabla. */
export async function siguienteIdDeTrabajo(db: Consultante): Promise<number> {
  const r = await db.query(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM jobs`);
  return Number(r.rows[0]?.id ?? 1);
}

/**
 * ¿Es «esa clave ya existe»?
 *
 * Importa distinguirlo: ante una clave duplicada se vuelve a intentar con el
 * número siguiente, pero ante un error de columna o de tipo NO. Repetir eso
 * no lo arregla, solo lo esconde tres veces y deja el mismo error final sin
 * decir que se probó tres veces.
 */
export function esClaveDuplicada(e: unknown): boolean {
  return (e as any)?.code === "23505";
}

/** Cuántas veces se reintenta antes de rendirse. */
export const INTENTOS_DE_ID = 3;
