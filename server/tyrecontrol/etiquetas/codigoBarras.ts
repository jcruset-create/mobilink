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

/**
 * Los números de serie que hay en los códigos de barras de la foto.
 *
 * Devuelve la lista SIN repetidos. Quien llama decide: uno solo es la
 * respuesta; varios distintos (dos gomas en la foto) no se elige a ojo.
 */
export async function seriesDeCodigoDeBarras(imagen: Uint8Array): Promise<string[]> {
  await preparar();
  // A PNG: el decodificador no entiende WebP ni HEIC, que es lo que mandan
  // algunos móviles.
  const png = await sharp(imagen).rotate().png().toBuffer();
  const leidos = await readBarcodes(new Uint8Array(png), {
    tryHarder: true, tryRotate: true, tryInvert: false, maxNumberOfSymbols: 4,
  });
  const series = leidos.map((r) => r.text.trim()).filter(pareceNumeroDeSerie);
  return [...new Set(series)];
}
