/**
 * La foto del empleado contra Postgres, con un almacén de mentira (en las
 * pruebas no hay Supabase) y alguien que «mira» la foto en vez de la IA.
 */

import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type RequestHandler } from "express";
import type { PoolClient } from "pg";
import sharp from "sharp";

import type { Mirada } from "./fotoNormalizar.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const ESQUEMA = `prueba_foto_empleado_${process.pid}`;
const ANA = "1a1a1a1a-0000-4000-a000-000000000001";
const PEP = "1b1b1b1b-0000-4000-a000-000000000002";

let conexion: PoolClient;
let mod: typeof import("./fotoEmpleado.ts");
let FOTO: Buffer;

/** Lo que hay guardado. `firmar` devuelve una dirección reconocible. */
const guardado = new Map<string, Buffer>();
const almacen = {
  async subir(ruta: string, jpeg: Buffer) { guardado.set(ruta, jpeg); },
  async borrar(ruta: string) { guardado.delete(ruta); },
  async firmar(rutas: string[]) {
    return Object.fromEntries(rutas.filter((r) => guardado.has(r)).map((r) => [r, `https://firmada.invalid/${r}?token=x`]));
  },
};

const UNA_CARA: Mirada = { caras: 1, cara: { x: 0.35, y: 0.2, w: 0.3, h: 0.3 }, seVeBien: true, motivo: "" };
let mirada: Mirada | null = UNA_CARA;
const localizar = async () => mirada;
const deps = () => ({ consultor: conexion, almacen, localizar });

const fotoUrl = async (id: string) => (await conexion.query(`SELECT foto_url FROM sea_employees WHERE id = $1`, [id])).rows[0].foto_url;

beforeAll(async () => {
  if (!RUN) return;
  const db = (await import("../db.ts")).default;
  mod = await import("./fotoEmpleado.ts");
  conexion = await db.connect();
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}`);
  await conexion.query(`SET search_path = ${ESQUEMA}`);
  await conexion.query(`
    CREATE TABLE sea_employees (id uuid PRIMARY KEY, nombre text NOT NULL, foto_url text, updated_at timestamptz);
    INSERT INTO sea_employees (id, nombre) VALUES ('${ANA}', 'Ana'), ('${PEP}', 'Pep');
  `);
  FOTO = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#808080" } }).jpeg().toBuffer();
});

afterAll(async () => {
  if (!RUN) return;
  await conexion.query(`SET search_path = public; DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  conexion.release();
});

describe.runIf(RUN)("foto del empleado", () => {
  it("se guarda normalizada, en su ruta, y la ficha apunta a ella", async () => {
    const r = await mod.ponerFoto(ANA, { buffer: FOTO, mimetype: "image/jpeg" }, {}, deps());
    const ruta = mod.rutaDeFoto(ANA);
    expect(await fotoUrl(ANA)).toBe(ruta);
    expect(r).toEqual({ url: `https://firmada.invalid/${ruta}?token=x`, aviso: null });

    const meta = await sharp(guardado.get(ruta)!).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([600, 600, "jpeg"]);
    expect(await mod.tieneFoto(ANA, conexion)).toBe(true);
    expect(await mod.tieneFoto(PEP, conexion)).toBe(false);
  });

  it("en la ficha queda la ruta dentro del bucket, nunca una dirección", async () => {
    expect(await fotoUrl(ANA)).not.toMatch(/^https?:/);
  });

  it("las listas reciben una dirección firmada por empleado, solo de quien tiene foto", async () => {
    expect(await mod.urlsDeFotos(deps())).toEqual({ [ANA]: `https://firmada.invalid/${mod.rutaDeFoto(ANA)}?token=x` });
    expect(await mod.urlDeFoto(PEP, deps())).toBeNull();
  });

  it("sin una cara no se guarda nada; forzándola un administrador, sí", async () => {
    mirada = { caras: 0, cara: null, seVeBien: false, motivo: "" };
    await expect(mod.ponerFoto(PEP, { buffer: FOTO, mimetype: "image/jpeg" }, {}, deps())).rejects.toMatchObject({
      status: 422,
      code: "FOTO_NO_VALE",
    });
    expect(await fotoUrl(PEP)).toBeNull();
    expect(guardado.has(mod.rutaDeFoto(PEP))).toBe(false);

    await mod.ponerFoto(PEP, { buffer: FOTO, mimetype: "image/jpeg" }, { forzar: true }, deps());
    expect(await fotoUrl(PEP)).toBe(mod.rutaDeFoto(PEP));
    mirada = UNA_CARA;
  });

  it("lo dudoso se guarda y devuelve el aviso", async () => {
    mirada = { ...UNA_CARA, seVeBien: false, motivo: "Llevas gafas de sol" };
    const r = await mod.ponerFoto(ANA, { buffer: FOTO, mimetype: "image/jpeg" }, {}, deps());
    expect(r.aviso).toBe("Llevas gafas de sol. Si puedes, repítela.");
    mirada = UNA_CARA;
  });

  it("quitarla borra el fichero y deja la ficha sin foto", async () => {
    await mod.quitarFoto(PEP, deps());
    expect(await fotoUrl(PEP)).toBeNull();
    expect(guardado.has(mod.rutaDeFoto(PEP))).toBe(false);
    // Quitar la de quien no tiene no es un error.
    await expect(mod.quitarFoto(PEP, deps())).resolves.toBeUndefined();
  });

  it("lo que no es una foto, un PDF disfrazado o un empleado que no existe se rechazan", async () => {
    await expect(mod.ponerFoto(ANA, undefined, {}, deps())).rejects.toMatchObject({ status: 400 });
    await expect(mod.ponerFoto(ANA, { buffer: FOTO, mimetype: "application/pdf" }, {}, deps())).rejects.toMatchObject({ status: 400 });
    await expect(mod.ponerFoto(ANA, { buffer: Buffer.from("no es una foto"), mimetype: "image/jpeg" }, {}, deps())).rejects.toMatchObject({ status: 422 });
    await expect(
      mod.ponerFoto("99999999-0000-4000-a000-000000000000", { buffer: FOTO, mimetype: "image/jpeg" }, {}, deps())
    ).rejects.toMatchObject({ status: 404 });
    await expect(mod.ponerFoto("no-es-un-id", { buffer: FOTO, mimetype: "image/jpeg" }, {}, deps())).rejects.toMatchObject({ status: 404 });
  });
});

