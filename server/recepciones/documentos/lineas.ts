/**
 * Sacar del PDF del albarán sus líneas de mercancía.
 *
 * La única pieza de esto que toca un fichero; qué dice el papel lo decide
 * `domain/lineasAlbaran.ts`, que es puro. Mismo reparto y mismo lector de PDF
 * que `documentos/observaciones.ts`: Recepciones no estrena lector.
 *
 * Nunca lanza: un PDF ilegible devuelve una lista vacía, y sin líneas no se
 * toca nada de lo que ya hay guardado.
 */

import { leerDocumento } from "../../therefore/documentos/texto.ts";
import { lineasDeMercancia, type LineaPdf } from "../domain/lineasAlbaran.ts";
import type { FilaPdf } from "../domain/observaciones.ts";

export function lineasDelPdf(pdf: Buffer): LineaPdf[] {
  let filas: FilaPdf[];
  try {
    const doc = leerDocumento(pdf, { maxPaginas: 10 });
    filas = doc.paginas.flatMap((p) => p.lineas.map((l) => ({ palabras: l.palabras.map((w) => w.texto), pagina: p.numero })));
  } catch (e) {
    console.warn("[Recepciones] no se han podido leer las líneas del albarán:", (e as Error).message);
    return [];
  }
  return lineasDeMercancia(filas);
}
