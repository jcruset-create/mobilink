/**
 * La foto del empleado contra Postgres, con un almacén de mentira (en las
 * pruebas no hay Supabase) y alguien que «mira» la foto en vez de la IA.
 */

import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type RequestHandler } from "express";
import type { PoolClient } from "pg";
import sharp from "sharp";

import { LADO_SILUETA, type FondoDeFoto } from "./fotoFondo.ts";
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
  async bajar(ruta: string) { return guardado.get(ruta) ?? null; },
  async firmar(rutas: string[]) {
    return Object.fromEntries(rutas.filter((r) => guardado.has(r)).map((r) => [r, `https://firmada.invalid/${r}?token=x`]));
  },
};
const ficherosDe = (id: string) => [...guardado.keys()].filter((r) => r.startsWith(`empleados/${id}/`));

const UNA_CARA: Mirada = { caras: 1, cara: { x: 0.35, y: 0.2, w: 0.3, h: 0.3 }, seVeBien: true, motivo: "" };
let mirada: Mirada | null = UNA_CARA;
const localizar = async () => mirada;
// Sin fondo salvo donde se prueba el fondo: lo demás es lo de siempre.
const deps = () => ({ consultor: conexion, almacen, localizar, fondo: null as FondoDeFoto | null });

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
    expect(r).toEqual({ url: `https://firmada.invalid/${ruta}?token=x`, aviso: null, fondo: "no_pedido" });

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


/* ── El fondo de la empresa ──────────────────────────────────────────────── */

const EVA = "2a2a2a2a-0000-4000-a000-000000000001";
const IVO = "2b2b2b2b-0000-4000-a000-000000000002";
const MAR = "2c2c2c2c-0000-4000-a000-000000000003";
const TEO = "2d2d2d2d-0000-4000-a000-000000000004";
const UMA = "2e2e2e2e-0000-4000-a000-000000000005";

/** Un «modelo» de mentira que siempre ve un busto en el centro, y un fondo verde. */
let miradas = 0;
const busto = () => {
  const L = LADO_SILUETA;
  const a = new Uint8Array(L * L);
  for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
    if ((x - 128) ** 2 + (y - 110) ** 2 < 45 ** 2 || (y > 160 && x > 40 && x < 216)) a[y * L + x] = 255;
  }
  return a;
};
const verde = async (lado: number) => sharp({ create: { width: lado, height: lado, channels: 3, background: "#00ff00" } }).png().toBuffer();
const conFondo: FondoDeFoto = { silueta: async () => { miradas += 1; return busto(); }, imagen: verde };
const sinPersona: FondoDeFoto = { silueta: async () => new Uint8Array(LADO_SILUETA * LADO_SILUETA), imagen: verde };
const roto: FondoDeFoto = { silueta: async () => { throw new Error("el modelo no carga"); }, imagen: verde };

const esquina = async (ruta: string) => {
  const { data } = await sharp(guardado.get(ruta)!).raw().toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
};
const esVerde = ([r, g, b]: number[]) => g > 200 && r < 70 && b < 70;
const esGris = ([r, g, b]: number[]) => Math.abs(r - 128) < 20 && Math.abs(g - 128) < 20 && Math.abs(b - 128) < 20;

