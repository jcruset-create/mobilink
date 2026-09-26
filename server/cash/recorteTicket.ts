/**
 * Qué páginas de un PDF escaneado son tickets, y dónde tienen la tinta.
 *
 * El escáner deja blanco alrededor del ticket: 10-15 mm por lado en los del
 * bar. Quitarlo es lo que hace que quepan 4 dietas o 6 peajes por hoja al
 * 100 % en vez de 2 o 3. Aquí se rasteriza cada página a baja resolución con
 * `mupdf` —la misma librería que ya lee las fichas técnicas— y se busca la
 * caja con tinta. El escaneo no se toca: solo se decide qué trozo se enseña.
 *
 * Lo que no se entiende se deja como estaba: una página girada, una que
 * `mupdf` no abre o una en blanco no es un ticket y va en su hoja, como antes.
 */

import * as mupdf from "mupdf";
import type { PDFDocument } from "pdf-lib";
import {
  cabeSolo,
  cajaDeTinta,
  esTicket,
  ESCALA_MINIMA,
  PT_POR_MM,
  recorteFiable,
  type Tamano,
  type Zona,
} from "./domain/mosaico.ts";

/**
 * Resolución del rasterizado para buscar la tinta: 72 ppp, un píxel ≈ 0,35 mm.
 * Con 36 ppp los trazos finos de un ticket desvaído se promediaban con el
 * blanco y desaparecían.
 */
const ESCALA_RASTER = 1;
/** Aire que se deja alrededor de la tinta. */
const AIRE_MM = 2;

export type PaginaDeTicket = {
  indice: number;
  /** El trozo con tinta, en coordenadas PDF de la página: lo que se incrusta. */
  caja: { left: number; bottom: number; right: number; top: number };
  tamano: Tamano;
};

/**
 * Las páginas de un PDF que van al mosaico. Las que no aparecen aquí se añaden
 * enteras, como siempre.
 */
export function paginasDeTicket(contenido: Uint8Array, fuente: PDFDocument, zona: Zona): PaginaDeTicket[] {
  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(contenido, "application/pdf");
  } catch {
    return [];
  }
  const tickets: PaginaDeTicket[] = [];
  const paginas = fuente.getPages();
  for (let i = 0; i < paginas.length; i++) {
    try {
      const pagina = paginas[i]!;
      // Girada: la caja de mupdf y la de pdf-lib no hablan del mismo sistema. Como antes.
      if (pagina.getRotation().angle % 360 !== 0) continue;
      const recorte = pagina.getCropBox();

      const m = doc.loadPage(i);
      const [bx0, by0, bx1, by1] = m.getBounds();
      // Si mupdf no ve la misma página que pdf-lib (UserUnit, cajas raras), no se arriesga.
      if (Math.abs(bx1 - bx0 - recorte.width) > 1 || Math.abs(by1 - by0 - recorte.height) > 1) continue;

      const px = m.toPixmap(mupdf.Matrix.scale(ESCALA_RASTER, ESCALA_RASTER), mupdf.ColorSpace.DeviceGray, false, true);
      const tinta = cajaDeTinta(px.getPixels(), px.getWidth(), px.getHeight(), px.getStride());
      if (!tinta) continue;

      const aire = AIRE_MM * PT_POR_MM;
      let x0 = Math.max(0, tinta.x0 / ESCALA_RASTER - aire);
      let x1 = Math.min(recorte.width, tinta.x1 / ESCALA_RASTER + aire);
      let y0 = Math.max(0, tinta.y0 / ESCALA_RASTER - aire);
      let y1 = Math.min(recorte.height, tinta.y1 / ESCALA_RASTER + aire);

      const enMm = (t: Tamano) => ({ ancho: t.ancho / PT_POR_MM, alto: t.alto / PT_POR_MM });
      const original = enMm({ ancho: recorte.width, alto: recorte.height });
      // Un recorte que se come medio ticket no es de fiar: la página entera.
      if (!recorteFiable(original, enMm({ ancho: x1 - x0, alto: y1 - y0 }))) {
        x0 = 0;
        y0 = 0;
        x1 = recorte.width;
        y1 = recorte.height;
      }
      const tamano = { ancho: x1 - x0, alto: y1 - y0 };
      if (!esTicket(original, enMm(tamano))) continue;
      if (!cabeSolo(tamano, zona, ESCALA_MINIMA)) continue;

      // El raster cuenta desde arriba; el PDF, desde abajo.
      tickets.push({
        indice: i,
        caja: {
          left: recorte.x + x0,
          right: recorte.x + x1,
          top: recorte.y + recorte.height - y0,
          bottom: recorte.y + recorte.height - y1,
        },
        tamano,
      });
    } catch {
      // Una página que no se deja leer va entera, como antes.
    }
  }
  return tickets;
}
