/**
 * Leer la entrega de INSA TURBO del PDF adjunto al correo.
 *
 * Es la única pieza de esto que toca un fichero; lo que dice el papel lo
 * decide `domain/insa.ts`, que es puro. Mismo reparto que
 * `documentos/observaciones.ts`, y el MISMO lector de PDF que Therefore:
 * Recepciones no estrena lector.
 *
 * Nunca lanza. Un PDF que no se deja leer, o que no es una entrega de INSA,
 * devuelve `null` y el correo sigue su camino como antes: lo que no se
 * entiende queda para que lo mire una persona, no se convierte en un albarán
 * a medias.
 */

import { leerDocumento } from "../../therefore/documentos/texto.ts";
import { leerEntregaInsa, type EntregaInsa } from "../domain/insa.ts";
import type { FilaPdf } from "../domain/observaciones.ts";

export function entregaInsaDelPdf(pdf: Buffer): EntregaInsa | null {
  let filas: FilaPdf[];
  try {
    const doc = leerDocumento(pdf, { maxPaginas: 10 });
    filas = doc.paginas.flatMap((p) => p.lineas.map((l) => ({ palabras: l.palabras.map((w) => w.texto), pagina: p.numero })));
  } catch (e) {
    console.warn("[Recepciones] no se ha podido leer el PDF adjunto:", (e as Error).message);
    return null;
  }
  return leerEntregaInsa(filas);
}
