import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { LADO_SILUETA, type FondoDeFoto } from "./fotoFondo.ts";
import {
  LADO_FOTO,
  bajarParaCentrar,
  cajaValida,
  juzgar,
  normalizarFoto,
  recorteCentral,
  recorteDeCara,
  type Caja,
  type Mirada,
} from "./fotoNormalizar.ts";

/**
 * Una «foto» de prueba: fondo gris y un rectángulo rojo donde estaría la
 * cabeza. No hay ninguna persona; lo que se comprueba es la geometría.
 */
async function foto(ancho: number, alto: number, cabeza: { left: number; top: number; width: number; height: number }) {
  const rojo = await sharp({ create: { width: cabeza.width, height: cabeza.height, channels: 3, background: "#ff0000" } }).png().toBuffer();
  return sharp({ create: { width: ancho, height: alto, channels: 3, background: "#808080" } })
    .composite([{ input: rojo, left: cabeza.left, top: cabeza.top }])
    .jpeg({ quality: 95 });
}

const caja = (ancho: number, alto: number, c: { left: number; top: number; width: number; height: number }): Caja => ({
  x: c.left / ancho,
  y: c.top / alto,
  w: c.width / ancho,
  h: c.height / alto,
});

const unaCara = (c: Caja, extra: Partial<Mirada> = {}): Mirada => ({ caras: 1, cara: c, seVeBien: true, motivo: "", ...extra });

async function pixel(jpeg: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}
const esRojo = ([r, g, b]: number[]) => r > 200 && g < 60 && b < 60;
const esGris = ([r, g, b]: number[]) => Math.abs(r - 128) < 20 && Math.abs(g - 128) < 20 && Math.abs(b - 128) < 20;

describe("recorteDeCara", () => {
  it("la cabeza ocupa la mitad del alto y queda algo por encima del centro", () => {
    // Cabeza de 300 px de alto centrada en (800, 450), en una foto de 1200x1600.
    const r = recorteDeCara(caja(1200, 1600, { left: 700, top: 300, width: 200, height: 300 }), 1200, 1600);
    expect(r).toEqual({ left: 500, top: 186, size: 600 });
  });

  it("si la persona está pegada al borde, el cuadrado se arrima hacia dentro", () => {
    const r = recorteDeCara(caja(1200, 1600, { left: 0, top: 0, width: 200, height: 300 }), 1200, 1600);
    expect(r).toEqual({ left: 0, top: 0, size: 600 });
    const abajo = recorteDeCara(caja(1200, 1600, { left: 1000, top: 1300, width: 200, height: 300 }), 1200, 1600);
    expect(abajo).toEqual({ left: 600, top: 1000, size: 600 });
  });

  it("si la cabeza llena la foto, se usa el cuadrado más grande que cabe", () => {
    const r = recorteDeCara({ x: 0.1, y: 0.05, w: 0.8, h: 0.9 }, 1200, 1600);
    expect(r.size).toBe(1200);
    expect(r.left).toBe(0);
    expect(r.top + r.size).toBeLessThanOrEqual(1600);
  });
});

describe("recorteCentral y cajaValida", () => {
  it("el cuadrado central de una foto vertical y de una apaisada", () => {
    expect(recorteCentral(1200, 1600)).toEqual({ left: 0, top: 200, size: 1200 });
    expect(recorteCentral(1600, 1200)).toEqual({ left: 200, top: 0, size: 1200 });
  });

  it("una caja fuera de la foto, minúscula o con basura no vale", () => {
    expect(cajaValida({ x: 0.2, y: 0.2, w: 0.3, h: 0.4 })).toBe(true);
    expect(cajaValida({ x: 0.8, y: 0.2, w: 0.5, h: 0.4 })).toBe(false);
    expect(cajaValida({ x: 0.2, y: 0.2, w: 0.001, h: 0.4 })).toBe(false);
    expect(cajaValida({ x: Number.NaN, y: 0, w: 0.5, h: 0.5 })).toBe(false);
    expect(cajaValida(null)).toBe(false);
  });
});

