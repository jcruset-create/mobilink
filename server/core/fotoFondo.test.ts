import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { LADO_SILUETA, ponerFondo, siluetaCreible, taparHuecos, tocaArriba, type FondoDeFoto } from "./fotoFondo.ts";

const L = LADO_SILUETA;
const LADO = 600;

/** Una silueta a partir de una regla: 255 donde hay persona. */
const silueta = (esPersona: (x: number, y: number) => boolean | number): Uint8Array => {
  const a = new Uint8Array(L * L);
  for (let y = 0; y < L; y++) {
    for (let x = 0; x < L; x++) {
      const v = esPersona(x, y);
      a[y * L + x] = v === true ? 255 : v === false ? 0 : v;
    }
  }
  return a;
};

/** Un busto: cabeza redonda en el centro y hombros hasta abajo. */
const busto = (cabezaY = 100) =>
  silueta((x, y) => (x - 128) ** 2 + (y - cabezaY) ** 2 < 45 ** 2 || (y > cabezaY + 50 && x > 40 && x < 216));

/** Un cuadro todo rojo (la «persona») y un fondo todo verde. */
const cuadroRojo = () => sharp({ create: { width: LADO, height: LADO, channels: 3, background: "#ff0000" } }).png().toBuffer();
const fondoCon = (alfa: Uint8Array | null | (() => never)): FondoDeFoto => ({
  silueta: async () => (typeof alfa === "function" ? alfa() : alfa),
  imagen: async (lado) => sharp({ create: { width: lado, height: lado, channels: 3, background: "#00ff00" } }).png().toBuffer(),
});

async function pixel(jpeg: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}
const esRojo = ([r, g]: number[]) => r > 200 && g < 70;
const esVerde = ([r, g]: number[]) => g > 200 && r < 70;
/** De 256 a 600. */
const a600 = (v: number) => Math.round((v * LADO) / L);

describe("¿parece la silueta de una persona?", () => {
  it("un busto, sí", () => {
    expect(siluetaCreible(busto())).toBe(true);
  });

  it("casi nada o casi todo, no", () => {
    expect(siluetaCreible(silueta(() => false))).toBe(false);
    expect(siluetaCreible(silueta(() => true))).toBe(false);
    expect(siluetaCreible(silueta((x, y) => x < 20 && y < 20))).toBe(false);
  });

  it("un «puede que un poco» en toda la foto no es una persona", () => {
    // Lo que da el modelo en una foto sin nadie: todo a un 8 %.
    expect(siluetaCreible(silueta(() => 21))).toBe(false);
  });

  it("si se sabe dónde está la cabeza, tiene que caer dentro", () => {
    const cabeza = { x: 83 / L, y: 55 / L, w: 90 / L, h: 90 / L };
    expect(siluetaCreible(busto(), cabeza)).toBe(true);
    // La silueta está en otra parte: ha recortado otra cosa.
    expect(siluetaCreible(busto(), { x: 0, y: 0, w: 0.2, h: 0.2 })).toBe(false);
  });

  it("una silueta de otro tamaño no vale", () => {
    expect(siluetaCreible(new Uint8Array(100))).toBe(false);
  });
});

describe("la silueta, maciza por dentro", () => {
  const B = busto();

  it("un agujero en mitad del cuerpo se tapa", () => {
    const conAgujero = silueta((x, y) => B[y * L + x] > 0 && !(x > 110 && x < 140 && y > 190 && y < 215));
    expect(conAgujero[200 * L + 125]).toBe(0);
    expect(taparHuecos(conAgujero)[200 * L + 125]).toBe(255);
  });

  it("y uno que llega al borde de abajo también: ahí está el cuerpo, no el fondo", () => {
    const conMuesca = silueta((x, y) => B[y * L + x] > 0 && !(x > 110 && x < 140 && y > 220));
    expect(taparHuecos(conMuesca)[250 * L + 125]).toBe(255);
  });

  it("el fondo de verdad —el que llega arriba o a un lado— no se toca", () => {
    const t = taparHuecos(busto());
    expect(t[5 * L + 5]).toBe(0);
    expect(t[100 * L + 10]).toBe(0);
    expect(t[100 * L + 250]).toBe(0);
    // Junto al cuello, por encima del hombro: fondo, aunque debajo haya persona.
    expect(t[130 * L + 60]).toBe(0);
  });

  it("lo dudoso de dentro queda firme; lo del borde, suave", () => {
    const dudosa = silueta((x, y) => {
      if (B[y * L + x] === 0) return 0;
      // Una mancha a medias en el pecho y el contorno del hombro a medias.
      if (x > 100 && x < 150 && y > 180 && y < 220) return 150;
      if (x <= 42) return 150;
      return 255;
    });
    const t = taparHuecos(dudosa);
    expect(t[200 * L + 125]).toBe(255);
    expect(t[200 * L + 41]).toBe(150);
  });

  it("no cambia de tamaño ni toca la que se le pasa", () => {
    const original = busto();
    const copia = Uint8Array.from(original);
    expect(taparHuecos(original)).toHaveLength(L * L);
    expect(original).toEqual(copia);
  });
});

