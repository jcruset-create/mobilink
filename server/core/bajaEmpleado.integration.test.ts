/**
 * La baja en Core es la baja en todos los módulos. Contra Postgres, en un
 * esquema propio con las tablas mínimas de cada módulo.
 */

import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type RequestHandler } from "express";
import type { PoolClient } from "pg";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const ESQUEMA = `prueba_baja_empleado_${process.pid}`;

const ALBERT = "1a1a1a1a-0000-4000-a000-000000000001"; // está en todos los módulos
const ADMIN = "1b1b1b1b-0000-4000-a000-000000000002"; // el administrador que da las bajas
const SUELTO = "1c1c1c1c-0000-4000-a000-000000000003"; // no está en ningún módulo
const USR_ALBERT = "2a2a2a2a-0000-4000-a000-000000000001";
const USR_ADMIN = "2b2b2b2b-0000-4000-a000-000000000002";

let conexion: PoolClient;
let mod: typeof import("./bajaEmpleado.ts");

const uno = async (sql: string, params: unknown[] = []) => (await conexion.query(sql, params)).rows[0];

beforeAll(async () => {
  if (!RUN) return;
  const db = (await import("../db.ts")).default;
  mod = await import("./bajaEmpleado.ts");
  conexion = await db.connect();
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}`);
  await conexion.query(`SET search_path = ${ESQUEMA}`);
  await conexion.query(`
    CREATE TABLE sea_employees (
      id uuid PRIMARY KEY, nombre text NOT NULL, apellidos text,
      activo boolean NOT NULL DEFAULT true, fecha_baja date, updated_at timestamptz
    );
    CREATE TABLE techs (
      id serial PRIMARY KEY, name text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'disponible',
      blocked boolean NOT NULL DEFAULT false, activo boolean DEFAULT true, "currentJobId" integer,
      "roadsideOperatorCode" text, "workshopPin" text, "statusChangedAtMs" bigint, employee_id uuid
    );
    CREATE TABLE perfiles_usuario (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text, email text, activo boolean, employee_id uuid);
    -- tc_usuarios SIN employee_id: como una base donde core_enlace_modulos.sql no se ha ejecutado.
    CREATE TABLE tc_usuarios (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text, activo boolean NOT NULL DEFAULT true);
    CREATE TABLE app_usuarios (
      id uuid PRIMARY KEY, username text NOT NULL, activo boolean NOT NULL DEFAULT true,
      employee_id uuid, updated_at timestamptz
    );

    INSERT INTO sea_employees (id, nombre, apellidos) VALUES
      ('${ALBERT}', 'Albert', 'Belles Bertran'), ('${ADMIN}', 'Lourdes', 'Migens'), ('${SUELTO}', 'Suelto', NULL);
    INSERT INTO techs (name, "currentJobId", "roadsideOperatorCode", "workshopPin", employee_id) VALUES
      ('Albert', 77, '1234', '5678', '${ALBERT}'),
      ('Otro', 78, '1111', '2222', NULL);
    INSERT INTO perfiles_usuario (nombre, email, activo, employee_id) VALUES
      ('Albert', 'albert@x.es', true, '${ALBERT}'), ('Otra', 'otra@x.es', true, NULL);
    INSERT INTO tc_usuarios (nombre) VALUES ('Albert TC');
    INSERT INTO app_usuarios (id, username, employee_id) VALUES
      ('${USR_ALBERT}', 'albert', '${ALBERT}'), ('${USR_ADMIN}', 'lourdes', '${ADMIN}');
  `);
});

afterAll(async () => {
  if (!RUN) return;
  await conexion.query(`SET search_path = public; DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  conexion.release();
});

