/**
 * Enlazar trabajadores contra una base de verdad, en un esquema propio con las
 * tablas mínimas de cada módulo. La migración se ejecuta tal cual se pega en
 * Supabase.
 */

import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type RequestHandler } from "express";
import type { PoolClient } from "pg";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const ESQUEMA = `prueba_enlaces_${process.pid}`;
const MIGRACION = readFileSync(
  new URL("../../supabase/migrations/core_enlace_modulos.sql", import.meta.url),
  "utf8"
);

const SEA = "0a0a0a0a-0000-4000-a000-000000000001";
const MI_EMPRESA = "0e0e0e0e-0000-4000-a000-000000000001"; // cliente de la plataforma
const OTRA_EMPRESA = "0e0e0e0e-0000-4000-a000-000000000002";
const ALBERT = "1a1a1a1a-0000-4000-a000-000000000001";
const DANIEL = "1b1b1b1b-0000-4000-a000-000000000002";
const DE_BAJA = "1c1c1c1c-0000-4000-a000-000000000003";
const USR_MIO = "2a2a2a2a-0000-4000-a000-000000000001";
const USR_AJENO = "2b2b2b2b-0000-4000-a000-000000000002";
const ALM_1 = "3a3a3a3a-0000-4000-a000-000000000001";

const YO = { empresaId: MI_EMPRESA, esSuperadmin: false };
const SUPER = { empresaId: MI_EMPRESA, esSuperadmin: true };

let conexion: PoolClient;
let mod: typeof import("./enlaceTrabajadores.ts");

beforeAll(async () => {
  if (!RUN) return;
  const db = (await import("../db.ts")).default;
  mod = await import("./enlaceTrabajadores.ts");
  conexion = await db.connect();
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}`);
  await conexion.query(`SET search_path = ${ESQUEMA}`);
  await conexion.query(`
    CREATE TABLE sea_companies (id uuid PRIMARY KEY, nombre text NOT NULL);
    CREATE TABLE sea_employees (
      id uuid PRIMARY KEY, company_id uuid, nombre text NOT NULL, apellidos text,
      numero_trabajador text, activo boolean NOT NULL DEFAULT true
    );
    CREATE TABLE techs (
      id serial PRIMARY KEY, name text NOT NULL UNIQUE, blocked boolean NOT NULL DEFAULT false,
      employee_id uuid REFERENCES sea_employees(id) ON DELETE SET NULL
    );
    CREATE TABLE app_usuarios (
      id uuid PRIMARY KEY, username text, nombre text, activo boolean NOT NULL DEFAULT true,
      empresa_id uuid NOT NULL, employee_id uuid
    );
    -- Almacén y Recepciones, tal como están ANTES de la migración: sin employee_id.
    CREATE TABLE perfiles_usuario (
      id uuid PRIMARY KEY, nombre text, email text, rol text, activo boolean
    );
    CREATE TABLE rcp_operarios (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL,
      nombre text NOT NULL, activo boolean NOT NULL DEFAULT true
    );
    -- tc_usuarios no existe: TyreControl no está instalado en esta base.

    INSERT INTO sea_companies VALUES ('${SEA}', 'COMERCIAL SEA S.A.');
    INSERT INTO sea_employees (id, company_id, nombre, apellidos, numero_trabajador, activo) VALUES
      ('${ALBERT}', '${SEA}', 'Albert Belles Bertran', NULL, '19', true),
      ('${DANIEL}', '${SEA}', 'Daniel', 'Diaz Garcia', '10', true),
      ('${DE_BAJA}', '${SEA}', 'Pere', 'De Baja', '99', false);
    INSERT INTO techs (name, blocked) VALUES ('Albert', false), ('Daniel', false), ('Bloqueado', true);
    INSERT INTO app_usuarios (id, username, nombre, empresa_id) VALUES
      ('${USR_MIO}', 'dani', 'Daniel Diaz', '${MI_EMPRESA}'),
      ('${USR_AJENO}', 'otro', 'De Otra Empresa', '${OTRA_EMPRESA}');
    INSERT INTO perfiles_usuario VALUES ('${ALM_1}', 'Albert', 'a@x.es', 'operario', true);
    INSERT INTO rcp_operarios (empresa_id, nombre) VALUES ('${MI_EMPRESA}', 'Recepción 1');
  `);
});

afterAll(async () => {
  if (!RUN) return;
  await conexion.query(`SET search_path = public; DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  conexion.release();
});

const modulo = (r: Awaited<ReturnType<typeof mod.listarEnlaces>>, clave: string) =>
  r.modulos.find((m) => m.clave === clave)!;

