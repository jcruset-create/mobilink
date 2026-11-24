/**
 * Número de trabajador contra una base de verdad: la migración tal cual se
 * pega en Supabase, el «único por empresa» y la ruta con su guardia de admin.
 *
 * Todo en un esquema propio: `sea_employees` es de Supabase y la base de
 * pruebas no la tiene.
 */

import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type RequestHandler } from "express";
import type { PoolClient } from "pg";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const ESQUEMA = `prueba_numero_trabajador_${process.pid}`;
const MIGRACION = readFileSync(
  new URL("../../supabase/migrations/core_numero_trabajador.sql", import.meta.url),
  "utf8"
);

const EMPRESA_A = "0a0a0a0a-0000-4000-a000-000000000001";
const EMPRESA_B = "0b0b0b0b-0000-4000-a000-000000000002";
const ANA = "1a1a1a1a-0000-4000-a000-000000000001"; // empresa A
const LUIS = "1b1b1b1b-0000-4000-a000-000000000002"; // empresa A
const OTRA_PERSONA = "1c1c1c1c-0000-4000-a000-000000000003"; // empresa B
const SIN_EMPRESA = "1d1d1d1d-0000-4000-a000-000000000004";

let conexion: PoolClient;
let mod: typeof import("./numeroTrabajador.ts");

beforeAll(async () => {
  if (!RUN) return;
  const db = (await import("../db.ts")).default;
  mod = await import("./numeroTrabajador.ts");
  conexion = await db.connect();
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}`);
  await conexion.query(`SET search_path = ${ESQUEMA}`);
  await conexion.query(`
    CREATE TABLE sea_companies (id uuid PRIMARY KEY, nombre text NOT NULL);
    CREATE TABLE sea_employees (
      id uuid PRIMARY KEY,
      company_id uuid REFERENCES sea_companies(id),
      nombre text NOT NULL,
      apellidos text,
      activo boolean NOT NULL DEFAULT true,
      updated_at timestamptz
    );
    INSERT INTO sea_companies VALUES ('${EMPRESA_A}', 'SEA'), ('${EMPRESA_B}', 'Otra');
    INSERT INTO sea_employees (id, company_id, nombre, apellidos) VALUES
      ('${ANA}', '${EMPRESA_A}', 'Ana', 'García'),
      ('${LUIS}', '${EMPRESA_A}', 'Luis', 'Martín'),
      ('${OTRA_PERSONA}', '${EMPRESA_B}', 'Persona', 'De Otra Empresa'),
      ('${SIN_EMPRESA}', NULL, 'Sin', 'Empresa');
  `);
});

afterAll(async () => {
  if (!RUN) return;
  await conexion.query(`SET search_path = public; DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  conexion.release();
});

