/**
 * `tc_vehiculo_seguimiento` contra PostgreSQL de verdad.
 *
 * Lo que se prueba aquí son las dos reglas que el encargo pedía y que NO
 * pueden vivir en el formulario del panel:
 *
 *   · el motivo es obligatorio al quitar el seguimiento;
 *   · esto lo cambia un administrador y nadie más.
 *
 * Si las dos reglas estuvieran solo en la pantalla, cualquier llamada directa
 * a la API las saltaría, y lo que quedaría es un vehículo que ha dejado de
 * contar en los informes sin que nadie sepa por qué ni quién.
 *
 * Sin `RUN_DB_TESTS=1` no hace nada.
 */

import { readFileSync } from "node:fs";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CORRE = process.env.RUN_DB_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const describeSiHayBase = CORRE ? describe : describe.skip;

const RAIZ = new URL("../../", import.meta.url).pathname;
const MIGRACION = `${RAIZ}supabase/migrations/tyrecontrol_vehiculos_en_seguimiento.sql`;
const ESQUEMA = "pruebas_seguimiento";

const EMPRESA = "00000000-0000-4000-c000-00000000000a";
const OTRA    = "00000000-0000-4000-c000-00000000000b";

describeSiHayBase("tc_vehiculo_seguimiento", () => {
  let db: Client;
  let vehiculo: string;

  /** Quién se supone que llama. Los stubs se reescriben en cada prueba. */
  async function comoUsuario(rol: "superadmin" | "admin" | "otro", empresa = EMPRESA) {
    await db.query(`
      create or replace function ${ESQUEMA}.tc_is_superadmin() returns boolean
        language sql stable as $$ select ${rol === "superadmin"} $$;
      create or replace function ${ESQUEMA}.tc_is_admin() returns boolean
        language sql stable as $$ select ${rol === "admin"} $$;
      create or replace function ${ESQUEMA}.tc_auth_empresa_id() returns uuid
        language sql stable as $$ select '${empresa}'::uuid $$;
    `);
  }

  const estado = async () => (await db.query(
    `select en_seguimiento, seguimiento_motivo, seguimiento_cambiado_en
       from ${ESQUEMA}.tc_vehiculos where id = $1`, [vehiculo],
  )).rows[0];

  const cambiar = (quiere: boolean, motivo: string | null = null) =>
    db.query(`select ${ESQUEMA}.tc_vehiculo_seguimiento($1, $2, $3)`, [vehiculo, quiere, motivo]);

  beforeAll(async () => {
    db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query(`drop schema if exists ${ESQUEMA} cascade`);
    await db.query(`create schema ${ESQUEMA}`);
    await db.query(`set search_path = ${ESQUEMA}, public`);
    await db.query(`
      create table tc_usuarios (id uuid primary key, nombre text);
      create table tc_vehiculos (
        id uuid primary key default gen_random_uuid(),
        empresa_id uuid not null, matricula text not null, activo boolean not null default true,
        updated_at timestamptz not null default now());
      -- auth.uid() no existe en este banco: se finge como null, que es lo que
      -- devuelve cuando escribe un proceso sin sesión.
      create schema if not exists auth;
      create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    `);
    await comoUsuario("superadmin");

    const cargado = readFileSync(MIGRACION, "utf8")
      .replace(/public\.tc_vehiculo_seguimiento/g, `${ESQUEMA}.tc_vehiculo_seguimiento`)
      // Sin comillas: `set search_path to 'a, b'` es UN nombre de esquema con
      // una coma dentro, no dos esquemas. Costó un rato.
      .replace(/search_path to 'public'/g, `search_path to ${ESQUEMA}, public, auth`)
      .replace(/^grant .*$/gm, "");
    await db.query(cargado);

    const { rows } = await db.query(
      `insert into ${ESQUEMA}.tc_vehiculos (empresa_id, matricula) values ($1,'1654KWF') returning id`,
      [EMPRESA],
    );
    vehiculo = rows[0].id as string;
  }, 60_000);

  afterAll(async () => {
    if (db) { await db.query(`drop schema if exists ${ESQUEMA} cascade`); await db.end(); }
  });

  it("los vehículos nacen con seguimiento: la migración no cambia nada", async () => {
    const v = await estado();
    expect(v.en_seguimiento).toBe(true);
    expect(v.seguimiento_motivo).toBeNull();
  });

  it("no se puede quitar el seguimiento sin motivo", async () => {
    await expect(cambiar(false, null)).rejects.toThrow(/motivo/i);
    await expect(cambiar(false, "   ")).rejects.toThrow(/motivo/i);
    expect((await estado()).en_seguimiento).toBe(true);
  });

  it("con motivo sí, y se guarda con la fecha", async () => {
    await cambiar(false, "  No está en el contrato  ");
    const v = await estado();
    expect(v.en_seguimiento).toBe(false);
    expect(v.seguimiento_motivo).toBe("No está en el contrato");   // sin los espacios
    expect(v.seguimiento_cambiado_en).not.toBeNull();
  });

  it("devolverlo no pide motivo, y borra el que había", async () => {
    await cambiar(true);
    const v = await estado();
    expect(v.en_seguimiento).toBe(true);
    // Si se quedara, la ficha explicaría una situación que ya no se da.
    expect(v.seguimiento_motivo).toBeNull();
  });

  it("un administrador de OTRA empresa no puede", async () => {
    await comoUsuario("admin", OTRA);
    await expect(cambiar(false, "me apetece")).rejects.toThrow(/administrador/i);
    expect((await estado()).en_seguimiento).toBe(true);
  });

  it("quien no es administrador tampoco", async () => {
    await comoUsuario("otro");
    await expect(cambiar(false, "me apetece")).rejects.toThrow(/administrador/i);
    expect((await estado()).en_seguimiento).toBe(true);
  });

  it("el administrador de SU empresa sí", async () => {
    await comoUsuario("admin", EMPRESA);
    await cambiar(false, "Fuera del contrato");
    expect((await estado()).en_seguimiento).toBe(false);
    await cambiar(true);
  });

  it("un vehículo que no existe se dice, no se traga", async () => {
    await comoUsuario("superadmin");
    await expect(db.query(
      `select ${ESQUEMA}.tc_vehiculo_seguimiento($1, false, 'x')`,
      ["00000000-0000-4000-c000-0000000000ff"],
    )).rejects.toThrow(/no encontrado/i);
  });
});