describe("juzgar", () => {
  const c: Caja = { x: 0.3, y: 0.2, w: 0.3, h: 0.4 };

  it("sin cara o con más de una, se rechaza", () => {
    expect(juzgar({ caras: 0, cara: null, seVeBien: false, motivo: "" }).rechazo).toMatch(/ninguna cara/);
    expect(juzgar({ caras: 2, cara: c, seVeBien: true, motivo: "" }).rechazo).toMatch(/más de una persona/);
  });

  it("lo dudoso se avisa, no se rechaza", () => {
    const j = juzgar(unaCara(c, { seVeBien: false, motivo: "Llevas gafas de sol." }));
    expect(j.rechazo).toBeNull();
    expect(j.aviso).toBe("Llevas gafas de sol. Si puedes, repítela.");
    expect(j.cara).toEqual(c);
  });

  it("si nadie ha podido mirar la foto, ni rechaza ni avisa", () => {
    expect(juzgar(null)).toEqual({ rechazo: null, aviso: null, cara: null });
  });

  it("una cara con el recuadro mal dado se acepta, pero sin recuadro", () => {
    expect(juzgar(unaCara({ x: 2, y: 2, w: 1, h: 1 }))).toEqual({ rechazo: null, aviso: null, cara: null });
  });
});

describe("normalizarFoto", () => {
  const CABEZA = { left: 700, top: 300, width: 200, height: 300 };

  it("sale cuadrada, de 600, con la cabeza donde toca", async () => {
    const original = await (await foto(1200, 1600, CABEZA)).toBuffer();
    const r = await normalizarFoto(original, async () => unaCara(caja(1200, 1600, CABEZA)));
    if (!r.ok) throw new Error(r.motivo);
    const meta = await sharp(r.jpeg).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([LADO_FOTO, LADO_FOTO, "jpeg"]);
    expect(r).toMatchObject({ aviso: null, conCara: true });

    // La cabeza iba de y=300 a y=600; el recorte empieza en y=186 → en la
    // salida va de 114 a 414, centrada en x.
    expect(esRojo(await pixel(r.jpeg, 300, 264))).toBe(true);
    expect(esRojo(await pixel(r.jpeg, 300, 130))).toBe(true);
    expect(esGris(await pixel(r.jpeg, 300, 60))).toBe(true);
    expect(esGris(await pixel(r.jpeg, 300, 500))).toBe(true);
    expect(esGris(await pixel(r.jpeg, 100, 264))).toBe(true);
  });

  it("dos fotos muy distintas de la misma «cabeza» quedan iguales", async () => {
    // De lejos y a un lado, apaisada.
    const lejos = { left: 300, top: 400, width: 100, height: 150 };
    const a = await normalizarFoto(await (await foto(2000, 1500, lejos)).toBuffer(), async () => unaCara(caja(2000, 1500, lejos)));
    // De cerca, vertical.
    const cerca = { left: 400, top: 500, width: 400, height: 600 };
    const b = await normalizarFoto(await (await foto(1200, 1900, cerca)).toBuffer(), async () => unaCara(caja(1200, 1900, cerca)));
    if (!a.ok || !b.ok) throw new Error("no se han normalizado");
    for (const [x, y] of [[300, 264], [300, 130], [300, 400], [300, 60], [300, 500], [100, 264], [500, 264]]) {
      expect(esRojo(await pixel(a.jpeg, x, y)), `(${x},${y})`).toBe(esRojo(await pixel(b.jpeg, x, y)));
    }
  });

  it("pone derecha una foto girada por EXIF antes de buscarle la cara", async () => {
    // Apaisada en el fichero, pero marcada como «girar 90°»: se ve vertical.
    const original = await (await foto(1600, 1200, { left: 300, top: 300, width: 300, height: 200 }))
      .withMetadata({ orientation: 6 })
      .toBuffer();
    let visto: { width?: number; height?: number } = {};
    const r = await normalizarFoto(original, async (jpeg) => {
      visto = await sharp(jpeg).metadata();
      return null;
    });
    expect(r.ok).toBe(true);
    expect(visto.height).toBeGreaterThan(visto.width!);
  });

  it("no deja pasar los metadatos de la cámara (ni la ubicación)", async () => {
    const original = await (await foto(1200, 1600, CABEZA))
      .withExif({ IFD0: { Make: "CamaraDePrueba", Software: "x" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "41/1 7/1 0/1" } })
      .toBuffer();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const r = await normalizarFoto(original, null);
    if (!r.ok) throw new Error(r.motivo);
    expect((await sharp(r.jpeg).metadata()).exif).toBeUndefined();
    expect(r.jpeg.includes(Buffer.from("CamaraDePrueba"))).toBe(false);
  });

  it("sin nadie que diga dónde está la cara, recorta al centro y la da por buena", async () => {
    const centro = { left: 500, top: 700, width: 200, height: 200 };
    const original = await (await foto(1200, 1600, centro)).toBuffer();
    for (const localizar of [null, async () => null, async () => { throw new Error("sin servicio"); }]) {
      const r = await normalizarFoto(original, localizar);
      if (!r.ok) throw new Error(r.motivo);
      expect(r).toMatchObject({ aviso: null, conCara: false });
      expect(esRojo(await pixel(r.jpeg, 300, 300))).toBe(true);
    }
  });

  it("sin cara o con dos se rechaza, salvo que un administrador la fuerce", async () => {
    const original = await (await foto(1200, 1600, CABEZA)).toBuffer();
    const nadie = async (): Promise<Mirada> => ({ caras: 0, cara: null, seVeBien: false, motivo: "" });
    const r = await normalizarFoto(original, nadie);
    expect(r).toEqual({ ok: false, motivo: expect.stringMatching(/ninguna cara/) });

    const forzada = await normalizarFoto(original, nadie, { forzar: true });
    expect(forzada).toMatchObject({ ok: true, aviso: null, conCara: false });
  });

  it("lo dudoso se guarda con su aviso", async () => {
    const original = await (await foto(1200, 1600, CABEZA)).toBuffer();
    const r = await normalizarFoto(original, async () =>
      unaCara(caja(1200, 1600, CABEZA), { seVeBien: false, motivo: "Hay poca luz" })
    );
    expect(r).toMatchObject({ ok: true, aviso: "Hay poca luz. Si puedes, repítela.", conCara: true });
  });

  it("de muy lejos avisa de que queda poco nítida", async () => {
    const lejos = { left: 1000, top: 700, width: 70, height: 90 };
    const r = await normalizarFoto(await (await foto(2000, 1500, lejos)).toBuffer(), async () => unaCara(caja(2000, 1500, lejos)));
    expect(r).toMatchObject({ ok: true, aviso: expect.stringMatching(/muy lejos/) });
  });

  it("lo que no es una imagen, o es un sello, se rechaza con un mensaje", async () => {
    expect(await normalizarFoto(Buffer.from("esto no es una foto"), null)).toEqual({ ok: false, motivo: expect.stringMatching(/No se ha podido leer/) });
    const sello = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#808080" } }).jpeg().toBuffer();
    expect(await normalizarFoto(sello, null)).toEqual({ ok: false, motivo: expect.stringMatching(/demasiado pequeña/) });
  });
});

