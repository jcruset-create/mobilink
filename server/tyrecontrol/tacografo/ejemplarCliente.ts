/**
 * El PDF que se queda adjunto a la intervención: solo el ejemplar del cliente.
 *
 * ── Por qué ─────────────────────────────────────────────────────────────────
 *
 * El centro técnico entrega cada informe por duplicado en el mismo fichero:
 * el «Ejemplar para el taller», una página en blanco y el «Ejemplar para el
 * cliente». Para LEER hacen falta los dos —se exige que digan lo mismo—, pero
 * lo que se guarda en la ficha del vehículo es el documento del cliente: es
 * el que le corresponde y el que verá si un día entra al panel. El del taller
 * no es suyo.
 *
 * ── Qué se recorta y qué no ─────────────────────────────────────────────────
 *
 * Se copian tal cual las páginas del ejemplar del cliente de ESA intervención
 * (un PDF puede traer el mes entero). No se toca el contenido: mismas
 * páginas, mismo aspecto.
 *
 * Si el fichero no trae un ejemplar del cliente que se pueda señalar con
 * seguridad, se guarda entero y se dice. Quedarse sin adjunto, o adjuntar
 * las páginas de otro autobús, es peor que adjuntar de más.
 */
import { PDFDocument } from "pdf-lib";

import { copiasDelInforme, ordenDeLaCopia, type LineaPdf } from "./informePdf.ts";

const ES_DEL_CLIENTE = /Ejemplar\s+para\s+el\s+cliente/i;

/**
 * Las páginas (empezando en 1) del ejemplar del cliente de la intervención
 * `idOrigen`. `null` si no hay exactamente uno.
 */
export function paginasDelEjemplarCliente(lineas: LineaPdf[], idOrigen: string): number[] | null {
  const delCliente = copiasDelInforme(lineas).filter((copia) =>
    copia.some((l) => ES_DEL_CLIENTE.test(l.texto)) && ordenDeLaCopia(copia) === idOrigen);
  // Dos ejemplares del cliente de la misma intervención es un fichero raro:
  // no se elige uno.
  if (delCliente.length !== 1) return null;
  const paginas = [...new Set(delCliente[0].map((l) => l.pagina))].sort((a, b) => a - b);
  return paginas.length > 0 ? paginas : null;
}

/** Un PDF nuevo con solo esas páginas (empezando en 1), en ese orden. */
export async function soloPaginas(pdf: Buffer, paginas: number[]): Promise<Buffer> {
  const origen = await PDFDocument.load(pdf);
  const total = origen.getPageCount();
  if (paginas.length === 0 || paginas.some((p) => !Number.isInteger(p) || p < 1 || p > total)) {
    throw new Error(`Páginas fuera del documento (${paginas.join(", ")} de ${total})`);
  }
  const destino = await PDFDocument.create();
  const copiadas = await destino.copyPages(origen, paginas.map((p) => p - 1));
  for (const pagina of copiadas) destino.addPage(pagina);
  return Buffer.from(await destino.save());
}

export interface PdfParaAdjuntar {
  pdf: Buffer;
  paginas: number | null;
  /** true si se ha dejado solo el ejemplar del cliente. */
  recortado: boolean;
  /** Por qué no se ha recortado, cuando no. */
  aviso: string | null;
}

/**
 * Lo que se sube al bucket para esa intervención.
 *
 * Nunca lanza: si no se puede recortar —no hay ejemplar del cliente, o el PDF
 * no se deja reescribir— devuelve el fichero entero con su aviso.
 */
export async function pdfParaAdjuntar(
  pdf: Buffer, lineas: LineaPdf[], idOrigen: string, paginasDelFichero: number | null,
): Promise<PdfParaAdjuntar> {
  const entero = (aviso: string): PdfParaAdjuntar =>
    ({ pdf, paginas: paginasDelFichero, recortado: false, aviso });

  const paginas = paginasDelEjemplarCliente(lineas, idOrigen);
  if (!paginas) {
    return entero("No se ha encontrado el «Ejemplar para el cliente» de esta intervención: se adjunta el PDF entero.");
  }
  try {
    const recortado = await soloPaginas(pdf, paginas);
    return { pdf: recortado, paginas: paginas.length, recortado: true, aviso: null };
  } catch {
    return entero("No se ha podido separar el ejemplar del cliente: se adjunta el PDF entero.");
  }
}

/** Qué hacer con un PDF que YA está adjunto. */
export type DecisionRecorte =
  | { estado: "ya_estaba" }
  | { estado: "recortar"; pdf: Buffer; paginas: number }
  | { estado: "no_se_puede"; motivo: string };

/**
 * Lo mismo que `pdfParaAdjuntar`, para un fichero que ya está guardado.
 *
 * Se distingue de él en dos cosas: un adjunto que ya es solo el ejemplar del
 * cliente se reconoce y no se toca (repetir la tarea no reescribe nada), y lo
 * que no se puede recortar se dice con su motivo en vez de darlo por bueno.
 */
export async function decidirRecorte(pdf: Buffer, lineas: LineaPdf[], idOrigen: string): Promise<DecisionRecorte> {
  const paginas = paginasDelEjemplarCliente(lineas, idOrigen);
  if (!paginas) {
    return { estado: "no_se_puede", motivo: "No se encuentra un único «Ejemplar para el cliente» de esta intervención." };
  }
  try {
    const total = (await PDFDocument.load(pdf)).getPageCount();
    if (paginas.length === total) return { estado: "ya_estaba" };
    return { estado: "recortar", pdf: await soloPaginas(pdf, paginas), paginas: paginas.length };
  } catch {
    return { estado: "no_se_puede", motivo: "El PDF no se deja reescribir." };
  }
}