describe.runIf(RUN)("número de trabajador", () => {
  it("sin la migración, la lectura dice que no está disponible y la escritura da 503", async () => {
    await expect(mod.listarNumerosTrabajador(conexion)).resolves.toEqual({ disponible: false, numeros: {} });
    await expect(mod.asignarNumeroTrabajador(ANA, "15", conexion)).rejects.toMatchObject({ status: 503 });
  });

  it("la migración entra y se puede ejecutar dos veces", async () => {
    await conexion.query(MIGRACION);
    await conexion.query(MIGRACION);
    const { rows } = await conexion.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'sea_employees'`,
      [ESQUEMA]
    );
    expect(rows.map((r) => r.indexname)).toContain("sea_employees_empresa_numero_trabajador_uq");
  });

  it("pone el número normalizado y se lee en la lista", async () => {
    const r = await mod.asignarNumeroTrabajador(ANA, " a15 ", conexion);
    expect(r).toMatchObject({ numeroTrabajador: "A15", anterior: null });
    const lista = await mod.listarNumerosTrabajador(conexion);
    expect(lista.disponible).toBe(true);
    expect(lista.numeros[ANA]).toBe("A15");
  });

  it("repetido en la misma empresa → 409 diciendo con quién choca", async () => {
    await expect(mod.asignarNumeroTrabajador(LUIS, "a15", conexion)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("Ana García"),
    });
  });

  it("el mismo número en otra empresa → permitido", async () => {
    await expect(mod.asignarNumeroTrabajador(OTRA_PERSONA, "A15", conexion)).resolves.toMatchObject({
      numeroTrabajador: "A15",
    });
  });

  it("el choque nunca nombra a nadie de otra empresa", async () => {
    // Persona (empresa B) tiene A15; Ana (empresa A) también. Si Luis pide A15,
    // el mensaje tiene que hablar de Ana y nunca de la de la otra empresa.
    const err = await mod.asignarNumeroTrabajador(LUIS, "A15", conexion).catch((e) => e);
    expect(err.message).not.toContain("Otra Empresa");
    // Y si en la empresa A no lo tiene nadie, no hay choque aunque B lo tenga.
    await conexion.query(`UPDATE sea_employees SET numero_trabajador = 'B9' WHERE id = $1`, [OTRA_PERSONA]);
    await expect(mod.asignarNumeroTrabajador(LUIS, "B9", conexion)).resolves.toMatchObject({
      numeroTrabajador: "B9",
    });
  });

  it("el índice lo para aunque alguien se salte el servidor", async () => {
    await expect(
      conexion.query(`UPDATE sea_employees SET numero_trabajador = 'A15' WHERE id = $1`, [LUIS])
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("sin empresa → 400; formato malo → 400; empleado que no existe → 404", async () => {
    await expect(mod.asignarNumeroTrabajador(SIN_EMPRESA, "1", conexion)).rejects.toMatchObject({
      status: 400,
      code: "SIN_EMPRESA",
    });
    await expect(mod.asignarNumeroTrabajador(ANA, "15#", conexion)).rejects.toMatchObject({ status: 400 });
    await expect(
      mod.asignarNumeroTrabajador("99999999-0000-4000-a000-000000000000", "1", conexion)
    ).rejects.toMatchObject({ status: 404 });
    await expect(mod.asignarNumeroTrabajador("no-es-un-id", "1", conexion)).rejects.toMatchObject({ status: 404 });
  });

  it("vacío quita el número (también a quien no tiene empresa)", async () => {
    await expect(mod.asignarNumeroTrabajador(ANA, "", conexion)).resolves.toMatchObject({
      numeroTrabajador: null,
      anterior: "A15",
    });
    await expect(mod.asignarNumeroTrabajador(SIN_EMPRESA, "", conexion)).resolves.toMatchObject({
      numeroTrabajador: null,
    });
  });

  it("la migración se para con un mensaje claro si hay repetidos", async () => {
    await conexion.query(`DROP INDEX sea_employees_empresa_numero_trabajador_uq`);
    await conexion.query(`UPDATE sea_employees SET numero_trabajador = 'X1' WHERE id IN ($1, $2)`, [ANA, LUIS]);
    await expect(conexion.query(MIGRACION)).rejects.toThrow(/core_numero_trabajador_informe\.sql/);
    await conexion.query(`UPDATE sea_employees SET numero_trabajador = NULL WHERE id = $1`, [LUIS]);
    await conexion.query(MIGRACION);
  });
});

describe.runIf(RUN)("ruta /api/core/empleados", () => {
  function servidor(esAdmin: boolean) {
    const autenticar: RequestHandler = (req, _res, next) => {
      (req as any).authCtx = { userId: "u1", empresaId: EMPRESA_A, esAdmin, esSuperadmin: false };
      next();
    };
    const app = express();
    app.use("/api/core/empleados", mod.createNumeroTrabajadorRouter({ autenticar, consultor: conexion }));
    return new Promise<{ url: string; cerrar: () => void }>((ok) => {
      const s = app.listen(0, () =>
        ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, cerrar: () => s.close() })
      );
    });
  }

  it("quien no es administrador no puede ni leer ni escribir", async () => {
    const { url, cerrar } = await servidor(false);
    try {
      expect((await fetch(`${url}/api/core/empleados/numeros-trabajador`)).status).toBe(403);
      const r = await fetch(`${url}/api/core/empleados/${LUIS}/numero-trabajador`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numeroTrabajador: "77" }),
      });
      expect(r.status).toBe(403);
    } finally {
      cerrar();
    }
  });

  it("el administrador lo pone, y el repetido sale como 409 con su mensaje", async () => {
    const { url, cerrar } = await servidor(true);
    try {
      const ok = await fetch(`${url}/api/core/empleados/${LUIS}/numero-trabajador`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numeroTrabajador: "77" }),
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ id: LUIS, numeroTrabajador: "77" });

      const choque = await fetch(`${url}/api/core/empleados/${ANA}/numero-trabajador`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numeroTrabajador: "77" }),
      });
      expect(choque.status).toBe(409);
      expect(await choque.json()).toMatchObject({ code: "REPETIDO", error: expect.stringContaining("Luis Martín") });

      const lista = await (await fetch(`${url}/api/core/empleados/numeros-trabajador`)).json();
      expect(lista.numeros[LUIS]).toBe("77");
    } finally {
      cerrar();
    }
  });
});
