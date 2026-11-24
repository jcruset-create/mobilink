/**
 * Teléfono de empresa contra Postgres: la migración tal cual se pega en
 * Supabase (incluido el paso que trae a Core los teléfonos de Taller), lo que
 * ve el cliente y la ruta con su guardia de administrador. Esquema propio.
 */

import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type RequestHandler } from "express";
import type { PoolClient } from "pg";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const ESQUEMA = `prueba_tel_empresa_${process.pid}`;
const MIGRACION = readFileSync(
  new URL("../../supabase/migrations/core_telefono_empresa.sql", import.meta.url),
  "utf8"
);

const ALBERT = "1a1a1a1a-0000-4000-a000-000000000001"; // técnico con teléfono en Taller
const DANIEL = "1b1b1b1b-0000-4000-a000-000000000002"; // técnico sin teléfono en Taller
const OFICINA = "1c1c1c1c-0000-4000-a000-000000000003"; // no es técnico

let conexion: PoolClient;
let mod: typeof import("./telefonoEmpresa.ts");

const telEmpresa = async (id: string) =>
  (await conexion.query(`SELECT telefono_empresa FROM sea_employees WHERE id = $1`, [id])).rows[0].telefono_empresa;

beforeAll(async () => {
  if (!RUN) return;
  const db = (await import("../db.ts")).default;
  mod = await import("./telefonoEmpresa.ts");
  conexion = await db.connect();
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}`);
  await conexion.query(`SET search_path = ${ESQUEMA}`);
  await conexion.query(`
    CREATE TABLE sea_employees (
      id uuid PRIMARY KEY, nombre text NOT NULL, apellidos text, telefono text,
      activo boolean NOT NULL DEFAULT true, updated_at timestamptz
    );
    CREATE TABLE techs (
      id serial PRIMARY KEY, name text NOT NULL UNIQUE, phone text, employee_id uuid
    );
    INSERT INTO sea_employees (id, nombre, telefono) VALUES
      ('${ALBERT}', 'Albert', '622 22 22 22'),
      ('${DANIEL}', 'Daniel', '633333333'),
      ('${OFICINA}', 'Lourdes', NULL);
    INSERT INTO techs (name, phone, employee_id) VALUES
      ('Albert', '600 11 22 33', '${ALBERT}'),
      ('Daniel', '   ', '${DANIEL}'),
      ('Suelto', '699999999', NULL);
  `);
});

afterAll(async () => {
  if (!RUN) return;
  await conexion.query(`SET search_path = public; DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  conexion.release();
});

describe.runIf(RUN)("teléfono de empresa", () => {
  it("antes de la migración: el cliente ve el del taller, y guardar da 503", async () => {
    expect(await mod.telefonoDeTecnicoParaCliente("Albert", conexion)).toBe("600 11 22 33");
    await expect(mod.guardarTelefonoEmpresa(ALBERT, "611111111", conexion)).rejects.toMatchObject({ status: 503 });
  });

  it("la migración trae a Core el teléfono de Taller de los enlazados, limpio", async () => {
    await conexion.query(MIGRACION);
    expect(await telEmpresa(ALBERT)).toBe("600112233");
    // Un teléfono en blanco no es un teléfono; quien no es técnico no recibe nada.
    expect(await telEmpresa(DANIEL)).toBeNull();
    expect(await telEmpresa(OFICINA)).toBeNull();
    // El personal y el del taller no se tocan.
    const { rows } = await conexion.query(`SELECT telefono FROM sea_employees WHERE id = $1`, [ALBERT]);
    expect(rows[0].telefono).toBe("622 22 22 22");
    expect((await conexion.query(`SELECT phone FROM techs WHERE name = 'Albert'`)).rows[0].phone).toBe("600 11 22 33");
  });

  it("volver a ejecutarla no pisa lo que ya se ha puesto en Core", async () => {
    await mod.guardarTelefonoEmpresa(ALBERT, "+34 611 111 111", conexion);
    await conexion.query(MIGRACION);
    expect(await telEmpresa(ALBERT)).toBe("+34611111111");
  });

  it("el cliente ve el de empresa del enlazado; nunca el personal ni el viejo del taller", async () => {
    expect(await mod.telefonoDeTecnicoParaCliente("Albert", conexion)).toBe("+34611111111");
    // Daniel tiene personal en Core pero no de empresa: el cliente no ve nada.
    expect(await mod.telefonoDeTecnicoParaCliente("Daniel", conexion)).toBeNull();
    // Quitárselo en Core no hace reaparecer el que quedó en Taller.
    await mod.guardarTelefonoEmpresa(ALBERT, "", conexion);
    expect(await mod.telefonoDeTecnicoParaCliente("Albert", conexion)).toBeNull();
  });

  it("el técnico sin enlazar sigue con el teléfono del taller", async () => {
    expect(await mod.telefonoDeTecnicoParaCliente("Suelto", conexion)).toBe("699999999");
    expect(await mod.telefonoDeTecnicoParaCliente("No existe", conexion)).toBeNull();
  });

  it("formato malo → 400; empleado que no existe → 404", async () => {
    await expect(mod.guardarTelefonoEmpresa(ALBERT, "61047ABC", conexion)).rejects.toMatchObject({ status: 400 });
    await expect(
      mod.guardarTelefonoEmpresa("99999999-0000-4000-a000-000000000000", "611111111", conexion)
    ).rejects.toMatchObject({ status: 404 });
    await expect(mod.guardarTelefonoEmpresa("no-es-un-id", "611111111", conexion)).rejects.toMatchObject({ status: 404 });
  });
});

describe.runIf(RUN)("ruta /api/core/empleados/:id/telefono-empresa", () => {
  function servidor(esAdmin: boolean) {
    const autenticar: RequestHandler = (req, _res, next) => {
      (req as any).authCtx = { userId: "u1", empresaId: "0e0e0e0e-0000-4000-a000-000000000001", esAdmin, esSuperadmin: false };
      next();
    };
    const app = express();
    app.use("/api/core/empleados", mod.createTelefonoEmpresaRouter({ autenticar, consultor: conexion }));
    return new Promise<{ url: string; cerrar: () => void }>((ok) => {
      const s = app.listen(0, () =>
        ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, cerrar: () => s.close() })
      );
    });
  }
  const poner = (url: string, id: string, telefonoEmpresa: string) =>
    fetch(`${url}/api/core/empleados/${id}/telefono-empresa`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telefonoEmpresa }),
    });

  it("quien no es administrador no puede cambiarlo", async () => {
    const { url, cerrar } = await servidor(false);
    try {
      expect((await poner(url, DANIEL, "644444444")).status).toBe(403);
      expect(await telEmpresa(DANIEL)).toBeNull();
    } finally {
      cerrar();
    }
  });

  it("el administrador lo pone, normalizado", async () => {
    const { url, cerrar } = await servidor(true);
    try {
      const r = await poner(url, DANIEL, "644 44 44 44");
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ id: DANIEL, telefonoEmpresa: "644444444" });
      expect((await poner(url, DANIEL, "abc")).status).toBe(400);
    } finally {
      cerrar();
    }
  });
});
