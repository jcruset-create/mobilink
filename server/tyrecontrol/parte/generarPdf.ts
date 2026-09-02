import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import * as C from "./coordenadas.ts";

/**
 * Rellena el parte de servicio Conti360.
 *
 * Se ESTAMPA sobre la plantilla original, no se redibuja: es un documento
 * contractual con Continental y su aspecto no es negociable. La plantilla es
 * un PDF nativo A4, así que el texto cae encima con precisión.
 *
 * Si no caben todos los neumáticos, se añade otra página con la MISMA
 * plantilla y se sigue. Nunca se escribe fuera de la tabla ni encima de otra
 * fila: lo que no cabe pasa a la página siguiente.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PLANTILLA = path.join(AQUI, "plantilla", "parte_conti360.pdf");

export interface NeumaticoPdf {
  posicion?: string | null;
  descripcion?: string | null;   // dimensión y modelo, como en el papel
  bar?: string | null;
  origen?: string | null;
  serie?: string | null;
  mm?: string | null;
  /** Código de motivo: pone la cruz en su columna. Solo en desmontados. */
  razon?: string | null;
  /** Código de destino: idem. */
  destino?: string | null;
}

export interface NuevoPdf {
  marca?: string | null; dimension?: string | null;
  modelo?: string | null; unidades?: string | number | null;
}

export interface PartePdf {
  numero?: string | null;
  orden_flota?: string | null;
  flota?: string | null;
  matricula?: string | null;
  km?: string | null;
  fecha?: string | null;
  lugar?: "taller" | "flota" | "carretera" | null;
  inicio_servicio?: string | null;
  inicio_mecanico?: string | null;
  fin_mecanico?: string | null;
  fin_servicio?: string | null;
  km_mecanico?: string | null;
  desmontados?: NeumaticoPdf[];
  montados?: NeumaticoPdf[];
  nuevos?: NuevoPdf[];
  /** Código de servicio → cantidad. */
  servicios?: Record<string, number | string>;
  cliente_nombre?: string | null;
  cliente_dni?: string | null;
  tecnico_nombre?: string | null;
  /** PNG de la firma, ya dibujada en la tablet. */
  firma_cliente?: Uint8Array | null;
  firma_tecnico?: Uint8Array | null;
}

const TAM = 8;
const NEGRO = rgb(0, 0, 0);

/**
 * Escribe recortando al ancho disponible en vez de desbordar.
 *
 * Un modelo largo pisando la columna de al lado deja el parte ilegible justo
 * donde importa. Primero se encoge la letra hasta 6 pt —que se sigue leyendo—
 * y solo si aún no cabe se recorta con puntos suspensivos.
 */
function escribir(p: PDFPage, texto: string, f: PDFFont, x: number, yArriba: number,
                  tam = TAM, ancho?: number) {
  let t = (texto ?? "").toString().trim();
  if (!t) return;
  let size = tam;
  if (ancho) {
    while (size > 6 && f.widthOfTextAtSize(t, size) > ancho) size -= 0.5;
    if (f.widthOfTextAtSize(t, size) > ancho) {
      while (t.length > 1 && f.widthOfTextAtSize(t + "…", size) > ancho) t = t.slice(0, -1);
      t += "…";
    }
  }
  p.drawText(t, { x, y: C.aPdf(yArriba), size, font: f, color: NEGRO });
}

function cruz(p: PDFPage, f: PDFFont, x: number, yArriba: number) {
  p.drawText("X", { x, y: C.aPdf(yArriba), size: 8, font: f, color: NEGRO });
}

function filas(t: C.Tabla, i: number): number {
  return t.primeraFila + i * t.alturaFila;
}

