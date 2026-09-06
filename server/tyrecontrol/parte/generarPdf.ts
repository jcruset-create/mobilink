import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import * as C from "./coordenadas.ts";
import { aspectoPlano, rectImagenEnPlano } from "../../../shared/planoMargen.ts";

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
  /**
   * El plano de la configuración del vehículo en Mobilink (2x2x2 y demás).
   * Tapa el diagrama de Conti360, que usa otra numeración de posiciones.
   */
  plano?: Uint8Array | null;
  /**
   * Las posiciones que se han tocado en este parte, en % del plano (0-100),
   * tal y como están calibradas en Mobilink (pos_x / pos_y). Se marcan con una
   * cruz roja al lado de la rueda: de un vistazo se ve en qué ruedas se ha
   * trabajado sin tener que cruzar la tabla con el dibujo.
   */
  marcas?: { x: number; y: number }[] | null;
}

/** PNG o JPG: pdf-lib necesita saberlo, y la imagen viene de donde viene. */
async function meterImagen(doc: PDFDocument, bytes: Uint8Array) {
  const esPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  return esPng ? doc.embedPng(bytes) : doc.embedJpg(bytes);
}

const TAM = 8;
const NEGRO = rgb(0, 0, 0);
/** El rojo de las marcas del plano. El mismo que ya usa el papel para «1 cruz por posición». */
const ROJO = rgb(0.8, 0.1, 0.1);

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

/**
 * Lo mismo, pero CENTRADO en una casilla estrecha ([izquierda, derecha]).
 *
 * Se deja un pelo de aire a cada lado para no tocar el filete, y se encoge
 * hasta caber. Es lo que hace una persona rellenando el papel: no empieza a
 * escribir pegada a la raya.
 */
function escribirEnCaja(p: PDFPage, texto: string, f: PDFFont,
                        caja: [number, number], yArriba: number, tam = TAM) {
  const t = (texto ?? "").toString().trim();
  if (!t) return;
  const ancho = caja[1] - caja[0] - 2;
  let size = tam;
  while (size > 4.5 && f.widthOfTextAtSize(t, size) > ancho) size -= 0.25;
  const w = f.widthOfTextAtSize(t, size);
  p.drawText(t, {
    x: caja[0] + (caja[1] - caja[0] - w) / 2,
    y: C.aPdf(yArriba), size, font: f, color: NEGRO,
  });
}

/**
 * Mueve el filete que separa «Ps» de «Descripción» hacia la derecha, para que
 * quepa un código de posición de Mobilink (E1_IZQ) y no se salga por encima.
 *
 * Tapar el filete viejo borra también el trocito de cada raya horizontal que
 * lo cruza, así que se vuelven a pintar. Si no, la tabla quedaría con nueve
 * mordiscos en el mismo sitio y se notaría más que el problema que arregla.
 */
