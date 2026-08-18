import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { miniaturaBoton, miniaturaFicha } from "./images.ts";
import { ErrorCaja } from "./errors.ts";

/** Imagen de juguete del tamaño que se pida, para no depender de ficheros. */
async function imagenDe(ancho: number, alto: number): Promise<Buffer> {
  return sharp({
    create: {
      width: ancho,
      height: alto,
      channels: 3,
      background: { r: 15, g: 23, b: 42 },
    },
  })
    .png()
    .toBuffer();
}

describe("miniaturaBoton", () => {
  it("reduce una foto grande a la altura del botón", async () => {
    const grande = await imagenDe(3000, 2000);
    const meta = await sharp(await miniaturaBoton(grande)).metadata();
    expect(meta.height).toBe(240);
    // Mantiene la proporción: 3000×2000 → 360×240.
    expect(meta.width).toBe(360);
  });

  it("no agranda una imagen que ya es pequeña", async () => {
    const pequena = await imagenDe(48, 48);
    const meta = await sharp(await miniaturaBoton(pequena)).metadata();
    expect(meta.height).toBe(48);
    expect(meta.width).toBe(48);
  });

  it("devuelve siempre PNG, aunque entre un JPEG", async () => {
    const jpeg = await sharp(await imagenDe(600, 400)).jpeg().toBuffer();
    const meta = await sharp(await miniaturaBoton(jpeg)).metadata();
    expect(meta.format).toBe("png");
  });

  it("pesa lo que un icono, no lo que una foto", async () => {
    const grande = await imagenDe(4000, 3000);
    const mini = await miniaturaBoton(grande);
    expect(mini.byteLength).toBeLessThan(100 * 1024);
  });

  it("rechaza con un 400 lo que no es una imagen", async () => {
    const basura = Buffer.from("esto no es una imagen, es un texto");
    await expect(miniaturaBoton(basura)).rejects.toBeInstanceOf(ErrorCaja);
    await expect(miniaturaBoton(basura)).rejects.toMatchObject({
      estado: 400,
      codigo: "ENTRADA_NO_VALIDA",
    });
  });
});

/** Círculo de color sobre un fondo liso, como la foto típica de una moneda. */
async function moneda(fondo: { r: number; g: number; b: number }, formato: "png" | "jpeg") {
  const svg = Buffer.from(
    `<svg width="200" height="200"><circle cx="100" cy="100" r="80" fill="#c8a020"/></svg>`
  );
  return await sharp({
    create: { width: 200, height: 200, channels: 3, background: fondo },
  })
    .composite([{ input: svg }])
    .toFormat(formato)
    .toBuffer();
}

/** Alfa de un píxel del resultado. */
async function alfa(png: Buffer, x: number, y: number): Promise<number> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * 4 + 3];
}

describe("miniatura de billete o moneda", () => {
  it("quita el fondo blanco de un JPG, que es lo que no tiene transparencia", async () => {
    const salida = await miniaturaFicha(await moneda({ r: 255, g: 255, b: 255 }, "jpeg"));
    const { width, height } = await sharp(salida).metadata();

    // Las esquinas, fuera; el centro de la moneda, entero.
    expect(await alfa(salida, 1, 1)).toBe(0);
    expect(await alfa(salida, width! - 2, height! - 2)).toBe(0);
    expect(await alfa(salida, Math.floor(width! / 2), Math.floor(height! / 2))).toBe(255);
  });

  it("también con un fondo gris claro, que es como salen muchos escaneos", async () => {
    const salida = await miniaturaFicha(await moneda({ r: 240, g: 240, b: 238 }, "jpeg"));
    expect(await alfa(salida, 1, 1)).toBe(0);
    expect(await alfa(salida, 60, 60)).toBeGreaterThan(0);
  });

  it("no toca una imagen que ya venía con su transparencia", async () => {
    const conAlfa = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="100" height="100"><circle cx="50" cy="50" r="40" fill="#c8a020"/></svg>`
          ),
        },
      ])
      .png()
      .toBuffer();

    const salida = await miniaturaFicha(conAlfa);
    expect(await alfa(salida, 50, 50)).toBe(255);
    expect(await alfa(salida, 1, 1)).toBe(0);
  });

  it("un blanco rodeado por el dibujo se queda: no es fondo", async () => {
    // El caso que rompe un «borra todo lo blanco»: los blancos de dentro de un
    // billete no tocan el marco, así que el relleno no llega hasta ellos.
    const svg = Buffer.from(
      `<svg width="200" height="200">
         <rect x="20" y="20" width="160" height="160" fill="#2050a0"/>
         <circle cx="100" cy="100" r="30" fill="#ffffff"/>
       </svg>`
    );
    const entrada = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([{ input: svg }])
      .jpeg()
      .toBuffer();

    const salida = await miniaturaFicha(entrada);
    const { width, height } = await sharp(salida).metadata();
    expect(await alfa(salida, 1, 1)).toBe(0);
    expect(await alfa(salida, Math.floor(width! / 2), Math.floor(height! / 2))).toBe(255);
  });

  it("con un fondo de muchos colores no se recorta nada", async () => {
    // Una moneda fotografiada encima de una mesa: preferible dejarla como está
    // que comerse media moneda por adivinar mal el fondo.
    const ruido = Buffer.alloc(200 * 200 * 3);
    for (let i = 0; i < ruido.length; i++) ruido[i] = (i * 37) % 256;
    const entrada = await sharp(ruido, { raw: { width: 200, height: 200, channels: 3 } })
      .jpeg()
      .toBuffer();

    const salida = await miniaturaFicha(entrada);
    expect(await alfa(salida, 1, 1)).toBe(255);
  });

  it("un fichero que no es una imagen se rechaza con un mensaje que se entiende", async () => {
    await expect(miniaturaFicha(Buffer.from("esto no es una imagen"))).rejects.toMatchObject({
      codigo: "ENTRADA_NO_VALIDA",
    });
  });
});
