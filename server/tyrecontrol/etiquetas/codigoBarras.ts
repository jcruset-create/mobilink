/**
 * Leer el número de serie del CÓDIGO DE BARRAS de la pegatina.
 *
 * Las gomas nuevas llevan una pegatina blanca con un código de barras y el
 * número impreso debajo: el código y el número son la MISMA cifra. Leer el
 * código no es IA, es un decodificador: o da el número exacto o no da nada.
 * No se confunde un 6 con un 8 ni se inventa una cifra borrosa.
 *
 * Por eso va primero, y la IA queda para cuando no hay código legible (la
 * pegatina arrugada, cortada o el número estampado en el caucho).
 *
 * El caso que lo motivó: fotos con la pegatina girada 90°, perfectamente
 * legibles, que la IA devolvía como «no se ve el número». El decodificador lee
 * el código en cualquier orientación (`tryRotate`).
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import sharp from "sharp";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

let preparado: Promise<unknown> | null = null;

/**
 * El decodificador es WebAssembly y, si no se le dice nada, se descarga el
 * binario de un CDN al arrancar. En un servidor eso es una dependencia de red
 * que sobra y que puede fallar: se le da el fichero que ya viene en el paquete.
 */
function preparar(): Promise<unknown> {
  if (!preparado) {
    const require = createRequire(import.meta.url);
    preparado = prepareZXingModule({
      overrides: { wasmBinary: fs.readFileSync(require.resolve("zxing-wasm/reader/zxing_reader.wasm")) as unknown as ArrayBuffer },
      fireImmediately: true,
    });
  }
  return preparado;
}

/** ¿Puede ser un número de serie? Cifras y letras, entre 6 y 20. */
export function pareceNumeroDeSerie(texto: string): boolean {
  return /^[A-Z0-9]{6,20}$/i.test(texto.trim()) && /\d/.test(texto);
}

/** Lee los códigos de una imagen ya preparada y se queda con los que parecen un serie. */
async function leer(png: Buffer): Promise<string[]> {
  const leidos = await readBarcodes(new Uint8Array(png), {
    tryHarder: true, tryRotate: true, tryInvert: false, maxNumberOfSymbols: 4,
  });
  return [...new Set(leidos.map((r) => r.text.trim()).filter(pareceNumeroDeSerie))];
}

/** Una caja en la imagen original. */
interface Caja { left: number; top: number; width: number; height: number }

/**
 * Dónde puede estar la pegatina: las manchas más blancas de la foto.
 *
 * Una pegatina blanca sobre caucho negro es lo más brillante de la imagen. Se
 * busca a baja resolución (400 px de ancho, unos milisegundos), se toman las
 * tres manchas más grandes y se devuelve un recorte GENEROSO alrededor de cada
 * una: la pegatina casi nunca sale como una sola mancha, porque las barras y
 * las cifras la parten, y quedarse corto cortaría el código.
 *
 * Se descartan las manchas que tocan el borde: suelen ser cielo, suelo
 * mojado o el reflejo de una ventana, no una pegatina en mitad del flanco.
 */
