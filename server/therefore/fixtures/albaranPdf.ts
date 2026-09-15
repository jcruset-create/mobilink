/**
 * Fabrica PDF de albaranes para las pruebas.
 *
 * Vive fuera de los ficheros de prueba porque lo usan varios —el lector de
 * texto, el análisis completo y las de integración—, y porque generar el papel
 * en el momento tiene una ventaja que no es de comodidad: **ningún valor real
 * llega nunca al repositorio**. Todo lo que se imprime aquí está inventado y
 * escrito a la vista, y el día que alguien quiera probar un caso nuevo lo
 * escribe igual, sin adjuntar un documento de un proveedor.
 *
 * Reproduce las formas que el parser tiene que aguantar: varios albaranes en
 * una factura, uno partido entre dos páginas con cabecera y pie repetidos, un
 * concepto global detrás de las líneas, descuentos encadenados y una tabla sin
 * títulos de columna.
 */

import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

export type LineaFixture = {
  ref: string;
  desc: string;
  cant: string;
  precio: string;
  /** Tal y como se imprime: `60% + 10%`, `40%`, `-`. */
  dto: string;
  importe: string;
};

export type AlbaranFixture = {
  /** Cómo lo escribe el documento: `0501234`, `ENT-770199-0501234`. */
  numero: string | null;
  lineas: LineaFixture[];
  matricula?: string;
  bastidor?: string;
  observaciones?: string;
  fecha?: string;
  /** Empezar este albarán en una página nueva. */
  paginaNueva?: boolean;
  /** Partir sus líneas: las primeras `n` en esta página y el resto en la siguiente. */
  partirTras?: number;
};

export type FacturaFixture = {
  proveedor?: string;
  facturaNumero?: string;
  fecha?: string;
  albaranes: AlbaranFixture[];
  /** Portes, tasas: se imprimen tras las líneas del último albarán. */
  conceptos?: { etiqueta: string; importe: string }[];
  /** Pie de factura. Sin él, la última sección cierra al acabar el documento. */
  totales?: { base: string; iva?: string; total: string };
  /** Sin cabecera de columnas, para probar el modo posicional. */
  sinCabeceraDeTabla?: boolean;
  /** Cabecera y pie repetidos en todas las páginas. */
  conCabeceraYPie?: boolean;
};

const COLUMNAS = { ref: 40, desc: 120, cant: 300, precio: 350, dto: 425, importe: 500 };
const ALTO = 842;
const ANCHO = 595;

/** Un escritor que baja solo y abre página cuando se acaba el papel. */
class Hoja {
  pagina: PDFPage;
  y: number;
  numero = 1;

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly factura: FacturaFixture
  ) {
    this.pagina = doc.addPage([ANCHO, ALTO]);
    this.y = ALTO - 40;
    this.adornos();
  }

  private adornos(): void {
    if (!this.factura.conCabeceraYPie) return;
    // Mismo texto y misma posición en todas las páginas: es lo que el parser
    // tiene que retirar para que un albarán partido siga siendo uno solo.
    this.pagina.drawText(this.factura.proveedor ?? "PROVEEDOR EJEMPLO SL", {
      x: 40,
      y: ALTO - 25,
      size: 8,
      font: this.font,
    });
    this.pagina.drawText(`Pagina ${this.numero}`, { x: 480, y: 25, size: 8, font: this.font });
  }

  escribir(texto: string, x: number, size = 9): void {
    this.pagina.drawText(texto, { x, y: this.y, size, font: this.font });
  }

  bajar(px = 14): void {
    this.y -= px;
    if (this.y < 80) this.nuevaPagina();
  }

  nuevaPagina(): void {
    this.pagina = this.doc.addPage([ANCHO, ALTO]);
    this.numero++;
    this.y = ALTO - 60;
    this.adornos();
  }
}

function cabeceraDeTabla(hoja: Hoja): void {
  hoja.escribir("Ref", COLUMNAS.ref);
  hoja.escribir("Descripcion", COLUMNAS.desc);
  hoja.escribir("Cant", COLUMNAS.cant);
  hoja.escribir("Precio", COLUMNAS.precio);
  hoja.escribir("Dto", COLUMNAS.dto);
  hoja.escribir("Importe", COLUMNAS.importe);
  hoja.bajar();
}

function escribirLinea(hoja: Hoja, l: LineaFixture): void {
  hoja.escribir(l.ref, COLUMNAS.ref);
  hoja.escribir(l.desc, COLUMNAS.desc);
  hoja.escribir(l.cant, COLUMNAS.cant);
  hoja.escribir(l.precio, COLUMNAS.precio);
  hoja.escribir(l.dto, COLUMNAS.dto);
  hoja.escribir(l.importe, COLUMNAS.importe);
  hoja.bajar();
}

export async function pdfDeFactura(factura: FacturaFixture): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const hoja = new Hoja(doc, font, factura);

  hoja.escribir(factura.proveedor ?? "PROVEEDOR EJEMPLO SL", 40, 12);
  hoja.bajar(20);
  hoja.escribir(`Factura: ${factura.facturaNumero ?? "F-2026-0001"}`, 40);
  hoja.escribir(`Fecha: ${factura.fecha ?? "02/09/2026"}`, 380);
  hoja.bajar(24);

  for (const albaran of factura.albaranes) {
    if (albaran.paginaNueva) hoja.nuevaPagina();

    if (albaran.numero) {
      hoja.escribir(`Albaran: ${albaran.numero}`, 40);
      if (albaran.fecha) hoja.escribir(`Fecha: ${albaran.fecha}`, 380);
      hoja.bajar();
    }
    if (albaran.matricula) {
      hoja.escribir(`Matricula: ${albaran.matricula}`, 40);
      if (albaran.bastidor) hoja.escribir(`Bastidor: ${albaran.bastidor}`, 200);
      hoja.bajar();
    }
    if (albaran.observaciones) {
      hoja.escribir(`Observaciones: ${albaran.observaciones}`, 40);
      hoja.bajar();
    }

    if (!factura.sinCabeceraDeTabla) cabeceraDeTabla(hoja);

    albaran.lineas.forEach((l, i) => {
      if (albaran.partirTras !== undefined && i === albaran.partirTras) hoja.nuevaPagina();
      escribirLinea(hoja, l);
    });
    hoja.bajar(6);
  }

  for (const c of factura.conceptos ?? []) {
    hoja.escribir(c.etiqueta, COLUMNAS.desc);
    hoja.escribir(c.importe, COLUMNAS.importe);
    hoja.bajar();
  }

  if (factura.totales) {
    hoja.bajar(6);
    hoja.escribir("Base imponible", COLUMNAS.precio);
    hoja.escribir(factura.totales.base, COLUMNAS.importe);
    hoja.bajar();
    if (factura.totales.iva) {
      hoja.escribir("IVA", COLUMNAS.precio);
      hoja.escribir(factura.totales.iva, COLUMNAS.importe);
      hoja.bajar();
    }
    hoja.escribir("Total factura", COLUMNAS.precio);
    hoja.escribir(factura.totales.total, COLUMNAS.importe);
  }

  return Buffer.from(await doc.save());
}

/**
 * Un PDF sin capa de texto, para probar el camino del escaneado.
 *
 * Es una página en blanco: lo que importa de un escaneado, para este módulo, es
 * que no tiene texto que leer.
 */
export async function pdfEscaneado(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([ANCHO, ALTO]);
  return Buffer.from(await doc.save());
}
