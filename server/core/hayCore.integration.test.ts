/**
 * `hayCore` y la consulta con la que el taller lee quién es cada técnico en
 * Core, contra Postgres y en un esquema propio (así se prueba también la base
 * SIN Core, que en `public` no se puede simular: otras pruebas crean la tabla).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const ESQUEMA = `prueba_hay_core_${process.pid}`;
const ALBERT = "1a1a1a1a-0000-4000-a000-000000000001";
const DE_BAJA = "1b1b1b1b-0000-4000-a000-000000000002";

let conexion: PoolClient;
let mod: typeof import("./hayCore.ts");

/** La misma forma que `GET /api/techs` en server/index.ts. */
async function tecnicos() {
  const { core, numero } = await mod.hayCore(conexion);
  const { rows } = await conexion.query(`
    SELECT t.name, t.employee_id
           ${
             core
               ? `, ${mod.NOMBRE_CORE_SQL} AS core_nombre,
                  ${numero ? "e.numero_trabajador" : "NULL::text"} AS core_numero,
                  e.activo AS core_activo`
               : ""
           }
      FROM techs t
      ${core ? "LEFT JOIN sea_employees e ON e.id = t.employee_id" : ""}
     ORDER BY t.id`);
  return rows;
}

beforeAll(async () => {
  if (!RUN) return;
  const db = (await import("../db.ts")).default;
  mod = await import("./hayCore.ts");
  conexion = await db.connect();
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}`);
  await conexion.query(`SET search_path = ${ESQUEMA}`);
  await conexion.query(`
    CREATE TABLE techs (id serial PRIMARY KEY, name text NOT NULL UNIQUE, employee_id uuid);
    INSERT INTO techs (name, employee_id) VALUES
      ('Albert', '${ALBERT}'), ('Pere', '${DE_BAJA}'), ('Suelto', NULL);
  `);
});

afterAll(async () => {
  if (!RUN) return;
  await conexion.query(`SET search_path = public; DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  conexion.release();
});

describe.runIf(RUN)("hayCore y la lectura de técnicos", () => {
  it("sin Core en la base: lo dice, y los técnicos salen como siempre", async () => {
    expect(await mod.hayCore(conexion)).toEqual({ core: false, numero: false, telefonoEmpresa: false });
    const filas = await tecnicos();
    expect(filas.map((f) => f.name)).toEqual(["Albert", "Pere", "Suelto"]);
    expect(filas[0]).not.toHaveProperty("core_nombre");
  });

  it("con Core pero sin la columna del número: nombre sí, número no", async () => {
    await conexion.query(`
      CREATE TABLE sea_employees (
        id uuid PRIMARY KEY, nombre text NOT NULL, apellidos text, activo boolean NOT NULL DEFAULT true
      );
      INSERT INTO sea_employees VALUES
        ('${ALBERT}', 'Albert', 'Belles Bertran', true),
        ('${DE_BAJA}', 'Pere', NULL, false);
    `);
    expect(await mod.hayCore(conexion)).toEqual({ core: true, numero: false, telefonoEmpresa: false });
    const [albert] = await tecnicos();
    expect(albert).toMatchObject({ core_nombre: "Albert Belles Bertran", core_numero: null, core_activo: true });
  });

  it("con todo: nombre completo, número, baja en Core, y el suelto sin datos", async () => {
    await conexion.query(`ALTER TABLE sea_employees ADD COLUMN numero_trabajador text`);
    await conexion.query(`UPDATE sea_employees SET numero_trabajador = '19' WHERE id = $1`, [ALBERT]);
    expect(await mod.hayCore(conexion)).toEqual({ core: true, numero: true, telefonoEmpresa: false });

    const [albert, pere, suelto] = await tecnicos();
    expect(albert).toMatchObject({ name: "Albert", core_nombre: "Albert Belles Bertran", core_numero: "19", core_activo: true });
    // Sin apellidos no queda un espacio colgando.
    expect(pere).toMatchObject({ name: "Pere", core_nombre: "Pere", core_activo: false });
    expect(suelto).toMatchObject({ name: "Suelto", core_nombre: null, core_numero: null, core_activo: null });
  });
});
