/**
 * Talleres de una empresa: alta, cambio de nombre y baja.
 *
 * Todo en un esquema propio y con una sola conexión: `app_centros` es de la
 * fundación SaaS, que la base de pruebas no tiene, y crearla en `public`
 * cambiaría cómo se comportan las pruebas de caja que miran si existe.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const ESQUEMA = `prueba_centros_${process.pid}`;
const EMPRESA = "0c0c0c0c-0000-4000-a000-000000000001";

let conexion: PoolClient;
let centros: typeof import("./centros.ts");

beforeAll(async () => {
  if (!RUN) return;
  const db = (await import("../db.ts")).default;
  centros = await import("./centros.ts");
  conexion = await db.connect();
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}`);
  await conexion.query(`SET search_path = ${ESQUEMA}`);
  await conexion.query(`
    CREATE TABLE app_empresas (id uuid PRIMARY KEY, nombre text NOT NULL);
    CREATE TABLE app_centros (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id uuid NOT NULL REFERENCES app_empresas(id),
      nombre text NOT NULL,
      direccion text,
      activo boolean NOT NULL DEFAULT true
    );
    CREATE TABLE cash_registers (
      id serial PRIMARY KEY,
      empresa_id uuid NOT NULL,
      centro text NOT NULL DEFAULT '',
      centro_id uuid,
      nombre text NOT NULL,
      activa boolean NOT NULL DEFAULT true,
      UNIQUE (empresa_id, centro, nombre)
    );
    INSERT INTO app_empresas VALUES ('${EMPRESA}', 'SEA');
  `);
});

afterAll(async () => {
  if (!RUN) return;
  await conexion.query(`SET search_path = public; DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  conexion.release();
});

describe.runIf(RUN)("talleres de una empresa", () => {
  it("se da de alta un taller nuevo y sale en la lista", async () => {
    const t = await centros.crearCentro(EMPRESA, { nombre: "  Agroreus  ", direccion: "Reus" }, conexion);
    expect(t).toMatchObject({ nombre: "Agroreus", direccion: "Reus", activo: true, cajas: 0 });
    const lista = await centros.listarCentrosDeEmpresa(EMPRESA, conexion);
    expect(lista.map((c) => c.nombre)).toContain("Agroreus");
  });

  it("no deja dos talleres con el mismo nombre, ni nombres vacíos", async () => {
    await expect(centros.crearCentro(EMPRESA, { nombre: "agroreus " }, conexion)).rejects.toMatchObject({
      status: 409,
    });
    await expect(centros.crearCentro(EMPRESA, { nombre: " " }, conexion)).rejects.toMatchObject({ status: 400 });
    await expect(
      centros.crearCentro("0c0c0c0c-0000-4000-a000-00000000ffff", { nombre: "Otro" }, conexion)
    ).rejects.toMatchObject({ status: 404 });
    await expect(centros.crearCentro("no-es-un-id", { nombre: "Otro" }, conexion)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("renombrar el taller renombra también el de sus cajas", async () => {
    const t = await centros.crearCentro(EMPRESA, { nombre: "Tarragona" }, conexion);
    await conexion.query(
      `INSERT INTO cash_registers (empresa_id, centro, centro_id, nombre) VALUES ($1, 'Tarragona', $2, 'Caja Mostrador')`,
      [EMPRESA, t.id]
    );
    const { centro } = await centros.actualizarCentro(t.id, { nombre: "Taller Tarragona" }, conexion);
    expect(centro).toMatchObject({ nombre: "Taller Tarragona", cajas: 1 });
    const { rows } = await conexion.query(`SELECT centro FROM cash_registers WHERE centro_id = $1`, [t.id]);
    expect(rows[0].centro).toBe("Taller Tarragona");

    await expect(centros.actualizarCentro(t.id, { nombre: "Agroreus" }, conexion)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("un taller con cajas activas no se da de baja; sin cajas, sí", async () => {
    const lista = await centros.listarCentrosDeEmpresa(EMPRESA, conexion);
    const conCaja = lista.find((c) => c.cajas > 0)!;
    await expect(centros.actualizarCentro(conCaja.id, { activo: false }, conexion)).rejects.toMatchObject({
      status: 409,
    });

    const agroreus = lista.find((c) => c.nombre === "Agroreus")!;
    const { centro } = await centros.actualizarCentro(agroreus.id, { activo: false }, conexion);
    expect(centro.activo).toBe(false);
    const { centro: otraVez } = await centros.actualizarCentro(agroreus.id, { activo: true }, conexion);
    expect(otraVez.activo).toBe(true);
  });
});
