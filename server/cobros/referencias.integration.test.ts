/**
 * Referencias de cobro contra PostgreSQL de verdad.
 *
 * El reparto de números es de las cosas que no se pueden probar en memoria: lo
 * que hay que demostrar es que la BASE serializa dos peticiones simultáneas y
 * que nadie repite número, no que una función suma uno.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let referencias: typeof import("./referencias.ts");

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  referencias = await import("./referencias.ts");
  await (await import("../db.ts")).initDb();
});

describe.runIf(RUN)("referencias de cobro", () => {
  it("reparte números correlativos", async () => {
    const primera = Number(await referencias.siguienteReferencia(db));
    const segunda = Number(await referencias.siguienteReferencia(db));
    expect(segunda).toBe(primera + 1);
  });

  it("no da el mismo número a dos cobros creados a la vez", async () => {
    // Diez peticiones sin esperarse entre sí: si el contador se leyera y luego
    // se escribiera, aquí saldrían repetidos.
    const numeros = await Promise.all(
      Array.from({ length: 10 }, () => referencias.siguienteReferencia(db))
    );
    expect(new Set(numeros).size).toBe(10);
  });

  it("arranca por encima de las referencias que ya existían", async () => {
    // Producción viene de referencias tecleadas a mano: empezar en 1 chocaría
    // con ellas y "consultar estado" devolvería el cobro equivocado.
    await db.query(`DELETE FROM payment_counters WHERE clave = 'cobro'`);
    await db.query(
      `INSERT INTO payments (reference, amount_cents, status, created_at_ms)
       VALUES ('9041', 100, 'pending', $1)`,
      [Date.now()]
    );

    await referencias.initReferencias(db);

    expect(Number(await referencias.siguienteReferencia(db))).toBe(9042);

    await db.query(`DELETE FROM payments WHERE reference = '9041'`);
  });

  it("ignora las referencias que no son números al arrancar", async () => {
    await db.query(`DELETE FROM payment_counters WHERE clave = 'cobro'`);
    await db.query(
      `INSERT INTO payments (reference, amount_cents, status, created_at_ms)
       VALUES ('ABC-2026', 100, 'pending', $1)`,
      [Date.now()]
    );

    // Sin el filtro, el reference::integer de la siembra reventaría entero.
    await referencias.initReferencias(db);
    expect(Number(await referencias.siguienteReferencia(db))).toBe(1);

    await db.query(`DELETE FROM payments WHERE reference = 'ABC-2026'`);
  });
});