export async function generarPartePdf(d: PartePdf): Promise<Uint8Array> {
  const plantilla = fs.readFileSync(PLANTILLA);
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);

  const desmontados = d.desmontados ?? [];
  const montados = d.montados ?? [];
  // Cuántas páginas hacen falta: manda la tabla que más filas necesite.
  const paginas = Math.max(1,
    Math.ceil(desmontados.length / C.DESMONTADOS.filas),
    Math.ceil(montados.length / C.MONTADOS.filas));

  for (let pag = 0; pag < paginas; pag++) {
    const [copia] = await doc.copyPages(await PDFDocument.load(plantilla), [0]);
    const p = doc.addPage(copia);

    // La cabecera va en TODAS las páginas: una segunda hoja suelta sin
    // matrícula ni número no se puede archivar.
    escribir(p, d.numero ?? "", negrita, C.CABECERA.numero.x, C.CABECERA.numero.y, C.CABECERA.numero.tam, C.CABECERA.numero.ancho);
    escribir(p, d.orden_flota ?? "", normal, C.CABECERA.orden_flota.x, C.CABECERA.orden_flota.y, TAM, C.CABECERA.orden_flota.ancho);
    escribir(p, d.flota ?? "", normal, C.CABECERA.flota.x, C.CABECERA.flota.y, TAM, C.CABECERA.flota.ancho);
    escribir(p, d.matricula ?? "", negrita, C.CABECERA.matricula.x, C.CABECERA.matricula.y, 11);
    escribir(p, d.km ?? "", normal, C.CABECERA.km.x, C.CABECERA.km.y);
    escribir(p, d.fecha ?? "", normal, C.CABECERA.fecha.x, C.CABECERA.fecha.y);
    escribir(p, d.inicio_servicio ?? "", normal, C.CABECERA.inicio_servicio.x, C.CABECERA.inicio_servicio.y);
    escribir(p, d.inicio_mecanico ?? "", normal, C.CABECERA.inicio_mecanico.x, C.CABECERA.inicio_mecanico.y);
    escribir(p, d.fin_mecanico ?? "", normal, C.CABECERA.fin_mecanico.x, C.CABECERA.fin_mecanico.y);
    escribir(p, d.fin_servicio ?? "", normal, C.CABECERA.fin_servicio.x, C.CABECERA.fin_servicio.y);
    escribir(p, d.km_mecanico ?? "", normal, C.CABECERA.km_mecanico.x, C.CABECERA.km_mecanico.y);
    if (d.lugar && C.LUGAR[d.lugar]) cruz(p, negrita, C.LUGAR[d.lugar].x, C.LUGAR[d.lugar].y);

    // Neumáticos de esta página.
    const desde = pag * C.DESMONTADOS.filas;
    desmontados.slice(desde, desde + C.DESMONTADOS.filas).forEach((n, i) => {
      const y = filas(C.DESMONTADOS, i);
      const col = C.DESMONTADOS.columnas;
      escribir(p, n.posicion ?? "", normal, col.posicion, y, TAM, 24);
      escribir(p, n.descripcion ?? "", normal, col.descripcion, y, TAM, 150);
      escribir(p, n.bar ?? "", normal, col.bar, y, TAM, 32);
      escribir(p, n.serie ?? "", normal, col.serie, y, TAM, 72);
      escribir(p, n.mm ?? "", normal, col.mm, y, TAM, 20);
      if (n.razon && C.RAZON_X[n.razon]) cruz(p, negrita, C.RAZON_X[n.razon], y);
      if (n.destino && C.DESTINO_X[n.destino]) cruz(p, negrita, C.DESTINO_X[n.destino], y);
    });

    const desdeM = pag * C.MONTADOS.filas;
    montados.slice(desdeM, desdeM + C.MONTADOS.filas).forEach((n, i) => {
      const y = filas(C.MONTADOS, i);
      const col = C.MONTADOS.columnas;
      escribir(p, n.posicion ?? "", normal, col.posicion, y, TAM, 24);
      escribir(p, n.descripcion ?? "", normal, col.descripcion, y, TAM, 150);
      escribir(p, n.origen ?? "", normal, col.origen, y, TAM, 50);
      escribir(p, n.serie ?? "", normal, col.serie, y, TAM, 80);
      // La columna Mm de montados es más estrecha que la de desmontados: a 8 pt
      // el "13.0" se salía por el borde rosa.
      escribir(p, n.mm ?? "", normal, col.mm, y, 6, 13);
    });

    // Lo que solo tiene sentido una vez va en la ÚLTIMA página: los servicios
    // se facturan una vez y la firma se estampa donde se firma.
    if (pag === paginas - 1) {
      const nuevos = d.nuevos ?? [];
      if (nuevos.length > C.NUEVOS.filas) {
        // Silenciarlo sería entregar un parte al que le faltan neumáticos.
        console.warn(`[parte] ${nuevos.length} marcas de neumático nuevo y solo caben ${C.NUEVOS.filas} filas en blanco`);
      }
      nuevos.slice(0, C.NUEVOS.filas).forEach((n, i) => {
        const y = filas(C.NUEVOS, i);
        const col = C.NUEVOS.columnas;
        escribir(p, n.marca ?? "", normal, col.marca, y, TAM, 120);
        escribir(p, n.dimension ?? "", normal, col.dimension, y, TAM, 120);
        escribir(p, n.modelo ?? "", normal, col.modelo, y, TAM, 100);
        escribir(p, String(n.unidades ?? ""), normal, col.unidades, y);
      });

      for (const [codigo, cant] of Object.entries(d.servicios ?? {})) {
        const y = C.SERVICIOS_Y[codigo];
        if (y == null || cant == null || cant === "") continue;
        // La alineación no lleva cantidad: lleva una cruz en su casilla.
        if (codigo === "alineacion_standard") { cruz(p, negrita, C.ALINEACION_X.standard, y); continue; }
        if (codigo === "alineacion_compleja") { cruz(p, negrita, C.ALINEACION_X.compleja, y); continue; }
        escribir(p, String(cant), normal, C.SERVICIOS_X_CANTIDAD, y);
      }

      escribir(p, d.cliente_nombre ?? "", normal, C.FIRMAS.cliente_nombre.x, C.FIRMAS.cliente_nombre.y);
      escribir(p, d.cliente_dni ?? "", normal, C.FIRMAS.cliente_dni.x, C.FIRMAS.cliente_dni.y);
      escribir(p, d.tecnico_nombre ?? "", normal, C.FIRMAS.tecnico_nombre.x, C.FIRMAS.tecnico_nombre.y);

      for (const [png, sitio] of [
        [d.firma_cliente, C.FIRMAS.cliente_firma] as const,
        [d.firma_tecnico, C.FIRMAS.tecnico_firma] as const,
      ]) {
        if (!png) continue;
        const img = await doc.embedPng(png);
        // Se encaja dentro del recuadro sin deformarla: una firma estirada no
        // se parece a la del cliente.
        const esc = Math.min(sitio.ancho / img.width, sitio.alto / img.height, 1);
        p.drawImage(img, {
          x: sitio.x, y: C.aPdf(sitio.y + img.height * esc),
          width: img.width * esc, height: img.height * esc,
        });
      }
    }
  }

  return doc.save();
}
