import * as mupdf from "mupdf";

/**
 * Convierte un PDF a imágenes (una por página) para que el modelo de visión
 * pueda leerlo: la Responses API no interpreta el contenido de un PDF
 * escaneado, solo lo que se le manda como imagen.
 *
 * mupdf es una librería WASM autocontenida (sin Ghostscript ni Poppler que
 * instalar en el sistema), por eso funciona igual en local que en Render.
 */

const ESCALA = 2;         // ~144 DPI: suficiente para leer texto de ficha técnica
const MAX_PAGINAS = 20;   // tope de seguridad; una ficha técnica no pasa de esto

export interface PaginaRasterizada {
  numero: number;
  png: Buffer;
}

export function rasterizarPdf(buffer: Buffer): PaginaRasterizada[] {
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const total = Math.min(doc.countPages(), MAX_PAGINAS);
  if (total <= 0) throw new Error("El PDF no tiene páginas legibles");

  const paginas: PaginaRasterizada[] = [];
  for (let i = 0; i < total; i++) {
    const page = doc.loadPage(i);
    const pix = page.toPixmap(mupdf.Matrix.scale(ESCALA, ESCALA), mupdf.ColorSpace.DeviceRGB, false, true);
    paginas.push({ numero: i + 1, png: Buffer.from(pix.asPNG()) });
  }
  return paginas;
}
