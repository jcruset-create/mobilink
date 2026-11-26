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
const LUZ = "1c1c1c1c-0000-4000-a000-000000000003";
const NIL = "1d1d1d1d-0000-4000-a000-000000000004";

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
const ficherosDe = (id: string) => [...guardado.keys()].filter((r) => r.startsWith(`empleados/${id}/`));

const UNA_CARA: Mirada = { caras: 1, cara: { x: 0.35, y: 0.2, w: 0.3, h: 0.3 }, seVeBien: true, motivo: "" };
let mirada: Mirada | null = UNA_CARA;
const localizar = async () => mirada;
const deps = () => ({ consultor: conexion, almacen, localizar });

const fotoUrl = async (id: string): Promise<string | null> =>
  (await conexion.query(`SELECT foto_url FROM sea_employees WHERE id = $1`, [id])).rows[0].foto_url;

beforeAll(async () => {
  if (!RUN) return;
  const db = (await import("../db.ts")).default;
  mod = await import("./fotoEmpleado.ts");
  conexion = await db.connect();
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}`);
  await conexion.query(`SET search_path = ${ESQUEMA}`);
  await conexion.query(`
    CREATE TABLE sea_employees (id uuid PRIMARY KEY, nombre text NOT NULL, foto_url text, updated_at timestamptz);
    CREATE TABLE techs (id serial PRIMARY KEY, name text NOT NULL UNIQUE, avatar text, employee_id uuid);
    INSERT INTO sea_employees (id, nombre) VALUES ('${ANA}', 'Ana'), ('${PEP}', 'Pep'), ('${LUZ}', 'Luz'), ('${NIL}', 'Nil');
  `);
  FOTO = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#808080" } }).jpeg().toBuffer();
});

afterAll(async () => {
  if (!RUN) return;
  await conexion.query(`SET search_path = public; DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  conexion.release();
});

