/**
 * Esquema de Self Storage: aplica, en orden, los .sql de
 * `supabase/migrations/self_storage/`.
 *
 * Una sola fuente: los mismos ficheros que se pegarían en el SQL Editor de
 * Supabase son los que ejecuta el servidor al arrancar (`prepararEsquema`,
 * ARCHITECTURE.md §14). Son idempotentes porque se ejecutan en CADA arranque.
 *
 * Cada fichero va en su propia transacción: si uno falla, no queda a medias.
 * Un cerrojo consultivo evita que dos instancias los apliquen a la vez, con
 * `pg_try_advisory_lock` y espera acotada, como `server/connect/schema.ts`: un
 * `pg_advisory_lock` que espera sin límite chocó allí con el statement_timeout
 * y dejó el servicio en un bucle de arranques fallidos.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pool from "../db.ts";

export const DIRECTORIO_MIGRACIONES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations/self_storage");

/** Clave del cerrojo consultivo (arbitraria, fija para este módulo). */
const CERROJO = 727_001_001;

export function ficherosDeMigracion(): string[] {
  return fs
    .readdirSync(DIRECTORIO_MIGRACIONES)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
}

async function esperarCerrojo(c: { query: (q: string, v?: unknown[]) => Promise<{ rows: { ok: boolean }[] }> }, esperaMaximaMs = 60_000): Promise<boolean> {
  const limite = Date.now() + esperaMaximaMs;
  for (;;) {
    const { rows } = await c.query("SELECT pg_try_advisory_lock($1) AS ok", [CERROJO]);
    if (rows[0]?.ok) return true;
    if (Date.now() >= limite) return false;
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

export async function initSelfStorage(): Promise<void> {
  const c = await pool.connect();
  let conCerrojo = false;
  try {
    conCerrojo = await esperarCerrojo(c);
    if (!conCerrojo) {
      // Otro proceso está aplicando estas mismas migraciones idempotentes.
      console.warn("Self Storage: el esquema lo está aplicando otro proceso; se continúa sin repetirlo.");
      return;
    }
    for (const f of ficherosDeMigracion()) {
      const sql = fs.readFileSync(path.join(DIRECTORIO_MIGRACIONES, f), "utf8");
      try {
        await c.query("BEGIN");
        await c.query(sql);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw new Error(`Self Storage: falló la migración ${f}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }
  } finally {
    if (conCerrojo) await c.query("SELECT pg_advisory_unlock($1)", [CERROJO]).catch(() => {});
    c.release();
  }
}
