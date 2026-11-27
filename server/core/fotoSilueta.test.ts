/**
 * El modelo DE VERDAD que recorta a la persona, y el mural de verdad.
 *
 * El resto de pruebas usan una silueta de mentira; aquí se comprueba lo que
 * esas no pueden: que el modelo se carga en este Node, que se le da la foto
 * como la espera y que lo que contesta se lee bien. Si alguna de las tres
 * cosas se rompe, lo que sale es una foto con el fondo de siempre —sin ningún
 * error a la vista—, así que hay que mirarlo aquí.
 *
 * La figura de prueba no es la foto de nadie: no tiene cara y el fondo es
 * inventado (`muestras/figura-sin-cara.jpg`).
 */

import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";

import { LADO_SILUETA, siluetaCreible } from "./fotoFondo.ts";
import { LADO_FOTO, normalizarFoto } from "./fotoNormalizar.ts";
import { fondoCorporativo, imagenDeFondo, personaDeClases, siluetaConModelo, soltarModelo } from "./fotoSilueta.ts";

const L = LADO_SILUETA;
const FIGURA = readFileSync(new URL("./muestras/figura-sin-cara.jpg", import.meta.url));
const enCrudo = (img: sharp.Sharp) => img.resize(L, L, { fit: "fill" }).removeAlpha().raw().toBuffer();

/** Cargar el modelo y la primera foto tardan más que una prueba normal. */
const CALMA = 60_000;

afterAll(() => soltarModelo());

describe("lo que da el modelo → cuánto es persona", () => {
  it("la primera clase es el fondo: cuanto más gana, menos persona", () => {
    const clases = new Float32Array(L * L * 6);
    clases.set([9, 0, 0, 0, 0, 0], 0); // fondo seguro
    clases.set([0, 0, 0, 9, 0, 0], 6); // cara segura
    clases.set([2, 2, 0, 0, 0, 0], 12); // mitad fondo, mitad pelo
    const alfa = personaDeClases(clases);
    expect(alfa[0]).toBeLessThan(5);
    expect(alfa[1]).toBeGreaterThan(250);
    expect(alfa[2]).toBeGreaterThan(100);
    expect(alfa[2]).toBeLessThan(160);
    expect(alfa).toHaveLength(L * L);
  });
});

describe("el modelo de verdad", () => {
  it("encuentra a la persona de la figura y deja fuera el fondo", async () => {
    const alfa = (await siluetaConModelo(await enCrudo(sharp(FIGURA))))!;
    expect(alfa).toHaveLength(L * L);
    expect(siluetaCreible(alfa)).toBe(true);

    const es = (x: number, y: number) => alfa[y * L + x] > 128;
    expect(es(128, 80)).toBe(true); // la cabeza
    expect(es(128, 220)).toBe(true); // el pecho
    expect(es(60, 240)).toBe(true); // un hombro
    expect(es(8, 8)).toBe(false); // las esquinas de arriba
    expect(es(248, 8)).toBe(false);
    expect(es(20, 100)).toBe(false); // a la altura de la cabeza, a un lado
  }, CALMA);

  it("en una foto sin nadie no ve a nadie", async () => {
    const gris = await enCrudo(sharp({ create: { width: L, height: L, channels: 3, background: "#808080" } }));
    expect(siluetaCreible((await siluetaConModelo(gris))!)).toBe(false);
    // Ni en el propio mural, que es lo que habrá detrás de todas.
    const mural = await enCrudo(sharp(await imagenDeFondo(LADO_FOTO)));
    expect(siluetaCreible((await siluetaConModelo(mural))!)).toBe(false);
  }, CALMA);

  it("atiende varias fotos a la vez sin mezclarlas", async () => {
    const figura = await enCrudo(sharp(FIGURA));
    const gris = await enCrudo(sharp({ create: { width: L, height: L, channels: 3, background: "#808080" } }));
    const [a, b, c] = await Promise.all([siluetaConModelo(figura), siluetaConModelo(gris), siluetaConModelo(figura)]);
    expect(siluetaCreible(a!)).toBe(true);
    expect(siluetaCreible(b!)).toBe(false);
    expect(Buffer.from(c!).equals(Buffer.from(a!))).toBe(true);
  }, CALMA);

  it("después de soltarlo, vuelve a cargarse solo", async () => {
    await soltarModelo();
    expect(siluetaCreible((await siluetaConModelo(await enCrudo(sharp(FIGURA))))!)).toBe(true);
  }, CALMA);
});

describe("el mural", () => {
  it("sale cuadrado y al tamaño que se pide", async () => {
    const meta = await sharp(await imagenDeFondo(LADO_FOTO)).metadata();
    expect([meta.width, meta.height]).toEqual([LADO_FOTO, LADO_FOTO]);
  });
});

describe("de punta a punta: una foto, con el fondo de la empresa", () => {
  it("la figura sale sobre el mural, cuadrada y de 600", async () => {
    const r = await normalizarFoto(FIGURA, null, { fondo: fondoCorporativo });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.fondo).toBe("puesto");
    const meta = await sharp(r.jpeg).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([LADO_FOTO, LADO_FOTO, "jpeg"]);

    // Arriba a la derecha tiene que estar el mural (ahí va el logo), no el
    // fondo verdoso de la figura; y en el centro, la figura.
    const salida = await sharp(r.jpeg).raw().toBuffer();
    const mural = await sharp(await imagenDeFondo(LADO_FOTO)).removeAlpha().raw().toBuffer();
    const en = (b: Buffer, x: number, y: number) => [0, 1, 2].map((c) => b[(y * LADO_FOTO + x) * 3 + c]);
    const parecidos = (p: number[], q: number[]) => p.every((v, i) => Math.abs(v - q[i]) < 40);
    for (const [x, y] of [[560, 40], [520, 70], [30, 30], [40, 250]]) {
      expect(parecidos(en(salida, x, y), en(mural, x, y))).toBe(true);
    }
    // El traje, azul muy oscuro: nada que ver con el mural de detrás.
    const [rr, gg, bb] = en(salida, 300, 540);
    expect(rr + gg + bb).toBeLessThan(200);
  }, CALMA);

  it("una foto sin nadie se queda con su fondo", async () => {
    const vacia = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#808080" } }).jpeg().toBuffer();
    const r = await normalizarFoto(vacia, null, { fondo: fondoCorporativo });
    if (!r.ok) throw new Error(r.motivo);
    expect(r.fondo).toBe("no_fiable");
    const [p] = [await sharp(r.jpeg).raw().toBuffer()];
    expect(Math.abs(p[0] - 128)).toBeLessThan(10);
  }, CALMA);
});