describe("ponerFondo", () => {
  it("la persona se queda y lo de detrás pasa a ser el fondo", async () => {
    const jpeg = await ponerFondo(await cuadroRojo(), fondoCon(busto()), { lado: LADO });
    if (!jpeg) throw new Error("no ha puesto el fondo");
    const meta = await sharp(jpeg).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([LADO, LADO, "jpeg"]);

    expect(esRojo(await pixel(jpeg, a600(128), a600(100)))).toBe(true); // la cabeza
    expect(esRojo(await pixel(jpeg, a600(128), a600(220)))).toBe(true); // el pecho
    expect(esVerde(await pixel(jpeg, 10, 10))).toBe(true); // las esquinas de arriba
    expect(esVerde(await pixel(jpeg, LADO - 10, 10))).toBe(true);
    expect(esVerde(await pixel(jpeg, a600(20), a600(100)))).toBe(true); // junto a la cabeza
  });

  it("si la silueta no es de fiar, no se toca la foto", async () => {
    expect(await ponerFondo(await cuadroRojo(), fondoCon(silueta(() => false)), { lado: LADO })).toBeNull();
    expect(await ponerFondo(await cuadroRojo(), fondoCon(silueta(() => true)), { lado: LADO })).toBeNull();
    expect(await ponerFondo(await cuadroRojo(), fondoCon(null), { lado: LADO })).toBeNull();
    expect(
      await ponerFondo(await cuadroRojo(), fondoCon(busto()), { lado: LADO, cara: { x: 0, y: 0, w: 0.2, h: 0.2 } })
    ).toBeNull();
  });

  it("no lleva metadatos", async () => {
    const jpeg = (await ponerFondo(await cuadroRojo(), fondoCon(busto()), { lado: LADO }))!;
    const meta = await sharp(jpeg).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("si hay que bajarla, baja, y el hueco de arriba es fondo", async () => {
    // Cabeza alta (centrada en y=60), sin tocar el borde.
    const alta = busto(60);
    expect(tocaArriba(alta)).toBe(false);
    const sinBajar = (await ponerFondo(await cuadroRojo(), fondoCon(alta), { lado: LADO }))!;
    const bajada = (await ponerFondo(await cuadroRojo(), fondoCon(alta), { lado: LADO, bajar: 100 }))!;
    // Donde estaba lo alto de la cabeza (y≈20 de 256 → 47 de 600) ahora hay fondo…
    expect(esRojo(await pixel(sinBajar, 300, 60))).toBe(true);
    expect(esVerde(await pixel(bajada, 300, 60))).toBe(true);
    // …y la cabeza está 100 px más abajo.
    expect(esRojo(await pixel(bajada, 300, 160))).toBe(true);
    // Abajo sigue habiendo persona hasta el borde: no queda un busto flotando.
    expect(esRojo(await pixel(bajada, 300, LADO - 3))).toBe(true);
  });

  it("si la cabeza está cortada por arriba, no se baja: se vería el corte", async () => {
    const cortada = busto(20);
    expect(tocaArriba(cortada)).toBe(true);
    const jpeg = (await ponerFondo(await cuadroRojo(), fondoCon(cortada), { lado: LADO, bajar: 100 }))!;
    expect(esRojo(await pixel(jpeg, 300, 5))).toBe(true);
  });
});
