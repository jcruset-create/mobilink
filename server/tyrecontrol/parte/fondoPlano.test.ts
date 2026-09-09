/**
 * El riesgo de quitar el fondo de un plano es comerse las ruedas: en un render
 * de un camión, lo más oscuro que hay son justamente ellas. Estas pruebas
 * construyen el caso difícil a mano —fondo negro, ruedas oscuras, y una de
 * ellas TOCANDO el borde, como en el plano del Volvo— y comprueban que el
 * vehículo sigue ahí.
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { quitarFondoNegro } from "./fondoPlano.ts";

const W = 60, H = 40;

/** Un plano de mentira: fondo negro, chasis claro, y ruedas gris oscuro. */
async function plano(opts: { ruedaEnElBorde: boolean }): Promise<Uint8Array> {
  const d = Buffer.alloc(W * H * 4, 0);
  const pon = (x: number, y: number, v: number) => {
    const p = (y * W + x) * 4;
    d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) pon(x, y, 0);   // fondo
  for (let y = 15; y < 25; y++) for (let x = 10; x < 50; x++) pon(x, y, 200); // chasis
  // Ruedas: gris oscuro (caucho), claramente por encima del umbral de fondo.
  for (let y = 12; y < 28; y++) for (let x = 6; x < 10; x++) pon(x, y, 70);
  if (opts.ruedaEnElBorde) {
    for (let y = 12; y < 28; y++) for (let x = 0; x < 4; x++) pon(x, y, 70);
  }
  const png = await sharp(d, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  return new Uint8Array(png);
}

/** Alfa y color de un píxel del resultado. */
async function pixel(bytes: Uint8Array, x: number, y: number) {
  const { data } = await sharp(Buffer.from(bytes)).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const p = (y * W + x) * 4;
  return { r: data[p], a: data[p + 3] };
}

describe("quitar el fondo negro del plano", () => {
  it("el fondo desaparece", async () => {
    const r = await quitarFondoNegro(await plano({ ruedaEnElBorde: false }));
    expect((await pixel(r, 0, 0)).a).toBe(0);
    expect((await pixel(r, 30, 2)).a).toBe(0);
  });

  it("el chasis se queda entero", async () => {
    const r = await quitarFondoNegro(await plano({ ruedaEnElBorde: false }));
    const p = await pixel(r, 30, 20);
    expect(p.a).toBe(255);
    expect(p.r).toBe(200);
  });

  it("LAS RUEDAS SE QUEDAN, que es lo que se llevaría por delante un umbral", async () => {
    const r = await quitarFondoNegro(await plano({ ruedaEnElBorde: false }));
    const p = await pixel(r, 7, 20);
    expect(p.a).toBe(255);
    expect(p.r).toBe(70);
  });

  it("y también la que toca el borde de la imagen", async () => {
    const r = await quitarFondoNegro(await plano({ ruedaEnElBorde: true }));
    expect((await pixel(r, 1, 20)).a).toBe(255);
    // El fondo de esa misma columna, por encima de la rueda, sí se va.
    expect((await pixel(r, 1, 2)).a).toBe(0);
  });

  it("una imagen que es casi toda oscura se devuelve intacta: no se borra un plano", async () => {
    const d = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) { d[i * 4 + 3] = 255; }   // todo negro opaco
    const png = await sharp(d, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const r = await quitarFondoNegro(new Uint8Array(png));
    expect((await pixel(r, 30, 20)).a).toBe(255);
  });

  it("lo que no es una imagen entra tal cual, sin tumbar el parte", async () => {
    const basura = new Uint8Array([1, 2, 3, 4]);
    expect(await quitarFondoNegro(basura)).toBe(basura);
  });
});
