/**
 * Partir el PDF de los partes en una hoja por página.
 *
 * ── Por qué se parte, en vez de mandar el PDF entero ───────────────────────
 *
 * Porque un fichero NO es un parte: los 14 partes de la muestra vienen en un
 * solo PDF de 14 páginas, cada una de un vehículo distinto. Mandarlo entero y
 * pedir un array de hojas tiene tres problemas, y el tercero es el que decide:
 *
 *  1. La salida crece con el número de páginas y acaba cortada a media tabla,
 *     que es el fallo que ya se vio en el lector del otro impreso.
 *  2. Catorce hojas de ocho ruedas son más de noventa números en una sola
 *     respuesta, y el modelo pierde la cuenta de en qué página va.
 *  3. Un fallo en la página 7 se lleva por delante las otras trece. Partiendo,
 *     cada hoja va y vuelve sola: la que falle se reintenta o se teclea, y las
 *     demás ya están.
 *
 * ── Lo que NO hace ─────────────────────────────────────────────────────────
 *
 * No endereza las páginas escaneadas del revés —dos de las catorce lo están—.
 * Girarlas aquí obligaría a rasterizar, y el modelo las lee bien si se le
 * avisa; eso se hace en las instrucciones del lector, que es más barato y no
 * toca el documento del cliente.
 */

import { PDFDocument } from "pdf-lib";

/**
 * El tope de páginas por fichero.
 *
 * Cada página es una llamada al proveedor y se paga. Catorce es lo que manda
 * un día normal de revisiones; treinta deja sitio de sobra para un día largo
 * y pone un techo a lo que puede costar un fichero subido por error.
 */
export const MAX_PAGINAS = 30;

export type Troceado =
  | { paginas: string[]; total: number }
  | { motivo: string };

/** ¿El data URI es un PDF? Lo demás (una foto) es ya una sola hoja. */
export function esPdf(dataUri: string): boolean {
  return /^data:application\/pdf/i.test(dataUri);
}

/**
 * Un data URI por página, en orden.
 *
 * Una imagen suelta se devuelve tal cual: ya es una hoja. Un PDF de una sola
 * página también, sin volver a serializarlo, porque re-guardarlo no aporta
 * nada y puede perder calidad de un escaneo.
 */
export async function partirEnHojas(dataUri: string): Promise<Troceado> {
  if (!esPdf(dataUri)) return { paginas: [dataUri], total: 1 };

  const coma = dataUri.indexOf(",");
  if (coma < 0) return { motivo: "El fichero no se entiende" };

  let documento: PDFDocument;
  try {
    const bytes = Buffer.from(dataUri.slice(coma + 1), "base64");
    documento = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (e) {
    // Un PDF protegido o corrupto se dice, no se deja reventar la petición.
    return { motivo: `No se ha podido abrir el PDF: ${(e as Error)?.message ?? e}` };
  }

  const total = documento.getPageCount();
  if (total === 0) return { motivo: "El PDF no tiene páginas" };
  if (total === 1) return { paginas: [dataUri], total: 1 };
  if (total > MAX_PAGINAS) {
    return { motivo: `El PDF trae ${total} páginas y el tope son ${MAX_PAGINAS}. Pártelo antes de subirlo.` };
  }

  const paginas: string[] = [];
  for (let i = 0; i < total; i++) {
    const hoja = await PDFDocument.create();
    const [copia] = await hoja.copyPages(documento, [i]);
    hoja.addPage(copia);
    const bytes = await hoja.save();
    paginas.push(`data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`);
  }
  return { paginas, total };
}
