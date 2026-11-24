/**
 * Operarios del muelle en una base SIN Core (sin `sea_employees`): siguen
 * funcionando como antes, con su propio nombre. Esquema propio para que la
 * tabla de Core que crean otras pruebas en `public` no se vea.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const ESQUEMA = `prueba_rcp_sin_core_${process.pid}`;
const EMPRESA = "0c0c0c0c-0000-4000-a000-0000000000aa";

let conexion: PoolClient;
let repo: typeof import("./repository.ts");

beforeAll(async () => {
  if (!RUN) return;
  const db = (await import("../db.ts")).default;
  repo = await import("./repository.ts");
  conexion = await db.connect();
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}`);
  await conexion.query(`SET search_path = ${ESQUEMA}`);
  await conexion.query(`
    CREATE TABLE rcp_operarios (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      centro_id UUID,
      nombre TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      pin_salt TEXT NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT true,
      intentos_fallidos INTEGER NOT NULL DEFAULT 0,
      bloqueado_hasta TIMESTAMPTZ,
      creado_por UUID,
      creado_nombre TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      employee_id UUID,
      UNIQUE (empresa_id, nombre)
    )`);
});

afterAll(async () => {
  if (!RUN) return;
  await conexion.query(`SET search_path = public; DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  conexion.release();
});

describe.runIf(RUN)("operarios del muelle sin Core", () => {
  it("no hay Core, no hay personas que elegir", async () => {
    expect(await repo.hayCore(conexion)).toEqual({ core: false, numero: false, telefonoEmpresa: false });
    expect(await repo.empleadosCoreParaOperario(EMPRESA, conexion)).toBeNull();
  });

  it("se crean con su nombre, se listan y se renombran como siempre", async () => {
    const o = await repo.crearOperario(
      EMPRESA,
      { nombre: "Paco", centroId: null, pinHash: "h", pinSalt: "s", creadoPor: null, creadoNombre: null },
      conexion
    );
    expect(o).toMatchObject({ nombre: "Paco", enlazado: false, activo: true, bajaEnCore: false });
    expect(o).not.toHaveProperty("pinHash");

    const cambiado = await repo.actualizarOperario(EMPRESA, o.id, { nombre: "Paco Pérez" }, conexion);
    expect(cambiado?.nombre).toBe("Paco Pérez");
    expect((await repo.listarOperarios(EMPRESA, { soloActivos: true }, conexion)).map((x) => x.nombre)).toEqual(["Paco Pérez"]);
  });
});