describe.runIf(RUN)("enlazar trabajadores", () => {
  it("antes de la migración: lo que falta se dice, y lo que no está instalado también", async () => {
    const r = await mod.listarEnlaces(YO, conexion);
    expect(modulo(r, "taller").estado).toBe("ok");
    expect(modulo(r, "almacen").estado).toBe("sin_migrar");
    expect(modulo(r, "recepciones").estado).toBe("sin_migrar");
    expect(modulo(r, "tyrecontrol").estado).toBe("no_instalado");
    await expect(mod.enlazar("almacen", ALM_1, ALBERT, YO, conexion)).rejects.toMatchObject({ status: 503 });
  });

  it("la migración entra, se puede repetir y se salta la tabla que no existe", async () => {
    await conexion.query(MIGRACION);
    await conexion.query(MIGRACION);
    const r = await mod.listarEnlaces(YO, conexion);
    expect(modulo(r, "almacen").estado).toBe("ok");
    expect(modulo(r, "recepciones").estado).toBe("ok");
    expect(modulo(r, "tyrecontrol").estado).toBe("no_instalado");
  });

  it("lista solo lo activo, con el número de cada empleado y una pista por nombre", async () => {
    const r = await mod.listarEnlaces(YO, conexion);
    const taller = modulo(r, "taller");
    expect(taller.filas.map((f) => f.etiqueta)).toEqual(["Albert", "Daniel"]);
    expect(taller.filas[0].sugerencia).toMatchObject({ employeeId: ALBERT, numeroTrabajador: "19" });
    expect(r.empleados.map((e) => e.numeroTrabajador)).toEqual(["19", "10"]); // sin el de baja
  });

  it("enlaza y la lista lo enseña con su número", async () => {
    await mod.enlazar("taller", "1", ALBERT, YO, conexion);
    const taller = modulo(await mod.listarEnlaces(YO, conexion), "taller");
    expect(taller.filas[0].empleado).toMatchObject({ id: ALBERT, numeroTrabajador: "19", empresa: "COMERCIAL SEA S.A." });
    expect(taller.filas[0].sugerencia).toBeNull();
  });

  it("una persona no puede ser dos usuarios del mismo módulo, pero sí de módulos distintos", async () => {
    await expect(mod.enlazar("taller", "2", ALBERT, YO, conexion)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("«Albert»"),
    });
    await expect(mod.enlazar("almacen", ALM_1, ALBERT, YO, conexion)).resolves.toMatchObject({
      employeeId: ALBERT,
    });
  });

  it("no se enlaza a alguien de baja, ni a quien no existe, ni filas que no se ven", async () => {
    await expect(mod.enlazar("taller", "2", DE_BAJA, YO, conexion)).rejects.toMatchObject({ status: 400 });
    await expect(
      mod.enlazar("taller", "2", "99999999-0000-4000-a000-000000000000", YO, conexion)
    ).rejects.toMatchObject({ status: 404 });
    await expect(mod.enlazar("taller", "3", DANIEL, YO, conexion)).rejects.toMatchObject({ status: 404 }); // bloqueado
    await expect(mod.enlazar("nomina", "1", DANIEL, YO, conexion)).rejects.toMatchObject({ status: 404 });
  });

  it("usuarios de otra empresa de la plataforma: ni se ven ni se tocan; el superadmin sí", async () => {
    const mio = modulo(await mod.listarEnlaces(YO, conexion), "administracion");
    expect(mio.filas.map((f) => f.id)).toEqual([USR_MIO]);
    await expect(mod.enlazar("administracion", USR_AJENO, DANIEL, YO, conexion)).rejects.toMatchObject({
      status: 404,
    });
    const todos = modulo(await mod.listarEnlaces(SUPER, conexion), "administracion");
    expect(todos.filas.map((f) => f.id).sort()).toEqual([USR_MIO, USR_AJENO].sort());
  });

  it("desenlazar deja la fila libre", async () => {
    await expect(mod.enlazar("taller", "1", null, YO, conexion)).resolves.toMatchObject({
      employeeId: null,
      anterior: ALBERT,
    });
    await expect(mod.enlazar("taller", "2", ALBERT, YO, conexion)).resolves.toMatchObject({ employeeId: ALBERT });
  });
});

describe.runIf(RUN)("ruta /api/core/enlaces", () => {
  function servidor(esAdmin: boolean) {
    const autenticar: RequestHandler = (req, _res, next) => {
      (req as any).authCtx = { userId: "u1", empresaId: MI_EMPRESA, esAdmin, esSuperadmin: false };
      next();
    };
    const app = express();
    app.use("/api/core/enlaces", mod.createEnlaceTrabajadoresRouter({ autenticar, consultor: conexion }));
    return new Promise<{ url: string; cerrar: () => void }>((ok) => {
      const s = app.listen(0, () =>
        ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, cerrar: () => s.close() })
      );
    });
  }

  it("quien no es administrador no puede ni leer ni enlazar", async () => {
    const { url, cerrar } = await servidor(false);
    try {
      expect((await fetch(`${url}/api/core/enlaces`)).status).toBe(403);
      const r = await fetch(`${url}/api/core/enlaces/taller/1`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: DANIEL }),
      });
      expect(r.status).toBe(403);
    } finally {
      cerrar();
    }
  });

  it("el administrador enlaza, y el choque sale como 409 con su mensaje", async () => {
    const { url, cerrar } = await servidor(true);
    try {
      const ok = await fetch(`${url}/api/core/enlaces/taller/1`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: DANIEL }),
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ modulo: "taller", id: "1", employeeId: DANIEL });

      const choque = await fetch(`${url}/api/core/enlaces/taller/2`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: DANIEL }),
      });
      expect(choque.status).toBe(409);
      expect(await choque.json()).toMatchObject({ code: "OCUPADO" });

      const lista = await (await fetch(`${url}/api/core/enlaces`)).json();
      expect(lista.modulos.map((m: any) => m.clave)).toEqual([
        "taller", "administracion", "almacen", "recepciones", "tyrecontrol",
      ]);
    } finally {
      cerrar();
    }
  });
});