describe.runIf(RUN)("rutas de la foto en /api/core/empleados", () => {
  function servidor(esAdmin: boolean) {
    const autenticar: RequestHandler = (req, _res, next) => {
      (req as any).authCtx = { userId: "u1", empresaId: "0e0e0e0e-0000-4000-a000-000000000001", esAdmin, esSuperadmin: false };
      next();
    };
    const app = express();
    app.use("/api/core/empleados", mod.createFotoEmpleadoRouter({ autenticar, ...deps() }));
    return new Promise<{ url: string; cerrar: () => void }>((ok) => {
      const s = app.listen(0, () =>
        ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, cerrar: () => s.close() })
      );
    });
  }
  const subir = (url: string, id: string, campos: Record<string, string> = {}) => {
    const cuerpo = new FormData();
    cuerpo.append("foto", new Blob([new Uint8Array(FOTO)], { type: "image/jpeg" }), "foto.jpg");
    for (const [k, v] of Object.entries(campos)) cuerpo.append(k, v);
    return fetch(`${url}/api/core/empleados/${id}/foto`, { method: "POST", body: cuerpo });
  };

  it("quien no es administrador ni las ve, ni las pone, ni las quita", async () => {
    const { url, cerrar } = await servidor(false);
    try {
      expect((await fetch(`${url}/api/core/empleados/fotos`)).status).toBe(403);
      expect((await subir(url, PEP)).status).toBe(403);
      expect((await fetch(`${url}/api/core/empleados/${ANA}/foto`, { method: "DELETE" })).status).toBe(403);
      expect(await fotoUrl(ANA)).not.toBeNull();
    } finally {
      cerrar();
    }
  });

  it("el administrador la pone; si no vale, 422 con el motivo, y puede forzarla", async () => {
    const { url, cerrar } = await servidor(true);
    try {
      const ok = await subir(url, PEP);
      expect(ok.status).toBe(200);
      expect((await ok.json()).url).toContain(mod.rutaDeFoto(PEP));

      mirada = { caras: 2, cara: UNA_CARA.cara, seVeBien: true, motivo: "" };
      const no = await subir(url, PEP);
      expect(no.status).toBe(422);
      expect(await no.json()).toMatchObject({ code: "FOTO_NO_VALE", error: expect.stringMatching(/más de una persona/) });
      expect((await subir(url, PEP, { forzar: "1" })).status).toBe(200);
      mirada = UNA_CARA;

      const lista = await (await fetch(`${url}/api/core/empleados/fotos`)).json();
      expect(Object.keys(lista.fotos).sort()).toEqual([ANA, PEP].sort());

      expect((await fetch(`${url}/api/core/empleados/${PEP}/foto`, { method: "DELETE" })).status).toBe(200);
      expect(await fotoUrl(PEP)).toBeNull();
    } finally {
      cerrar();
    }
  });
});
