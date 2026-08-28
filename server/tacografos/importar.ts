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
import { aDatosExpediente, parsearAnexoII } from "./anexoII.ts";
import { aDatosExpedienteInfTec, parsearInfTec } from "./infTec.ts";
import type { Lectura } from "./cotejo.ts";
import { ErrorTacografos } from "./errors.ts";
import type { DatosExpediente } from "./domain.ts";

/** Por debajo de esto se da por hecho que el PDF es un escaneo sin texto. */
const MINIMO_ETIQUETAS = 6;

export type Origen = "pdf_texto" | "ocr";

/** Cuál de los dos impresos de la extranet se ha reconocido. */
export type Impreso = "anexo_ii" | "informe_tecnico";

export type Importacion = {
  origen: Origen;
  impreso: Impreso;
  datos: Partial<DatosExpediente>;
  /** Lo leído en crudo, para que la pantalla enseñe qué ha salido de dónde. */
  campos: Record<string, string>;
  /** Etiquetas del impreso que no se han encontrado. */
  avisos: string[];
  encontradas: number;
  total: number;
};

/**
 * Texto de todas las páginas de un PDF, **bloque a bloque**.
 *
 * No vale `asText()`: en los impresos de la extranet aplana las dos columnas
 * por posición y separa cada etiqueta de su valor —en la sección I del informe
 * técnico el nº de serie acababa tres líneas más abajo, tras un «NO» de otra
 * casilla—. En los bloques de `asJSON()`, etiqueta y valor vienen juntos, que
 * es la adyacencia que exige el cotejo. Verificado con un InfTec real.
 */
export function textoDePdf(buffer: Buffer): string {
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const paginas: string[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const st = doc.loadPage(i).toStructuredText("preserve-whitespace");
    try {
      const { blocks } = JSON.parse(st.asJSON()) as {
        blocks: Array<{ lines?: Array<{ text?: string }> }>;
      };
      paginas.push(
        blocks.map((b) => (b.lines ?? []).map((l) => l.text ?? "").join("\n")).join("\n")
      );
    } catch {
      // Si el JSON estructurado fallara, mejor un texto aplanado que ninguno.
      paginas.push(st.asText());
    }
  }
  return paginas.join("\n");
}

/**
 * Prueba los dos impresos y se queda con el que más etiquetas reconoce.
 *
 * En proporción, no en absoluto: el anexo II tiene 29 etiquetas y el informe
 * técnico 9, y comparar recuentos en bruto haría ganar siempre al largo.
 */
function reconocer(texto: string): { impreso: Impreso; lectura: Lectura } {
  const anexo = parsearAnexoII(texto);
  const infTec = parsearInfTec(texto);
  return anexo.encontradas / anexo.total >= infTec.encontradas / infTec.total
    ? { impreso: "anexo_ii", lectura: anexo }
    : { impreso: "informe_tecnico", lectura: infTec };
}

function resultado(origen: Origen, impreso: Impreso, lectura: Lectura): Importacion {
  return {
    origen,
    impreso,
    datos:
      impreso === "anexo_ii"
        ? aDatosExpediente(lectura.campos)
        : aDatosExpedienteInfTec(lectura.campos),
    campos: lectura.campos,
    avisos: lectura.avisos,
    encontradas: lectura.encontradas,
    total: lectura.total,
  };
}

const INSTRUCCIONES = `Eres un perito que digitaliza los impresos oficiales de
tacógrafos que emite la extranet de VDO: el "Informe sobre transferencia de
datos / certificado de intransferibilidad" (anexo II del Real decreto 125/2017,
campos numerados del 1 al 27) o el "Informe técnico" de la intervención
(casillas A1…W).

Transcribe el documento TAL CUAL, cada etiqueta con su valor debajo:

<etiqueta exactamente como aparece, con su numeración>
<valor>

No interpretes, no corrijas y no completes: si un campo está en blanco, deja la
línea del valor vacía. Conserva las líneas de cabecera con el número de
informe/certificado y la fecha. Devuelve sólo esa transcripción, sin
comentarios.`;

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
    const { impreso, lectura } = reconocer(texto);
    if (lectura.encontradas >= MINIMO_ETIQUETAS) return resultado("pdf_texto", impreso, lectura);
    // Sin etiquetas: o es un escaneo o no es ninguno de los dos impresos. Lo
    // distingue el OCR.
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

  const { impreso, lectura } = reconocer(r.texto);
  if (lectura.encontradas < MINIMO_ETIQUETAS) {
    throw new ErrorTacografos(
      "El documento no parece ninguno de los impresos de la extranet (anexo II o informe técnico): no se ha reconocido casi ninguno de sus campos.",
      "NO_ES_ANEXO_II"
    );
  }
  return resultado("ocr", impreso, lectura);
}