describe.runIf(RUN)("baja de un empleado en Core", () => {
  it("nadie se da de baja a sí mismo, y no se queda a medias", async () => {
    await expect(mod.cambiarActivoEmpleado(ADMIN, false, USR_ADMIN, conexion)).rejects.toMatchObject({
      status: 409,
      code: "UNO_MISMO",
    });
    expect((await uno(`SELECT activo FROM sea_employees WHERE id = $1`, [ADMIN])).activo).toBe(true);
    expect((await uno(`SELECT activo FROM app_usuarios WHERE id = $1`, [USR_ADMIN])).activo).toBe(true);
  });

  it("da de baja en Core y en todos los módulos donde está enlazado", async () => {
    const r = await mod.cambiarActivoEmpleado(ALBERT, false, USR_ADMIN, conexion);
    expect(r).toMatchObject({ activo: false, nombre: "Albert Belles Bertran", sigueDeBajaEn: [] });
    expect(r.bajaEn).toEqual([
      { clave: "taller", nombre: "Taller", usuarios: ["Albert"] },
      { clave: "almacen", nombre: "Almacén", usuarios: ["Albert"] },
      { clave: "acceso", nombre: "Acceso web", usuarios: ["albert"] },
    ]);

    const core = await uno(`SELECT activo, fecha_baja FROM sea_employees WHERE id = $1`, [ALBERT]);
    expect(core.activo).toBe(false);
    expect(core.fecha_baja).not.toBeNull();

    // Taller: como la baja de la pantalla Técnicos — sin trabajo y sin PIN.
    expect(await uno(`SELECT * FROM techs WHERE name = 'Albert'`)).toMatchObject({
      activo: false,
      status: "baja",
      blocked: true,
      currentJobId: null,
      roadsideOperatorCode: null,
      workshopPin: null,
    });
    expect((await uno(`SELECT activo FROM perfiles_usuario WHERE email = 'albert@x.es'`)).activo).toBe(false);
    expect((await uno(`SELECT activo FROM app_usuarios WHERE id = $1`, [USR_ALBERT])).activo).toBe(false);
  });

  it("no toca a nadie más, ni la tabla del módulo que no tiene employee_id", async () => {
    expect(await uno(`SELECT * FROM techs WHERE name = 'Otro'`)).toMatchObject({
      activo: true,
      status: "disponible",
      currentJobId: 78,
      workshopPin: "2222",
    });
    expect((await uno(`SELECT activo FROM perfiles_usuario WHERE email = 'otra@x.es'`)).activo).toBe(true);
    expect((await uno(`SELECT activo FROM tc_usuarios WHERE nombre = 'Albert TC'`)).activo).toBe(true);
    expect((await uno(`SELECT activo FROM app_usuarios WHERE id = $1`, [USR_ADMIN])).activo).toBe(true);
  });

  it("dar de baja dos veces no rompe nada ni repite el efecto", async () => {
    const r = await mod.cambiarActivoEmpleado(ALBERT, false, USR_ADMIN, conexion);
    expect(r.bajaEn).toEqual([]);
  });

  it("volver a dar de alta en Core NO reactiva los módulos, y dice dónde sigue de baja", async () => {
    const r = await mod.cambiarActivoEmpleado(ALBERT, true, USR_ADMIN, conexion);
    expect(r.activo).toBe(true);
    expect(r.bajaEn).toEqual([]);
    expect(r.sigueDeBajaEn.map((m) => m.clave)).toEqual(["taller", "almacen", "acceso"]);

    const core = await uno(`SELECT activo, fecha_baja FROM sea_employees WHERE id = $1`, [ALBERT]);
    expect(core).toMatchObject({ activo: true, fecha_baja: null });
    expect((await uno(`SELECT activo FROM techs WHERE name = 'Albert'`)).activo).toBe(false);
    expect((await uno(`SELECT activo FROM app_usuarios WHERE id = $1`, [USR_ALBERT])).activo).toBe(false);
  });

  it("quien no está en ningún módulo se da de baja solo en Core; quien no existe, 404", async () => {
    const r = await mod.cambiarActivoEmpleado(SUELTO, false, USR_ADMIN, conexion);
    expect(r).toMatchObject({ activo: false, bajaEn: [] });
    await expect(
      mod.cambiarActivoEmpleado("99999999-0000-4000-a000-000000000000", false, USR_ADMIN, conexion)
    ).rejects.toMatchObject({ status: 404 });
    await expect(mod.cambiarActivoEmpleado("no-es-un-id", false, USR_ADMIN, conexion)).rejects.toMatchObject({ status: 404 });
  });
});

describe.runIf(RUN)("ruta /api/core/empleados/:id/activo", () => {
  function servidor(esAdmin: boolean) {
    const autenticar: RequestHandler = (req, _res, next) => {
      (req as any).authCtx = { userId: USR_ADMIN, empresaId: "0e0e0e0e-0000-4000-a000-000000000001", esAdmin, esSuperadmin: false };
      next();
    };
    const app = express();
    app.use("/api/core/empleados", mod.createBajaEmpleadoRouter({ autenticar, ejecutor: conexion as any }));
    return new Promise<{ url: string; cerrar: () => void }>((ok) => {
      const s = app.listen(0, () =>
        ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, cerrar: () => s.close() })
      );
    });
  }
  const poner = (url: string, id: string, cuerpo: unknown) =>
    fetch(`${url}/api/core/empleados/${id}/activo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });

  it("quien no es administrador no puede dar bajas", async () => {
    const { url, cerrar } = await servidor(false);
    try {
      expect((await poner(url, SUELTO, { activo: true })).status).toBe(403);
      expect((await uno(`SELECT activo FROM sea_employees WHERE id = $1`, [SUELTO])).activo).toBe(false);
    } finally {
      cerrar();
    }
  });

  it("el administrador sí; sin decir activo → 400; a sí mismo → 409", async () => {
    const { url, cerrar } = await servidor(true);
    try {
      expect((await poner(url, SUELTO, {})).status).toBe(400);
      const r = await poner(url, SUELTO, { activo: true });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ id: SUELTO, activo: true });
      const yo = await poner(url, ADMIN, { activo: false });
      expect(yo.status).toBe(409);
      expect(await yo.json()).toMatchObject({ code: "UNO_MISMO" });
    } finally {
      cerrar();
    }
  });
});
