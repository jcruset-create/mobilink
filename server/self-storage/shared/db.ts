/**
 * Acceso a PostgreSQL del módulo: la conexión común de Mobilink y un ayudante
 * de transacciones. Todo lo que escribe más de una fila va dentro de `enTx`.
 */

import type { PoolClient } from "pg";
import pool from "../../db.ts";

export type Ejecutor = Pick<PoolClient, "query">;

export { pool };

/** BEGIN … COMMIT, con ROLLBACK si algo lanza. */
export async function enTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** numeric de pg llega como texto: a número (o null). */
export const num = (v: unknown): number => (v == null ? (v as unknown as number) : Number(v));
export const numN = (v: unknown): number | null => (v == null ? null : Number(v));

/** SET a partir de un objeto parcial y un mapa de columnas permitidas. */
export function construirSet(cambios: Record<string, unknown>, columnas: Record<string, string>, desde = 1) {
  const partes: string[] = [];
  const valores: unknown[] = [];
  for (const [k, v] of Object.entries(cambios)) {
    const col = columnas[k];
    if (!col || v === undefined) continue;
    valores.push(v);
    partes.push(`${col} = $${desde + valores.length - 1}`);
  }
  return { sql: partes.join(", "), valores };
}
