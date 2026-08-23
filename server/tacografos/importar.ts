/**
 * Importa el informe del anexo II que emite la extranet de VDO.
 *
 * Dos caminos, y el orden importa:
 *
 *  1. **PDF con texto** —el que se descarga de la extranet—: se lee el texto
 *     con mupdf y se analiza. Es exacto, instantáneo y no cuesta nada.
 *  2. **Foto o PDF escaneado**: no hay texto que leer, así que se rasteriza y
 *     lo lee el modelo de visión que ya usa el resto del servidor.
 *
 * Se intenta siempre primero el camino 1. Mandar a un modelo un PDF del que se
 * puede sacar el texto exacto sería pagar por adivinar lo que ya se sabe.
 *
 * Lo importado NO se guarda: se devuelve para que el técnico lo confirme.
 */

import * as mupdf from "mupdf";
import { pedirIA } from "../core/openaiService.ts";
import { rasterizarPdf } from "../tyrecontrol/ficha-tecnica/pdfRasterizer.ts";
import { aDatosExpediente, parsearAnexoII, type LecturaAnexoII } from "./anexoII.ts";
import { ErrorTacografos } from "./repository.ts";
import type { DatosExpediente } from "./domain.ts";

/** Por debajo de esto se da por hecho que el PDF es un escaneo sin texto. */
const MINIMO_ETIQUETAS = 6;

export type Origen = "pdf_texto" | "ocr";

export type Importacion = {
  origen: Origen;
  datos: Partial<DatosExpediente>;
  /** Lo leído en crudo, para que la pantalla enseñe qué ha salido de dónde. */
  campos: Record<string, string>;
  /** Etiquetas del impreso que no se han encontrado. */
  avisos: string[];
  encontradas: number;
  total: number;
};

/** Texto de todas las páginas de un PDF. Vacío si el PDF no lleva texto. */
export function textoDePdf(buffer: Buffer): string {
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const paginas: string[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    paginas.push(doc.loadPage(i).toStructuredText("preserve-whitespace").asText());
  }
  return paginas.join("\n");
}

function resultado(origen: Origen, lectura: LecturaAnexoII): Importacion {
  return {
    origen,
    datos: aDatosExpediente(lectura.campos),
    campos: lectura.campos,
    avisos: lectura.avisos,
    encontradas: lectura.encontradas,
    total: lectura.total,
  };
}

const INSTRUCCIONES = `Eres un perito que digitaliza el impreso oficial
"Informe sobre transferencia de datos / certificado de intransferibilidad"
(anexo II del Real decreto 125/2017, emitido por la extranet de VDO).

Transcribe el documento TAL CUAL, respetando la numeración de los campos del 1
al 27 y sus etiquetas, una por línea, con el formato:

<número>. <etiqueta exactamente como aparece>
<valor>

No interpretes, no corrijas y no completes: si un campo está en blanco, deja la
línea del valor vacía. Incluye también, al principio, las líneas
"NÚMERO DE INFORME / CERTIFICADO: <valor>" y "Fecha: <valor>".
Devuelve sólo esa transcripción, sin comentarios.`;

/**
 * Lee el impreso de un fichero subido.
 *
 * `mime` decide por dónde se empieza; si el PDF resulta no tener texto, se cae
 * al OCR solo. Un fichero que no es el anexo II se detecta porque no aparece
 * casi ninguna de sus etiquetas, y entonces se dice, en vez de devolver un
 * expediente medio vacío que el técnico daría por bueno.
 */
export async function importarAnexoII(
  fichero: Buffer,
  mime: string
): Promise<Importacion> {
  const esPdf = mime === "application/pdf";

  if (esPdf) {
    let texto: string;
    try {
      texto = textoDePdf(fichero);
    } catch {
      throw new ErrorTacografos("No se ha podido abrir el PDF.", "PDF_ILEGIBLE");
    }
    const lectura = parsearAnexoII(texto);
    if (lectura.encontradas >= MINIMO_ETIQUETAS) return resultado("pdf_texto", lectura);
    // Sin etiquetas: o es un escaneo o no es este impreso. Lo distingue el OCR.
  }

  const imagenes = esPdf
    ? rasterizarPdf(fichero).map((p) => `data:image/png;base64,${p.png.toString("base64")}`)
    : [`data:${mime};base64,${fichero.toString("base64")}`];

  const r = await pedirIA({
    prompt: INSTRUCCIONES,
    imagenes: imagenes.map((url) => ({ url })),
    // Mismo propósito que el OCR de fichas técnicas: es leer un documento.
    proposito: "documento",
    // Queda registrado con nombre propio para poder mirar después cuánto se
    // está usando el camino caro y si merece la pena.
    operacion: "tacografos.anexoII.ocr",
    maxTokens: 3000,
  });
  if (!r.ok) {
    throw new ErrorTacografos(
      `No se ha podido leer el documento: ${r.error ?? "el servicio de lectura no ha respondido"}.`,
      "OCR_FALLIDO",
      502
    );
  }

  const lectura = parsearAnexoII(r.texto);
  if (lectura.encontradas < MINIMO_ETIQUETAS) {
    throw new ErrorTacografos(
      "El documento no parece el informe del anexo II: no se ha reconocido casi ninguno de sus campos.",
      "NO_ES_ANEXO_II"
    );
  }
  return resultado("ocr", lectura);
}