function moverSeparadorPs(p: PDFPage, viejo: number, rayas: number[]) {
  const izq = viejo - 1.2, der = viejo + 1.6;
  const arriba = rayas[0], abajo = rayas[rayas.length - 1];

  p.drawRectangle({
    x: izq, y: C.aPdf(abajo), width: der - izq, height: abajo - arriba,
    color: rgb(1, 1, 1),
  });
  // Las rayas horizontales, solo en el trozo que se acaba de borrar.
  for (const y of rayas) {
    p.drawRectangle({
      x: izq, y: C.aPdf(y + 0.6), width: der - izq, height: 0.6, color: NEGRO,
    });
  }
  // Y el filete nuevo, de arriba abajo de la tabla.
  p.drawRectangle({
    x: C.SEPARADOR_PS - 0.3, y: C.aPdf(abajo),
    width: 0.6, height: abajo - arriba, color: NEGRO,
  });
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

    // El plano de Mobilink encima del diagrama de Conti360. Se tapa primero en
    // blanco: dejar el dibujo viejo asomando por detrás sería peor que no
    // poner nada.
    if (d.plano) {
      const caja = C.POSICION_RUEDAS;
      p.drawRectangle({
        x: caja.x, y: C.aPdf(caja.y + caja.alto), width: caja.ancho, height: caja.alto,
        color: rgb(1, 1, 1),
      });
      try {
        const img = await meterImagen(doc, d.plano);
        // Se encaja el PLANO (la imagen más su margen, ver shared/planoMargen)
        // sin deformarlo y centrado: un plano estirado no se parece al
        // vehículo. Las coordenadas de las ruedas son del plano entero, así
        // que la imagen va dentro, más pequeña, igual que en el panel y en la
        // tablet.
        const aspPlano = aspectoPlano(img.width / img.height);
        const an = Math.min(caja.ancho, caja.alto * aspPlano);
        const al = an / aspPlano;
        const x0 = caja.x + (caja.ancho - an) / 2;
        const y0 = caja.y + (caja.alto - al) / 2;   // desde arriba
        const ri = rectImagenEnPlano(an, al);
        p.drawImage(img, {
          x: x0 + ri.x, y: C.aPdf(y0 + ri.y + ri.alto), width: ri.ancho, height: ri.alto,
        });

        // Las ruedas en las que se ha trabajado, con una cruz roja AL LADO —
        // no encima: tapar la rueda con la marca deja el papel sin decir qué
        // rueda era. Las coordenadas son las mismas que usa la tablet.
        for (const m of d.marcas ?? []) {
          if (m.x == null || m.y == null) continue;
          const cx = x0 + (m.x / 100) * an;
          const cy = y0 + (m.y / 100) * al;
          const t = "X";
          const size = 7;
          // A la derecha de la rueda, y si se sale por el borde, a la
          // izquierda: en un remolque las posiciones llegan al filo del cuadro.
          const w = negrita.widthOfTextAtSize(t, size);
          const derecha = cx + 3 + w <= caja.x + caja.ancho - 1;
          p.drawText(t, {
            x: derecha ? cx + 3 : cx - 3 - w,
            y: C.aPdf(cy + size * 0.36),
            size, font: negrita, color: ROJO,
          });
        }
      } catch {
        // Un plano ilegible no puede tumbar el parte entero: se queda el hueco
        // en blanco y el resto del papel sale igual.
      }
    }

    // La casilla «Ps» ensanchada, en las dos tablas. Va ANTES de escribir: es
    // pintura sobre la plantilla, y el texto tiene que quedar encima.
    moverSeparadorPs(p, 42.24, C.RAYAS_DESMONTADOS);
    moverSeparadorPs(p, 41.72, C.RAYAS_MONTADOS);

    // Neumáticos de esta página.
    const desde = pag * C.DESMONTADOS.filas;
    desmontados.slice(desde, desde + C.DESMONTADOS.filas).forEach((n, i) => {
      const y = filas(C.DESMONTADOS, i);
      const col = C.DESMONTADOS.columnas;
      const caja = C.DESMONTADOS.cajas!;
      escribirEnCaja(p, n.posicion ?? "", normal, caja.posicion, y);
      escribir(p, n.descripcion ?? "", normal, col.descripcion, y, TAM, 146);
      escribirEnCaja(p, n.bar ?? "", normal, caja.bar, y);
      escribirEnCaja(p, n.serie ?? "", normal, caja.serie, y);
      escribirEnCaja(p, n.mm ?? "", normal, caja.mm, y);
      if (n.razon && C.RAZON_X[n.razon]) cruz(p, negrita, C.RAZON_X[n.razon], y);
      if (n.destino && C.DESTINO_X[n.destino]) cruz(p, negrita, C.DESTINO_X[n.destino], y);
    });

    const desdeM = pag * C.MONTADOS.filas;
    montados.slice(desdeM, desdeM + C.MONTADOS.filas).forEach((n, i) => {
      const y = filas(C.MONTADOS, i);
      const col = C.MONTADOS.columnas;
      const caja = C.MONTADOS.cajas!;
      escribirEnCaja(p, n.posicion ?? "", normal, caja.posicion, y);
      escribir(p, n.descripcion ?? "", normal, col.descripcion, y, TAM, 163);
      escribirEnCaja(p, n.origen ?? "", normal, caja.origen, y);
      escribirEnCaja(p, n.serie ?? "", normal, caja.serie, y);
      escribirEnCaja(p, n.mm ?? "", normal, caja.mm, y);
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
        const img = await meterImagen(doc, png);
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
