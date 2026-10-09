import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { writeBarcode, prepareZXingModule } from "zxing-wasm/writer";
import fs from "node:fs";
import { createRequire } from "node:module";
import { seriesDeCodigoDeBarras, pareceNumeroDeSerie } from "./codigoBarras.ts";

const require = createRequire(import.meta.url);
await prepareZXingModule({
  overrides: { wasmBinary: fs.readFileSync(require.resolve("zxing-wasm/writer/zxing_writer.wasm")) as unknown as ArrayBuffer },
  fireImmediately: true,
});

/** Una pegatina como la de las gomas: Code 128 con el número. */
async function pegatina(numero: string, girada = 0): Promise<Uint8Array> {
  const r = await writeBarcode(numero, { format: "Code128", scale: 3 });
  const png = Buffer.from(await (r.image as Blob).arrayBuffer());
  return new Uint8Array(await sharp(png).extend({ top: 40, bottom: 40, left: 40, right: 40, background: "#fff" })
    .rotate(girada, { background: "#fff" }).jpeg().toBuffer());
}

describe("seriesDeCodigoDeBarras", () => {
  it("lee el número de la pegatina", async () => {
    expect(await seriesDeCodigoDeBarras(await pegatina("2640486092"))).toEqual(["2640486092"]);
  });

  it("y la lee GIRADA, que es como salen las fotos que fallaban", async () => {
    expect(await seriesDeCodigoDeBarras(await pegatina("2640486092", 90))).toEqual(["2640486092"]);
    expect(await seriesDeCodigoDeBarras(await pegatina("1945863269", 270))).toEqual(["1945863269"]);
  });

  it("una pegatina PEQUEÑA, boca abajo y torcida en una foto grande", async () => {
    // El caso real que fallaba: la pegatina ocupa poco, está a ~195° y sobre
    // caucho oscuro. A la foto entera no se le saca nada; hay que localizar
    // la pegatina, recortarla, ampliarla y enderezarla.
    const etiqueta = await sharp(await pegatina("2640486081")).resize({ width: 260 }).toBuffer();
    const girada = await sharp(etiqueta).rotate(195, { background: "#2b2f36" }).toBuffer();
    const foto = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: "#2b2f36" } })
      .composite([{ input: girada, left: 1100, top: 700 }]).jpeg({ quality: 85 }).toBuffer();
    expect(await seriesDeCodigoDeBarras(new Uint8Array(foto))).toEqual(["2640486081"]);
  });

  it("una foto sin código no se inventa nada", async () => {
    const lisa = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#333" } }).jpeg().toBuffer();
    expect(await seriesDeCodigoDeBarras(new Uint8Array(lisa))).toEqual([]);
  });
});

describe("pareceNumeroDeSerie", () => {
  it("cifras y letras de una longitud razonable", () => {
    expect(pareceNumeroDeSerie("2640486092")).toBe(true);
    expect(pareceNumeroDeSerie("AB1234567")).toBe(true);
  });
  it("lo que no puede ser un serie", () => {
    expect(pareceNumeroDeSerie("12345")).toBe(false);          // demasiado corto
    expect(pareceNumeroDeSerie("https://x.y/1234567")).toBe(false);
    expect(pareceNumeroDeSerie("ABCDEFGH")).toBe(false);       // sin una cifra
  });
});
