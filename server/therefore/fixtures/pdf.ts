/**
 * Leer la capa de texto de un PDF y volver a dibujarla.
 *
 * Es la pieza del anonimizador que más fácil se rompe en silencio, y por eso
 * vive aquí en vez de dentro del script: para poder probarla.
 *
 * ── El volteo de coordenadas ────────────────────────────────────────────────
 *
 * mupdf mide la Y desde ARRIBA de la página; pdf-lib, desde ABAJO. Si no se
 * convierte, el PDF sale del revés, y del revés no se nota al validar un JSON:
 * se nota al abrirlo, que es cuando ya nadie está mirando. La conversión es
 * `y_pdflib = alto − y_mupdf`, y está probada abajo con una línea arriba y otra
 * abajo de la página.
 *
 * ── Por qué se redibuja y no se copia ───────────────────────────────────────
 *
 * Porque el PDF nuevo no contiene ni un byte del original: ni logotipos, ni
 * metadatos del autor, ni texto oculto bajo una imagen. Sólo las líneas que se
 * han leído, en su sitio. Copiar el fichero y tachar encima deja debajo todo lo
 * que se quería quitar.
 */

import * as mupdf from "mupdf";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";

export type LineaPdf = {
  /** 1-indexada. */
  pagina: number;
  x: number;
  /** Línea base medida desde ARRIBA, como la da mupdf. */
  y: number;
  tamano: number;
  texto: string;
};

export type PaginaPdf = { numero: number; ancho: number; alto: number };

export type TextoPdf = { paginas: PaginaPdf[]; lineas: LineaPdf[] };

/** Lee el texto con su posición. Un PDF escaneado devuelve cero líneas. */
export function leerPdf(buffer: Buffer): TextoPdf {
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const paginas: PaginaPdf[] = [];
  const lineas: LineaPdf[] = [];

  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    paginas.push({ numero: i + 1, ancho: x1 - x0, alto: y1 - y0 });

    const json = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON());
    for (const bloque of json.blocks ?? []) {
      for (const linea of bloque.lines ?? []) {
        if (!linea.text) continue;
        lineas.push({
          pagina: i + 1,
          x: linea.x ?? linea.bbox?.x ?? 0,
          y: linea.y ?? linea.bbox?.y ?? 0,
          tamano: linea.font?.size ?? 9,
          texto: linea.text,
        });
      }
    }
  }
  return { paginas, lineas };
}

/** ¿Tiene capa de texto? Si no, no se puede anonimizar redibujando. */
export function tieneTexto(t: TextoPdf): boolean {
  return t.lineas.length > 0;
}

/** Helvetica sólo admite WinAnsi: lo que no entre se sustituye, no revienta. */
function paraHelvetica(texto: string, font: PDFFont): string {
  let salida = "";
  for (const c of texto) {
    try {
      font.widthOfTextAtSize(c, 10);
      salida += c;
    } catch {
      salida += "?";
    }
  }
  return salida;
}

/**
 * Dibuja las líneas en un PDF nuevo, cada una donde estaba.
 *
 * `transformar` se aplica al texto de cada línea; es por donde entra la
 * sustitución del anonimizador. Devolver el texto tal cual produce una copia
 * geométricamente fiel, que es lo que usan las pruebas.
 */
export async function redibujarPdf(
  t: TextoPdf,
  transformar: (texto: string) => string = (s) => s
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const porPagina = new Map<number, LineaPdf[]>();
  for (const l of t.lineas) {
    const lista = porPagina.get(l.pagina);
    if (lista) lista.push(l);
    else porPagina.set(l.pagina, [l]);
  }

  for (const p of t.paginas) {
    const page = doc.addPage([p.ancho, p.alto]);
    for (const l of porPagina.get(p.numero) ?? []) {
      const texto = paraHelvetica(transformar(l.texto), font);
      if (!texto.trim()) continue;
      page.drawText(texto, { x: l.x, y: p.alto - l.y, size: l.tamano, font });
    }
  }
  return Buffer.from(await doc.save());
}
