import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { miniaturaBoton } from "./images.ts";
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
    expect(meta.height).toBe(160);
    // Mantiene la proporción: 3000×2000 → 240×160.
    expect(meta.width).toBe(240);
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