export async function zonasDePegatina(imagen: Uint8Array): Promise<Caja[]> {
  const meta = await sharp(imagen).rotate().metadata();
  // .rotate() sin argumento aplica la orientación EXIF; con 90/270 cambian
  // ancho y alto.
  const girada = (meta.orientation ?? 1) >= 5;
  const W = (girada ? meta.height : meta.width) ?? 0;
  const H = (girada ? meta.width : meta.height) ?? 0;
  if (!W || !H) return [];
  const w = 400, esc = W / w, h = Math.max(1, Math.round(H / esc));
  const { data } = await sharp(imagen).rotate().resize(w, h).grayscale().raw()
    .toBuffer({ resolveWithObject: true });

  // Umbral relativo a la propia foto: el 3 % más brillante, y nunca por debajo
  // de un gris claro (en una foto muy oscura, el 3 % más brillante es caucho).
  const orden = Uint8Array.from(data).sort();
  const umbral = Math.max(170, orden[Math.floor(orden.length * 0.97)]);

  const visto = new Uint8Array(w * h);
  const manchas: { x0: number; y0: number; x1: number; y1: number; n: number }[] = [];
  for (let p = 0; p < w * h; p++) {
    if (visto[p] || data[p] < umbral) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0;
    const cola = [p];
    visto[p] = 1;
    while (cola.length) {
      const q = cola.pop() as number;
      const x = q % w, y = (q - x) / w;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const r of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
        if (r >= 0 && r < w * h && !visto[r] && data[r] >= umbral) { visto[r] = 1; cola.push(r); }
      }
    }
    if (n >= 30 && x0 > 0 && y0 > 0 && x1 < w - 1 && y1 < h - 1) manchas.push({ x0, y0, x1, y1, n });
  }

  // Dos recortes por mancha, de ajustado a holgado. El AJUSTADO es el que
  // lee las fotos de verdad: con la pegatina ocupando casi todo el recorte,
  // al ampliarlo cada barra tiene píxeles de sobra. El holgado queda para
  // cuando la mancha es solo un trozo de la pegatina (las barras y las cifras
  // la parten) y hace falta margen para no cortar el código.
  const cajas: Caja[] = [];
  const recorte = (cx: number, cy: number, ancho: number, alto: number): Caja => {
    const left = Math.max(0, Math.round(cx - ancho / 2)), top = Math.max(0, Math.round(cy - alto / 2));
    return { left, top, width: Math.min(W - left, Math.round(ancho)), height: Math.min(H - top, Math.round(alto)) };
  };
  for (const c of manchas.sort((a, b) => b.n - a.n).slice(0, 3)) {
    const cx = ((c.x0 + c.x1) / 2) * esc, cy = ((c.y0 + c.y1) / 2) * esc;
    const bw = (c.x1 - c.x0 + 1) * esc, bh = (c.y1 - c.y0 + 1) * esc;
    const minimo = Math.min(W, H) * 0.15;
    cajas.push(recorte(cx, cy, Math.max(bw * 1.8, minimo), Math.max(bh * 2.2, minimo)));
    const lado = Math.max(bw * 3, bh * 3, Math.min(W, H) * 0.35);
    cajas.push(recorte(cx, cy, lado, lado));
  }
  return cajas;
}

/**
 * Los números de serie que hay en los códigos de barras de la foto.
 *
 * Dos pasadas, de barata a cara:
 *
 * 1. La foto entera. Basta cuando la pegatina ocupa buena parte de la imagen,
 *    esté recta o girada a 90°, 180° o 270° (eso lo resuelve `tryRotate`).
 * 2. Si no sale nada: se localiza la pegatina, se recorta AJUSTADA a ella, se
 *    amplía y se prueba INCLINADA de 5 en 5 grados y luego más abierta. Es el caso real que fallaba: una
 *    pegatina pequeña en una foto grande, boca abajo y algo torcida. El
 *    decodificador tolera poca inclinación, y a tamaño real el código tenía
 *    muy pocos píxeles por barra.
 *
 * Devuelve la lista SIN repetidos. Quien llama decide: uno solo es la
 * respuesta; varios distintos (dos gomas en la foto) no se elige a ojo.
 */
export async function seriesDeCodigoDeBarras(imagen: Uint8Array): Promise<string[]> {
  await preparar();
  // A PNG y en gris: el decodificador no entiende WebP ni HEIC, que es lo que
  // mandan algunos móviles.
  const enteras = await leer(await sharp(imagen).rotate().grayscale().png().toBuffer());
  if (enteras.length) return enteras;

  for (const caja of await zonasDePegatina(imagen)) {
    // De 5 en 5 al principio: la foto real se leía a -10° y a -15°, y no a 0°
    // ni a -30°. El decodificador tolera muy poca inclinación.
    for (const grados of [0, -5, 5, -10, 10, -15, 15, -25, 25, -40, 40]) {
      const png = await sharp(imagen).rotate().extract(caja).resize({ width: 1400 })
        .rotate(grados, { background: "#fff" }).grayscale().png().toBuffer();
      const series = await leer(png);
      if (series.length) return series;
    }
  }
  return [];
}