describe("el fondo", () => {
  const CABEZA = { left: 700, top: 300, width: 200, height: 300 };
  const esVerde = ([r, g, b]: number[]) => g > 200 && r < 70 && b < 70;

  /**
   * Un «modelo» de mentira: persona es lo que sea rojo. Y un fondo todo verde.
   */
  const fondoDePrueba = (cambio: Partial<FondoDeFoto> = {}): FondoDeFoto => ({
    silueta: async (rgb) => {
      const alfa = new Uint8Array(LADO_SILUETA * LADO_SILUETA);
      for (let i = 0; i < alfa.length; i++) alfa[i] = rgb[i * 3] > 200 && rgb[i * 3 + 1] < 80 ? 255 : 0;
      return alfa;
    },
    imagen: async (lado) => sharp({ create: { width: lado, height: lado, channels: 3, background: "#00ff00" } }).png().toBuffer(),
    ...cambio,
  });

  it("si no se pide, la foto se queda con el suyo", async () => {
    const original = await (await foto(1200, 1600, CABEZA)).toBuffer();
    const r = await normalizarFoto(original, async () => unaCara(caja(1200, 1600, CABEZA)));
    if (!r.ok) throw new Error(r.motivo);
    expect(r.fondo).toBe("no_pedido");
    expect(esGris(await pixel(r.jpeg, 100, 264))).toBe(true);
  });

  it("con fondo: la «cabeza» sigue donde toca y lo de detrás es el fondo nuevo", async () => {
    const original = await (await foto(1200, 1600, CABEZA)).toBuffer();
    const r = await normalizarFoto(original, async () => unaCara(caja(1200, 1600, CABEZA)), { fondo: fondoDePrueba() });
    if (!r.ok) throw new Error(r.motivo);
    expect(r).toMatchObject({ fondo: "puesto", conCara: true, aviso: null });
    const meta = await sharp(r.jpeg).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([LADO_FOTO, LADO_FOTO, "jpeg"]);
    expect(esRojo(await pixel(r.jpeg, 300, 264))).toBe(true);
    expect(esVerde(await pixel(r.jpeg, 300, 60))).toBe(true);
    expect(esVerde(await pixel(r.jpeg, 100, 264))).toBe(true);
    expect(esVerde(await pixel(r.jpeg, 560, 40))).toBe(true);
  });

  it("si no se distingue a la persona, la foto se guarda igual, con su fondo", async () => {
    const original = await (await foto(1200, 1600, CABEZA)).toBuffer();
    const nadie = fondoDePrueba({ silueta: async () => new Uint8Array(LADO_SILUETA * LADO_SILUETA) });
    const r = await normalizarFoto(original, async () => unaCara(caja(1200, 1600, CABEZA)), { fondo: nadie });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.fondo).toBe("no_fiable");
    expect(esRojo(await pixel(r.jpeg, 300, 264))).toBe(true);
    expect(esGris(await pixel(r.jpeg, 100, 264))).toBe(true);
  });

  it("si el modelo revienta, la foto se guarda igual: nadie se queda sin foto por esto", async () => {
    const original = await (await foto(1200, 1600, CABEZA)).toBuffer();
    const roto = fondoDePrueba({
      silueta: async () => {
        throw new Error("el modelo no carga");
      },
    });
    const r = await normalizarFoto(original, async () => unaCara(caja(1200, 1600, CABEZA)), { fondo: roto });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.fondo).toBe("fallo");
    expect(esGris(await pixel(r.jpeg, 100, 264))).toBe(true);
  });

  it("una foto rechazada se sigue rechazando: el fondo no la salva", async () => {
    const original = await (await foto(1200, 1600, CABEZA)).toBuffer();
    const r = await normalizarFoto(original, async () => ({ caras: 0, cara: null, seVeBien: false, motivo: "" }), { fondo: fondoDePrueba() });
    expect(r.ok).toBe(false);
  });

  it("a quien sale pegado arriba se le baja la cabeza a su altura, que ahora hay con qué rellenar", async () => {
    // La cabeza empieza a 20 px del borde: el cuadrado ideal se saldría 94 px
    // por arriba, así que sin fondo la cabeza queda más alta que en las demás.
    const arriba = { left: 500, top: 20, width: 200, height: 300 };
    const original = await (await foto(1200, 1600, arriba)).toBuffer();
    const mirar = async () => unaCara(caja(1200, 1600, arriba));

    const sin = await normalizarFoto(original, mirar);
    const con = await normalizarFoto(original, mirar, { fondo: fondoDePrueba() });
    if (!sin.ok || !con.ok) throw new Error("no ha salido");

    // Sin fondo: la cabeza va de y=20 a y=320 (se queda arriba).
    expect(esRojo(await pixel(sin.jpeg, 300, 40))).toBe(true);
    // Con fondo: baja a su sitio de siempre, de 114 a 414.
    expect(esVerde(await pixel(con.jpeg, 300, 60))).toBe(true);
    expect(esRojo(await pixel(con.jpeg, 300, 130))).toBe(true);
    expect(esRojo(await pixel(con.jpeg, 300, 400))).toBe(true);
    expect(esVerde(await pixel(con.jpeg, 300, 440))).toBe(true);
  });

  it("bajarParaCentrar: solo cuando el recorte se arrimó por arriba, y con tope", () => {
    const cara = (top: number) => caja(1200, 1600, { left: 500, top, width: 200, height: 300 });
    // En su sitio: nada que bajar.
    expect(bajarParaCentrar(cara(300), 1600, recorteDeCara(cara(300), 1200, 1600))).toBe(0);
    // Pegada arriba: lo que le falta, en proporción del lado (94 de 600).
    expect(bajarParaCentrar(cara(20), 1600, recorteDeCara(cara(20), 1200, 1600))).toBeCloseTo(94 / 600, 3);
    // Pegada abajo: el recorte se arrimó hacia arriba; no se sube a nadie.
    expect(bajarParaCentrar(cara(1300), 1600, recorteDeCara(cara(1300), 1200, 1600))).toBe(0);
    // Con la cabeza medio fuera de la foto, no se la baja más de un cuarto.
    expect(bajarParaCentrar({ x: 0.4, y: 0, w: 0.2, h: 0.02 }, 1600, { left: 0, top: 0, size: 1200 })).toBe(0.25);
  });
});