describe.runIf(RUN)("foto del empleado", () => {
  it("se guarda normalizada, en su carpeta, y la ficha apunta a ella", async () => {
    const r = await mod.ponerFoto(ANA, { buffer: FOTO, mimetype: "image/jpeg" }, {}, deps());
    const ruta = (await fotoUrl(ANA))!;
    expect(ruta).toMatch(new RegExp(`^empleados/${ANA}/foto-\\d+\\.jpg$`));
    expect(r).toEqual({ url: `https://firmada.invalid/${ruta}?token=x`, aviso: null });

    const meta = await sharp(guardado.get(ruta)!).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([600, 600, "jpeg"]);
    expect(await mod.tieneFoto(ANA, conexion)).toBe(true);
    expect(await mod.tieneFoto(PEP, conexion)).toBe(false);
  });

  it("en la ficha queda la ruta dentro del bucket, nunca una dirección", async () => {
    expect(await fotoUrl(ANA)).not.toMatch(/^https?:/);
  });

  it("una foto nueva va a otra ruta y la anterior se borra: no queda ninguna suelta", async () => {
    const antes = (await fotoUrl(ANA))!;
    await new Promise((r) => setTimeout(r, 5)); // la ruta lleva la hora
    await mod.ponerFoto(ANA, { buffer: FOTO, mimetype: "image/jpeg" }, {}, deps());
    const despues = (await fotoUrl(ANA))!;
    expect(despues).not.toBe(antes);
    expect(ficherosDe(ANA)).toEqual([despues]);
  });

  it("las listas reciben una dirección firmada por empleado, solo de quien tiene foto", async () => {
    expect(await mod.urlsDeFotos(deps())).toEqual({ [ANA]: `https://firmada.invalid/${await fotoUrl(ANA)}?token=x` });
    expect(await mod.urlDeFoto(PEP, deps())).toBeNull();
  });

  it("sin una cara no se guarda nada; forzándola un administrador, sí", async () => {
    mirada = { caras: 0, cara: null, seVeBien: false, motivo: "" };
    await expect(mod.ponerFoto(PEP, { buffer: FOTO, mimetype: "image/jpeg" }, {}, deps())).rejects.toMatchObject({
      status: 422,
      code: "FOTO_NO_VALE",
    });
    expect(await fotoUrl(PEP)).toBeNull();
    expect(ficherosDe(PEP)).toEqual([]);

    await mod.ponerFoto(PEP, { buffer: FOTO, mimetype: "image/jpeg" }, { forzar: true }, deps());
    expect(ficherosDe(PEP)).toEqual([await fotoUrl(PEP)]);
    mirada = UNA_CARA;
  });

  it("una foto rechazada no se lleva por delante la que ya había", async () => {
    const buena = await fotoUrl(ANA);
    mirada = { caras: 2, cara: UNA_CARA.cara, seVeBien: true, motivo: "" };
    await expect(mod.ponerFoto(ANA, { buffer: FOTO, mimetype: "image/jpeg" }, {}, deps())).rejects.toMatchObject({ status: 422 });
    expect(await fotoUrl(ANA)).toBe(buena);
    expect(ficherosDe(ANA)).toEqual([buena]);
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
    expect(ficherosDe(PEP)).toEqual([]);
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

describe.runIf(RUN)("las fotos que ya había en Taller", () => {
  /** El «almacén del panel»: de aquí salen las fotos de Taller. */
  const origen = async (avatar: string) =>
    avatar.includes("/techs/") ? { buffer: FOTO, mimetype: "image/jpeg" } : null;

  beforeAll(async () => {
    await conexion.query(`
      INSERT INTO techs (name, avatar, employee_id) VALUES
        ('Ana', 'https://x.supabase.co/storage/v1/object/public/panel/techs/ana.jpg', '${ANA}'),  -- ya tiene foto en Core
        ('Luz', 'https://x.supabase.co/storage/v1/object/public/panel/techs/luz.jpg', '${LUZ}'),
        ('Nil', 'https://otro-sitio.invalid/nil.jpg', '${NIL}'),                                -- no está en el almacén
        ('Pep', NULL, '${PEP}'),                                                               -- sin foto en Taller
        ('Suelto', 'https://x.supabase.co/storage/v1/object/public/panel/techs/suelto.jpg', NULL) -- sin enlazar
    `);
  });

  it("cuenta solo a los enlazados con foto en Taller y sin foto en Core", async () => {
    expect(await mod.fotosPendientesDeTaller(conexion)).toBe(2); // Luz y Nil
  });

  it("las pasa normalizadas, sin pisar la de quien ya tiene y diciendo las que no ha podido", async () => {
    const deAna = await fotoUrl(ANA);
    // Aunque no se le encuentre la cara, se pasa: son fotos que ya estaban elegidas.
    mirada = { caras: 0, cara: null, seVeBien: false, motivo: "" };
    const r = await mod.traerFotosDeTaller({ ...deps(), origen });
    mirada = UNA_CARA;

    expect(r.pasadas).toEqual(["Luz"]);
    expect(r.saltadas).toEqual([{ tecnico: "Nil", motivo: expect.stringMatching(/almacén del panel/) }]);

    const deLuz = (await fotoUrl(LUZ))!;
    expect(deLuz).toMatch(new RegExp(`^empleados/${LUZ}/foto-\\d+\\.jpg$`));
    const meta = await sharp(guardado.get(deLuz)!).metadata();
    expect([meta.width, meta.height]).toEqual([600, 600]);
    expect(await fotoUrl(ANA)).toBe(deAna);
    expect(await fotoUrl(NIL)).toBeNull();
    // La de Taller sigue donde estaba.
    expect((await conexion.query(`SELECT avatar FROM techs WHERE name = 'Luz'`)).rows[0].avatar).toContain("/techs/luz.jpg");
  });

  it("hacerlo otra vez no repite nada", async () => {
    const r = await mod.traerFotosDeTaller({ ...deps(), origen });
    expect(r.pasadas).toEqual([]);
    expect(await mod.fotosPendientesDeTaller(conexion)).toBe(1); // sigue Nil, que no se puede
  });
});

describe.runIf(RUN)("rutas de la foto en /api/core/empleados", () => {
  function servidor(esAdmin: boolean) {
    const autenticar: RequestHandler = (req, _res, next) => {
      (req as any).authCtx = { userId: "u1", empresaId: "0e0e0e0e-0000-4000-a000-000000000001", esAdmin, esSuperadmin: false };
      next();
    };
    const app = express();
    app.use("/api/core/empleados", mod.createFotoEmpleadoRouter({ autenticar, ...deps(), origen: async () => null }));
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

  it("quien no es administrador ni las ve, ni las pone, ni las quita, ni las trae", async () => {
    const { url, cerrar } = await servidor(false);
    try {
      expect((await fetch(`${url}/api/core/empleados/fotos`)).status).toBe(403);
      expect((await subir(url, PEP)).status).toBe(403);
      expect((await fetch(`${url}/api/core/empleados/${ANA}/foto`, { method: "DELETE" })).status).toBe(403);
      expect((await fetch(`${url}/api/core/empleados/fotos/traer-de-taller`, { method: "POST" })).status).toBe(403);
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
      expect((await ok.json()).url).toContain(await fotoUrl(PEP));

      mirada = { caras: 2, cara: UNA_CARA.cara, seVeBien: true, motivo: "" };
      const no = await subir(url, PEP);
      expect(no.status).toBe(422);
      expect(await no.json()).toMatchObject({ code: "FOTO_NO_VALE", error: expect.stringMatching(/más de una persona/) });
      expect((await subir(url, PEP, { forzar: "1" })).status).toBe(200);
      mirada = UNA_CARA;

      const lista = await (await fetch(`${url}/api/core/empleados/fotos`)).json();
      expect(Object.keys(lista.fotos).sort()).toEqual([ANA, LUZ, PEP].sort());
      expect(lista.pendientesDeTaller).toBe(1);

      const traer = await fetch(`${url}/api/core/empleados/fotos/traer-de-taller`, { method: "POST" });
      expect(traer.status).toBe(200);
      expect(await traer.json()).toMatchObject({ pasadas: [], saltadas: [{ tecnico: "Nil" }] });

      expect((await fetch(`${url}/api/core/empleados/${PEP}/foto`, { method: "DELETE" })).status).toBe(200);
      expect(await fotoUrl(PEP)).toBeNull();
    } finally {
      cerrar();
    }
  });
});
