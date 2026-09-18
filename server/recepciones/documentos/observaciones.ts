/**
 * Sacar del PDF del proveedor las observaciones del albarán.
 *
 * Es la única pieza de esto que toca un fichero; la decisión de qué fila es
 * una observación vive en `domain/observaciones.ts`, que es pura.
 *
 * El PDF se lee con el MISMO lector que Therefore (`documentos/texto.ts`):
 * agrupa por filas con tolerancia de línea base, que es justo lo que hace
 * falta aquí —«JORGE+PLANA 0 0 0,00» tiene que llegar como UNA fila— y ya
 * está probado. Recepciones no estrena lector.
 *
 * Nunca lanza: un PDF que no se deja leer no puede impedir que el albarán
 * entre. Sin observaciones se devuelve una lista vacía y se sigue.
 */

import { leerDocumento } from "../../therefore/documentos/texto.ts";
import { observacionesDelAlbaran, type FilaPdf } from "../domain/observaciones.ts";

export function observacionesDelPdf(pdf: Buffer): string[] {
  let filas: FilaPdf[];
  try {
    const doc = leerDocumento(pdf, { maxPaginas: 10 });
    filas = doc.paginas.flatMap((p) => p.lineas.map((l) => ({ palabras: l.palabras.map((w) => w.texto), pagina: p.numero })));
  } catch (e) {
    console.warn("[Recepciones] no se han podido leer las observaciones del albarán:", (e as Error).message);
    return [];
  }
  return observacionesDelAlbaran(filas);
}