describe.runIf(RUN)("el fondo de la empresa", () => {
  beforeAll(async () => {
    await conexion.query(`
      INSERT INTO sea_employees (id, nombre) VALUES
        ('${EVA}', 'Eva'), ('${IVO}', 'Ivo'), ('${MAR}', 'Mar'), ('${TEO}', 'Teo'), ('${UMA}', 'Uma')`);
    mirada = UNA_CARA;
  });
  const poner = (id: string, fondo: FondoDeFoto | null, opciones: { sinFondo?: boolean } = {}) =>
    mod.ponerFoto(id, { buffer: FOTO, mimetype: "image/jpeg" }, opciones, { ...deps(), fondo });

  it("la foto se guarda con el fondo, y la ruta lo dice", async () => {
    const r = await poner(EVA, conFondo);
    const ruta = (await fotoUrl(EVA))!;
    expect(r.fondo).toBe("puesto");
    expect(ruta).toMatch(new RegExp(`^empleados/${EVA}/foto-\\d+-f\\.jpg$`));
    expect(esVerde(await esquina(ruta))).toBe(true);
    const meta = await sharp(guardado.get(ruta)!).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([600, 600, "jpeg"]);
  });

  it("si el administrador la quiere sin fondo, ni se mira: se queda como es y no se vuelve a intentar", async () => {
    miradas = 0;
    const r = await poner(IVO, conFondo, { sinFondo: true });
    const ruta = (await fotoUrl(IVO))!;
    expect(r.fondo).toBe("no_pedido");
    expect(miradas).toBe(0);
    expect(ruta).toMatch(/-s\.jpg$/);
    expect(esGris(await esquina(ruta))).toBe(true);
  });

  it("si no se distingue a la persona, se guarda con su fondo y tampoco se vuelve a intentar", async () => {
    const r = await poner(MAR, sinPersona);
    const ruta = (await fotoUrl(MAR))!;
    expect(r.fondo).toBe("no_fiable");
    expect(ruta).toMatch(/-s\.jpg$/);
    expect(esGris(await esquina(ruta))).toBe(true);
  });

  it("si el modelo falla, la foto se guarda igual y queda pendiente de intentarlo", async () => {
    const r = await poner(TEO, roto);
    const ruta = (await fotoUrl(TEO))!;
    expect(r.fondo).toBe("fallo");
    expect(ruta).toMatch(new RegExp(`^empleados/${TEO}/foto-\\d+\\.jpg$`));
    expect(esGris(await esquina(ruta))).toBe(true);
  });

  describe("las fotos que ya había", () => {
    let antes: Record<string, string | null>;

    it("solo cuentan las que no se han intentado", async () => {
      // De las de este fichero: Ana, Pep y Luz se subieron sin fondo (como las
      // de antes de que existiera) y Teo falló. Eva lo tiene; Ivo y Mar se
      // quedan sin él a propósito.
      const { rows } = await conexion.query(
        `SELECT nombre FROM sea_employees WHERE foto_url IS NOT NULL AND foto_url !~ '-[fs]\\.jpg$' ORDER BY nombre`
      );
      expect(await mod.fotosSinFondo(conexion)).toBe(rows.length);
      expect(rows.map((r) => r.nombre)).toContain("Teo");
      expect(rows.map((r) => r.nombre)).not.toContain("Eva");
      expect(rows.map((r) => r.nombre)).not.toContain("Ivo");
      expect(rows.map((r) => r.nombre)).not.toContain("Mar");
    });

    it("se les pone a esas, y solo a esas", async () => {
      // Uma tiene una foto en la ficha que no está en el almacén.
      await conexion.query(`UPDATE sea_employees SET foto_url = 'empleados/${UMA}/foto-1.jpg' WHERE id = '${UMA}'`);
      antes = {};
      for (const id of [EVA, IVO, MAR, TEO]) antes[id] = await fotoUrl(id);

      const r = await mod.ponerFondoALasQueFaltan({ ...deps(), fondo: conFondo });

      expect(r.puestos).toContain("Teo");
      expect(r.puestos).not.toContain("Eva");
      expect(r.saltados).toEqual([{ nombre: "Uma", motivo: expect.stringMatching(/no está en el almacén/) }]);
      // Solo queda Uma, que no se puede.
      expect(r.quedan).toBe(1);

      const deTeo = (await fotoUrl(TEO))!;
      expect(deTeo).toMatch(/-f\.jpg$/);
      expect(esVerde(await esquina(deTeo))).toBe(true);
      // La anterior no se queda suelta.
      expect(guardado.has(antes[TEO]!)).toBe(false);
      expect(ficherosDe(TEO)).toEqual([deTeo]);
      // Las que ya estaban resueltas, ni tocarlas.
      for (const id of [EVA, IVO, MAR]) expect(await fotoUrl(id)).toBe(antes[id]);
    });

    it("hacerlo otra vez no repite nada", async () => {
      miradas = 0;
      const r = await mod.ponerFondoALasQueFaltan({ ...deps(), fondo: conFondo });
      expect(r.puestos).toEqual([]);
      expect(miradas).toBe(0);
    });

    it("a la que no se le distingue la persona se la deja como estaba y no se insiste", async () => {
      await conexion.query(`UPDATE sea_employees SET foto_url = NULL WHERE id = '${UMA}'`);
      await poner(UMA, roto);
      const original = Buffer.from(guardado.get((await fotoUrl(UMA))!)!);

      const r = await mod.ponerFondoALasQueFaltan({ ...deps(), fondo: sinPersona });

      expect(r.saltados).toEqual([{ nombre: "Uma", motivo: expect.stringMatching(/no se distingue/) }]);
      const ruta = (await fotoUrl(UMA))!;
      expect(ruta).toMatch(/-s\.jpg$/);
      expect(guardado.get(ruta)!.equals(original)).toBe(true);
      expect(r.quedan).toBe(0);
    });

    it("si alguien cambia la foto mientras tanto, manda la suya", async () => {
      await poner(UMA, roto);
      const vieja = (await fotoUrl(UMA))!;
      const nueva = `empleados/${UMA}/foto-9999999999999-f.jpg`;
      // Justo cuando se baja la foto para procesarla, otro la cambia.
      const almacenLento = {
        ...almacen,
        async bajar(ruta: string) {
          const f = guardado.get(ruta) ?? null;
          await conexion.query(`UPDATE sea_employees SET foto_url = $2 WHERE id = $1`, [UMA, nueva]);
          guardado.set(nueva, f!);
          return f;
        },
      };
      const r = await mod.ponerFondoALasQueFaltan({ ...deps(), almacen: almacenLento, fondo: conFondo });

      expect(r.puestos).toEqual([]);
      expect(await fotoUrl(UMA)).toBe(nueva);
      // Lo que se había preparado para la vieja no se queda en el almacén.
      expect(ficherosDe(UMA).sort()).toEqual([vieja, nueva].sort());
    });

    it("sin fondo configurado, o con un almacén del que no se puede bajar, no hace nada", async () => {
      expect(await mod.ponerFondoALasQueFaltan({ ...deps(), fondo: null })).toEqual({ puestos: [], saltados: [], quedan: 0 });
      const { bajar: _sinBajar, ...soloSubir } = almacen;
      expect(await mod.ponerFondoALasQueFaltan({ ...deps(), almacen: soloSubir, fondo: conFondo })).toEqual({ puestos: [], saltados: [], quedan: 0 });
    });
  });

  describe("por las rutas", () => {
    function servidor(esAdmin: boolean) {
      const autenticar: RequestHandler = (req, _res, next) => {
        (req as any).authCtx = { userId: "u1", empresaId: "0e0e0e0e-0000-4000-a000-000000000001", esAdmin, esSuperadmin: false };
        next();
      };
      const app = express();
      app.use("/api/core/empleados", mod.createFotoEmpleadoRouter({ autenticar, ...deps(), fondo: conFondo, origen: async () => null }));
      return new Promise<{ url: string; cerrar: () => void }>((ok) => {
        const s = app.listen(0, () =>
          ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/core/empleados`, cerrar: () => s.close() })
        );
      });
    }
    const subir = (url: string, id: string, campos: Record<string, string> = {}) => {
      const cuerpo = new FormData();
      cuerpo.append("foto", new Blob([new Uint8Array(FOTO)], { type: "image/jpeg" }), "foto.jpg");
      for (const [k, v] of Object.entries(campos)) cuerpo.append(k, v);
      return fetch(`${url}/${id}/foto`, { method: "POST", body: cuerpo });
    };

    it("quien no es administrador no puede ponerles el fondo", async () => {
      const { url, cerrar } = await servidor(false);
      try {
        expect((await fetch(`${url}/fotos/poner-fondo`, { method: "POST" })).status).toBe(403);
      } finally {
        cerrar();
      }
    });

    it("la lista dice cuántas faltan, y el botón se las pone", async () => {
      await poner(TEO, roto); // otra vez sin intentar
      const { url, cerrar } = await servidor(true);
      try {
        const faltan = await mod.fotosSinFondo(conexion);
        expect(faltan).toBeGreaterThan(0);
        expect((await (await fetch(`${url}/fotos`)).json()).sinFondo).toBe(faltan);

        const r = await fetch(`${url}/fotos/poner-fondo`, { method: "POST" });
        expect(r.status).toBe(200);
        const d = await r.json();
        expect(d.puestos).toContain("Teo");
        expect((await (await fetch(`${url}/fotos`)).json()).sinFondo).toBe(d.quedan);
      } finally {
        cerrar();
      }
    });

    it("al subir una foto sale con fondo; con «sinFondo», no", async () => {
      const { url, cerrar } = await servidor(true);
      try {
        const con = await subir(url, EVA);
        expect((await con.json()).fondo).toBe("puesto");
        expect(await fotoUrl(EVA)).toMatch(/-f\.jpg$/);

        const sin = await subir(url, EVA, { sinFondo: "1" });
        expect((await sin.json()).fondo).toBe("no_pedido");
        const ruta = (await fotoUrl(EVA))!;
        expect(ruta).toMatch(/-s\.jpg$/);
        expect(esGris(await esquina(ruta))).toBe(true);
      } finally {
        cerrar();
      }
    });
  });
});
