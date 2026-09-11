import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import * as C from "./coordenadas.ts";
import { puntoCoordEnImagen } from "../../../shared/planoMargen.ts";

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
  /**
   * ¿Hay que cobrarlo? Un neumático que sale del almacén del cliente ya es
   * suyo: se monta, pero no se factura.
   */
  facturable?: boolean;
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
   * TODAS las posiciones del vehículo, en % del plano (0-100), tal y como
   * están calibradas en Mobilink (pos_x / pos_y). Cada una se pinta como un
   * cuadrado al lado de su rueda, con el código debajo; las que se han tocado
   * en este parte (`usada`) llevan además una cruz roja dentro. De un vistazo
   * se ve en qué ruedas se ha trabajado sin cruzar la tabla con el dibujo.
   */
  marcas?: { x: number; y: number; w?: number | null; h?: number | null;
              codigo?: string | null; usada?: boolean }[] | null;
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
    // El número del parte se escribe con su rótulo, alineado a la derecha
    // (ver el bloque del cuadro de posición de ruedas).
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

    // La esquina superior derecha es nuestra: se tapa entera —logos de
    // Continental y Conti360 incluidos— y se vuelve a dibujar el cuadro con su
    // rótulo. Se hace SIEMPRE, haya plano o no: un parte de Mobilink con el
    // logo de otra marca no es el parte de Mobilink.
    {
      // El distintivo Conti 360° de la cabecera, entre los logotipos de la
      // casa: el parte de Mobilink no lleva marcas de Continental.
      const c3 = C.CONTI360;
      p.drawRectangle({
        x: c3.x, y: C.aPdf(c3.y + c3.alto), width: c3.ancho, height: c3.alto, color: rgb(1, 1, 1),
      });

      // «Parte de Servicio nº 000304», pegado a la derecha: el final del
      // número queda a plomo con el borde del cuadro de posición de ruedas.
      const t = C.TITULO_PARTE;
      p.drawRectangle({
        x: t.limpiar.x, y: C.aPdf(t.limpiar.y + t.limpiar.alto),
        width: t.limpiar.ancho, height: t.limpiar.alto, color: rgb(1, 1, 1),
      });
      const rotulo = "Parte de Servicio nº ";
      const num = (d.numero ?? "").toString().trim();
      const anchoRotulo = negrita.widthOfTextAtSize(rotulo, t.tam);
      const anchoNum = negrita.widthOfTextAtSize(num, t.tamNumero);
      const x0Titulo = t.derecha - anchoNum - anchoRotulo;
      p.drawText(rotulo, { x: x0Titulo, y: C.aPdf(t.y), size: t.tam, font: negrita, color: NEGRO });
      if (num) {
        p.drawText(num, {
          x: t.derecha - anchoNum, y: C.aPdf(t.y), size: t.tamNumero, font: negrita, color: NEGRO,
        });
      }

      const limpiar = C.POSICION_RUEDAS_LIMPIAR;
      p.drawRectangle({
        x: limpiar.x, y: C.aPdf(limpiar.y + limpiar.alto),
        width: limpiar.ancho, height: limpiar.alto, color: rgb(1, 1, 1),
      });
      const marco = C.POSICION_RUEDAS_MARCO;
      p.drawRectangle({
        x: marco.x, y: C.aPdf(marco.y + marco.alto),
        width: marco.ancho, height: marco.alto,
        borderColor: NEGRO, borderWidth: 0.8,
      });
      escribir(p, "Posición Ruedas", normal,
               C.POSICION_RUEDAS_TITULO.x, C.POSICION_RUEDAS_TITULO.y, C.POSICION_RUEDAS_TITULO.tam);
    }

    if (d.plano) {
      const caja = C.POSICION_RUEDAS;
      const cu = C.CUADRO_POSICION;
      try {
        const img = await meterImagen(doc, d.plano);
        // El vehículo, LO MÁS GRANDE que quepa dejando a cada lado el sitio
        // justo de un cuadradito de posición. En la pantalla ese hueco es un
        // 22 % porque ahí las etiquetas llevan marca, medida y milímetros;
        // aquí solo cabe una cruz, así que se mide en puntos y la foto gana
        // todo lo demás.
        const hueco = cu.lado + cu.separacion + 2;
        const dentro = {
          x: caja.x + hueco, y: caja.y,
          ancho: caja.ancho - 2 * hueco, alto: caja.alto - cu.tamCodigo - 2,
        };
        const esc = Math.min(dentro.ancho / img.width, dentro.alto / img.height);
        const an = img.width * esc, al = img.height * esc;
        const x0 = dentro.x + (dentro.ancho - an) / 2;
        const y0 = dentro.y + (dentro.alto - al) / 2;   // desde arriba
        p.drawImage(img, { x: x0, y: C.aPdf(y0 + al), width: an, height: al });

        // Un cuadrado AL LADO de cada rueda —no encima: tapar la rueda con la
        // marca deja el papel sin decir qué rueda era—, con el código de la
        // posición debajo. Las que se han tocado en este parte llevan la cruz
        // roja dentro; las demás quedan en blanco, y así el papel enseña el
        // vehículo entero. Las coordenadas son las mismas que usa la tablet.
        for (const m of d.marcas ?? []) {
          if (m.x == null || m.y == null) continue;
          // El cuadro va donde el técnico dejó la etiqueta al calibrar: en su
          // CENTRO. Esas etiquetas ya están puestas al lado de su rueda, así
          // que no hay que inventarse ningún desplazamiento.
          const f = puntoCoordEnImagen(m.x + (m.w ?? 0) / 2, m.y + (m.h ?? 0) / 2);
          const cx = x0 + f.fx * an;
          const cy = y0 + f.fy * al;
          // Y sin salirse del cuadro, pase lo que pase con la calibración.
          const qx = Math.min(Math.max(cx - cu.lado / 2, caja.x + 1),
                              caja.x + caja.ancho - cu.lado - 1);
          const qy = Math.min(Math.max(cy - cu.lado / 2, caja.y + 1),
                              caja.y + caja.alto - cu.lado - cu.tamCodigo - 1);
          p.drawRectangle({
            x: qx, y: C.aPdf(qy + cu.lado), width: cu.lado, height: cu.lado,
            color: rgb(1, 1, 1), borderColor: NEGRO, borderWidth: 0.8,
          });
          if (m.usada !== false) {
            const w = negrita.widthOfTextAtSize("X", cu.tamCruz);
            p.drawText("X", {
              x: qx + (cu.lado - w) / 2,
              y: C.aPdf(qy + cu.lado - (cu.lado - cu.tamCruz * 0.72) / 2),
              size: cu.tamCruz, font: negrita, color: ROJO,
            });
          }
          const cod = (m.codigo ?? "").trim();
          if (cod) {
            escribirEnCaja(p, cod, normal, [qx - 7, qx + cu.lado + 7],
                           qy + cu.lado + cu.tamCodigo, cu.tamCodigo);
          }
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
      // Las cuatro filas con Continental y Semperit preimpresas: se tapan sus
      // rellenos de color y se devuelve la rejilla, para que las seis filas
      // queden iguales y sirvan para cualquier marca.
      for (const f of C.NUEVOS_FONDOS) {
        p.drawRectangle({
          x: f.x, y: C.aPdf(f.y + f.alto), width: f.ancho, height: f.alto, color: rgb(1, 1, 1),
        });
      }
      for (const f of C.NUEVOS_REJILLA.filas) {
        p.drawRectangle({
          x: C.NUEVOS_REJILLA.x, y: C.aPdf(f.y + f.alto),
          width: C.NUEVOS_REJILLA.ancho, height: f.alto,
          borderColor: NEGRO, borderWidth: C.NUEVOS_REJILLA.grosor,
        });
        p.drawLine({
          start: { x: C.NUEVOS_REJILLA.columnaUnidades, y: C.aPdf(f.y) },
          end:   { x: C.NUEVOS_REJILLA.columnaUnidades, y: C.aPdf(f.y + f.alto) },
          thickness: C.NUEVOS_REJILLA.grosor, color: NEGRO,
        });
      }

      // Cuántos neumáticos nuevos hay que facturar: los que NO han salido del
      // almacén del cliente, que ya son suyos y están pagados.
      const aFacturar = nuevos.reduce((n, x) => n + (x.facturable === false ? 0 : Number(x.unidades ?? 0)), 0);
      if (aFacturar > 0) {
        const t = C.NUEVOS_TOTAL;
        escribirEnCaja(p, String(aFacturar), negrita, [t.x, t.x + t.ancho],
                       t.y + (t.alto + t.tam * 0.72) / 2, t.tam);
      }

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
        const an = img.width * esc, al = img.height * esc;
        // Centrada en su casilla: descuadrada a un lado parece de otro sitio.
        p.drawImage(img, {
          x: sitio.x + (sitio.ancho - an) / 2,
          y: C.aPdf(sitio.y + (sitio.alto - al) / 2 + al),
          width: an, height: al,
        });
      }
    }
  }

  return doc.save();
}
