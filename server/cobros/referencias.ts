/**
 * Referencias de cobro.
 *
 * Hasta ahora la referencia la tecleaba una persona, y eso tiene dos costes: se
 * repite (dos cobros con la misma referencia y el "consultar estado" solo
 * encuentra el último) y se cuela cualquier cosa. Aquí se reparte un número
 * correlativo y ya está.
 *
 * El contador vive en su propia tabla y no en un `MAX(reference) + 1` calculado
 * al vuelo: dos cobros creados a la vez desde dos móviles leerían el mismo
 * máximo y se llevarían el mismo número. El `INSERT ... ON CONFLICT DO UPDATE`
 * de abajo es una sola sentencia, así que la base serializa y cada uno se lleva
 * el suyo.
 *
 * No se usa una SEQUENCE de PostgreSQL porque hay que arrancar por encima de
 * las referencias numéricas que ya existen en producción, y eso con una
 * secuencia obliga a un `setval` a mano en cada base.
 */

/** Lo mínimo que se necesita de `pg` aquí: no se importa `db.ts` para no atarlo. */
type Consultador = {
  query: (texto: string, valores?: unknown[]) => Promise<{ rows: any[] }>;
};

/** Única fila de la tabla. Habrá más claves el día que haya más series. */
const CLAVE = "cobro";

/**
 * Crea el contador y lo arranca por encima de lo que ya haya.
 *
 * La siembra mira las referencias numéricas existentes: si en producción el
 * último cobro a mano fue el 41, el primero automático es el 42 y no el 1. Solo
 * ocurre la primera vez; después el `DO NOTHING` la deja en paz.
 */
export async function initReferencias(db: Consultador): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS payment_counters (
      clave TEXT PRIMARY KEY,
      ultimo INTEGER NOT NULL DEFAULT 0
    );
  `);

  await db.query(
    `
      INSERT INTO payment_counters (clave, ultimo)
      SELECT $1, COALESCE(MAX(reference::integer), 0)
      FROM payments
      WHERE reference ~ '^[0-9]+$'
      ON CONFLICT (clave) DO NOTHING
    `,
    [CLAVE]
  );
}

/**
 * El siguiente número libre, como texto (la columna `reference` es TEXT y las
 * referencias viejas escritas a mano tampoco eran números).
 */
export async function siguienteReferencia(db: Consultador): Promise<string> {
  const { rows } = await db.query(
    `
      INSERT INTO payment_counters (clave, ultimo)
      VALUES ($1, 1)
      ON CONFLICT (clave) DO UPDATE SET ultimo = payment_counters.ultimo + 1
      RETURNING ultimo
    `,
    [CLAVE]
  );
  return String(rows[0].ultimo);
}
