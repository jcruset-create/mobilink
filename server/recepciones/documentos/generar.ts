/**
 * El albarán recepcionado: el original del proveedor más la hoja del sello.
 *
 * Es el justificante físico de la recepción: lo que se imprime, se firma y se
 * archiva, y lo que después una persona lleva a GENES para dar entrada al
 * albarán. Por eso el sello lleva, grande, lo que hay que ver de lejos: OK o
 * CON INCIDENCIA, y quién, cuándo y con qué número.
 *
 * ── Cómo se monta ───────────────────────────────────────────────────────────
 *
 * · La hoja del sello se dibuja con pdfkit (que sabe maquetar).
 * · Si el albarán tiene ORIGINAL, se COPIAN sus páginas con pdf-lib a un
 *   documento nuevo y se añade el sello al final (pdfkit no sabe incrustar
 *   páginas de otro PDF; es el mismo reparto que en `cash/report.ts`).
 * · El original NUNCA se toca: se lee del bucket y se copia; el fichero
 *   guardado sigue siendo byte a byte el que llegó, con su hash.
 * · Si el original no se puede abrir (cifrado, corrupto), el recepcionado
 *   sale con el sello y una página de aviso, y se dice.
 *
 * El nombre del fichero lleva el número de recepción y no sólo el del
 * albarán —`SOLEDAD_2028450461_REC-2026-00000012.pdf`— porque un albarán
 * puede recepcionarse en dos veces, y dos ficheros con el mismo nombre serían
 * uno que pisa a otro.
 */

import PDFDocument from "pdfkit";
import { PDFDocument as PDFLib, StandardFonts, rgb } from "pdf-lib";
import { leerDescripcion } from "../domain/articulos.ts";
import { ETIQUETA_TIPO_INCIDENCIA, type TipoIncidencia } from "../domain/estados.ts";
import { ErrorRecepciones } from "../errors.ts";
import * as repo from "../repository.ts";
import { guardarDocumento, hashDeFichero, leerDocumento, rutaDocumento } from "../storage.ts";

const M = 48;
const TINTA = "#111827";
const GRIS = "#6b7280";
const VERDE = "#059669";
const AMBAR = "#d97706";

export type DatosSello = {
  proveedorNombre: string;
  pedidoNumero: string;
  albaranNumero: string;
  transportista: string | null;
  centroNombre: string;
  /** Quien contó la mercancía: el operario que puso su PIN, si lo hubo. */
  recibidoNombre: string;
  /** La sesión desde la que se cerró, cuando no es la misma persona. */
  registradoNombre: string | null;
  recibidoAt: Date;
  resultado: "OK" | "CON_INCIDENCIA";
  numeroRecepcion: string;
  observaciones: string | null;
  lineas: {
    producto: string;
    descripcionProveedor: string;
    esperada: number;
    recibida: number;
    diferencia: number;
  }[];
  incidencias: {
    producto: string;
    esperada: number;
    recibida: number;
    diferencia: number;
    tipo: TipoIncidencia;
    observaciones: string | null;
  }[];
  rectificaciones: { numero: string; motivo: string; nombre: string; fecha: Date; cambios: string }[];
  /** Cuando el original no se ha podido incrustar. */
  avisoOriginal: string | null;
};

const fmtCantidad = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, ""));
const fmtDiferencia = (n: number): string => (n > 0 ? `+${fmtCantidad(n)}` : fmtCantidad(n));

function fechaHora(d: Date): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat("es-ES", {
    timeZone: process.env.AGENDA_TIME_ZONE || "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return { fecha: `${v("day")}/${v("month")}/${v("year")}`, hora: `${v("hour")}:${v("minute")}` };
}

/** Dibuja la hoja del sello. Función pura salvo por pdfkit: entra un objeto, sale un PDF. */
export function dibujarSello(d: DatosSello): Promise<Buffer> {
  const doc = new PDFDocument({ margin: M, size: "A4" });
  const trozos: Buffer[] = [];
  doc.on("data", (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(trozos))));

  const ancho = doc.page.width - M * 2;
  const ok = d.resultado === "OK";
  const color = ok ? VERDE : AMBAR;
  const { fecha, hora } = fechaHora(d.recibidoAt);

  // Cabecera
  doc.rect(0, 0, doc.page.width, 64).fill("#101a33");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(20).text("RECEPCIÓN MOBILINK", M, 20, { lineBreak: false });
  doc.font("Helvetica").fontSize(10).fillColor("#cbd5e1").text(d.numeroRecepcion, M, 44, { lineBreak: false });
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#ffffff")
    .text(d.centroNombre || "", M, 44, { width: ancho, align: "right", lineBreak: false });

  // Datos
  doc.fillColor(TINTA);
  let y = 90;
  const fila = (rotulo: string, valor: string, negrita = false) => {
    doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(rotulo.toUpperCase(), M, y, { lineBreak: false });
    doc
      .font(negrita ? "Helvetica-Bold" : "Helvetica")
      .fontSize(12)
      .fillColor(TINTA)
      .text(valor, M + 130, y - 2, { width: ancho - 130 });
    y = Math.max(y + 20, doc.y + 6);
  };
  fila("Proveedor", d.proveedorNombre, true);
  fila("Pedido", d.pedidoNumero);
  fila("Albarán", d.albaranNumero, true);
  if (d.transportista) fila("Transportista", d.transportista);
  fila("Recibido por", d.recibidoNombre, true);
  // Quién lo contó y desde qué sesión se registró son dos cosas distintas, y
  // el papel tiene que poder responder a las dos.
  if (d.registradoNombre && d.registradoNombre !== d.recibidoNombre) fila("Registrado desde", d.registradoNombre);
  fila("Fecha", fecha);
  fila("Hora", hora);

  // El resultado, en grande: es lo que se ve de lejos.
  y += 10;
  doc.roundedRect(M, y, ancho, 78, 10).fill(color);
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(ok ? 40 : 28)
    .text(ok ? "OK" : "CON INCIDENCIA", M, y + (ok ? 16 : 22), { width: ancho, align: "center", lineBreak: false });
  y += 92;
  doc
    .fillColor(TINTA)
    .font("Helvetica")
    .fontSize(12)
    .text(
      ok ? "Mercancía recibida conforme al albarán." : "La mercancía recibida NO coincide con el albarán. Detalle a continuación.",
      M,
      y,
      { width: ancho, align: "center" }
    );
  y = doc.y + 16;

  // Líneas recibidas
  doc.font("Helvetica-Bold").fontSize(10).fillColor(GRIS).text("LÍNEAS RECIBIDAS", M, y);
  y = doc.y + 4;
  const cols = { producto: M, esperada: M + ancho - 190, recibida: M + ancho - 125, dif: M + ancho - 60 };
  doc.font("Helvetica").fontSize(8).fillColor(GRIS);
  doc.text("Producto", cols.producto, y, { lineBreak: false });
  doc.text("Albarán", cols.esperada, y, { width: 60, align: "right", lineBreak: false });
  doc.text("Recibido", cols.recibida, y, { width: 60, align: "right", lineBreak: false });
  doc.text("Dif.", cols.dif, y, { width: 60, align: "right", lineBreak: false });
  y += 12;
  doc.moveTo(M, y).lineTo(M + ancho, y).strokeColor("#d1d5db").stroke();
  y += 6;
  for (const l of d.lineas) {
    if (y > doc.page.height - 120) {
      doc.addPage();
      y = M;
    }
    doc.font("Helvetica-Bold").fontSize(11).fillColor(TINTA).text(l.producto, cols.producto, y, { width: cols.esperada - cols.producto - 8 });
    const yFin = doc.y;
    doc.font("Helvetica").fontSize(11).fillColor(TINTA);
    doc.text(fmtCantidad(l.esperada), cols.esperada, y, { width: 60, align: "right", lineBreak: false });
    doc.text(fmtCantidad(l.recibida), cols.recibida, y, { width: 60, align: "right", lineBreak: false });
    doc
      .fillColor(l.diferencia === 0 ? VERDE : "#dc2626")
      .font("Helvetica-Bold")
      .text(fmtDiferencia(l.diferencia), cols.dif, y, { width: 60, align: "right", lineBreak: false });
    if (l.descripcionProveedor && l.descripcionProveedor !== l.producto) {
      doc.font("Helvetica").fontSize(8).fillColor(GRIS).text(l.descripcionProveedor, cols.producto, yFin, { width: cols.esperada - cols.producto - 8 });
    }
    y = Math.max(doc.y, yFin) + 8;
  }

  // Incidencias
  if (d.incidencias.length > 0) {
    y += 8;
    if (y > doc.page.height - 160) {
      doc.addPage();
      y = M;
    }
    doc.font("Helvetica-Bold").fontSize(10).fillColor(AMBAR).text("INCIDENCIAS", M, y);
    y = doc.y + 6;
    for (const i of d.incidencias) {
      if (y > doc.page.height - 140) {
        doc.addPage();
        y = M;
      }
      doc.roundedRect(M, y, ancho, 4, 2).fill(AMBAR);
      y += 10;
      doc.font("Helvetica-Bold").fontSize(12).fillColor(TINTA).text(i.producto, M, y, { width: ancho });
      y = doc.y + 4;
      const dato = (r: string, v: string) => {
        doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(r, M, y, { lineBreak: false });
        doc.font("Helvetica-Bold").fontSize(11).fillColor(TINTA).text(v, M + 110, y - 2, { width: ancho - 110 });
        y = Math.max(y + 16, doc.y + 4);
      };
      dato("Albarán", `${fmtCantidad(i.esperada)} unidad(es)`);
      dato("Recibidas", `${fmtCantidad(i.recibida)} unidad(es)`);
      dato("Diferencia", fmtDiferencia(i.diferencia));
      dato("Tipo", ETIQUETA_TIPO_INCIDENCIA[i.tipo] ?? i.tipo);
      if (i.observaciones) {
        doc.font("Helvetica").fontSize(9).fillColor(GRIS).text("Observaciones", M, y, { lineBreak: false });
        doc.font("Helvetica").fontSize(11).fillColor(TINTA).text(i.observaciones, M + 110, y - 2, { width: ancho - 110 });
        y = doc.y + 6;
      }
      y += 8;
    }
  }

  if (d.observaciones) {
    y += 6;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(GRIS).text("OBSERVACIONES", M, y);
    doc.font("Helvetica").fontSize(11).fillColor(TINTA).text(d.observaciones, M, doc.y + 2, { width: ancho });
    y = doc.y + 8;
  }

  if (d.rectificaciones.length > 0) {
    y += 6;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#dc2626").text("RECTIFICACIONES", M, y);
    y = doc.y + 4;
    for (const r of d.rectificaciones) {
      const fh = fechaHora(r.fecha);
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(TINTA)
        .text(`${r.numero} · ${fh.fecha} ${fh.hora} · ${r.nombre} · ${r.motivo} · ${r.cambios}`, M, y, { width: ancho });
      y = doc.y + 4;
    }
  }

  if (d.avisoOriginal) {
    y += 6;
    doc.font("Helvetica").fontSize(9).fillColor("#dc2626").text(d.avisoOriginal, M, y, { width: ancho });
    y = doc.y;
  }

  // Pie: el número de recepción, y la línea de firma.
  const pieY = doc.page.height - M - 70;
  doc.moveTo(M, pieY).lineTo(M + ancho / 2 - 20, pieY).strokeColor("#9ca3af").stroke();
  doc.font("Helvetica").fontSize(8).fillColor(GRIS).text("Firma del receptor", M, pieY + 4, { lineBreak: false });
  doc.font("Helvetica").fontSize(9).fillColor(GRIS).text("Recepción", M + ancho / 2 + 20, pieY - 14, { lineBreak: false });
  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .fillColor(TINTA)
    .text(d.numeroRecepcion, M + ancho / 2 + 20, pieY - 2, { width: ancho / 2 - 20, lineBreak: false });
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(GRIS)
    .text("Documento generado por Mobilink. El albarán original del proveedor se conserva sin modificar.", M, doc.page.height - M - 14, {
      width: ancho,
      align: "center",
      lineBreak: false,
    });

  doc.end();
  return listo;
}

/** Monta original (si lo hay) + sello. Devuelve el PDF y si el original entró. */
export async function montarRecepcionado(
  original: Buffer | null,
  sello: Buffer,
  marca: string
): Promise<{ pdf: Buffer; originalIncrustado: boolean }> {
  const final = await PDFLib.create();
  let originalIncrustado = false;
  if (original) {
    try {
      const doc = await PDFLib.load(original, { ignoreEncryption: true });
      const paginas = await final.copyPages(doc, doc.getPageIndices());
      const fuente = await final.embedFont(StandardFonts.HelveticaBold);
      for (const p of paginas) {
        final.addPage(p);
        // Una franja en cada página copiada: una hoja suelta del albarán tiene
        // que decir sola que ya está recepcionada y con qué número.
        const { width, height } = p.getSize();
        p.drawRectangle({ x: 0, y: height - 16, width, height: 16, color: rgb(0.063, 0.102, 0.2) });
        p.drawText(marca, { x: 12, y: height - 12, size: 8, font: fuente, color: rgb(1, 1, 1) });
      }
      originalIncrustado = true;
    } catch (e) {
      console.warn("[Recepciones] el original no se ha podido incrustar:", e);
    }
  }
  const hoja = await PDFLib.load(sello);
  for (const p of await final.copyPages(hoja, hoja.getPageIndices())) final.addPage(p);
  return { pdf: Buffer.from(await final.save()), originalIncrustado };
}

/**
 * Genera y guarda el documento recepcionado de una recepción, y lo enlaza en
 * `rcp_recepciones`. Cada llamada crea un documento NUEVO (una rectificación
 * regenera con las cantidades corregidas y conserva el anterior).
 */
export async function generarDocumentoRecepcion(
  ctx: { empresaId: string; userId: string; userNombre: string },
  recepcionId: string
): Promise<repo.Documento> {
  const recepcion = await repo.recepcionPorId(ctx.empresaId, recepcionId);
  if (!recepcion) throw new ErrorRecepciones("RECEPCION_NO_ENCONTRADA", "Recepción no encontrada.", 404);
  const albaran = await repo.albaranPorId(ctx.empresaId, recepcion.albaranId);
  if (!albaran) throw new ErrorRecepciones("ALBARAN_NO_ENCONTRADO", "Albarán no encontrado.", 404);
  const [lineas, incidencias, rectificaciones, original] = await Promise.all([
    repo.lineasDeRecepcion(ctx.empresaId, recepcionId),
    repo.listarIncidencias(ctx.empresaId, { recepcionId }),
    repo.rectificacionesDeRecepcion(ctx.empresaId, recepcionId),
    repo.originalDeAlbaran(ctx.empresaId, albaran.id),
  ]);

  let contenidoOriginal: Buffer | null = null;
  let avisoOriginal: string | null = null;
  if (original) {
    contenidoOriginal = await leerDocumento(original.storagePath);
    if (!contenidoOriginal) avisoOriginal = "El albarán original del proveedor no se ha podido recuperar del almacenamiento para incrustarlo.";
  }

  const sello = await dibujarSello({
    proveedorNombre: albaran.proveedorNombre,
    pedidoNumero: albaran.pedidoNumero,
    albaranNumero: albaran.numeroProveedor,
    transportista: albaran.transportista,
    centroNombre: recepcion.centroNombre,
    // Firma el operario que puso su PIN; sin padrón todavía, la sesión.
    recibidoNombre: recepcion.operarioNombre || recepcion.recibidoNombre,
    registradoNombre: recepcion.operarioNombre ? recepcion.recibidoNombre : null,
    recibidoAt: new Date(recepcion.recibidoAt),
    resultado: recepcion.resultado,
    numeroRecepcion: recepcion.numero,
    observaciones: recepcion.observaciones,
    lineas: lineas.map((l) => ({
      // Sin mapeo, la lectura de la descripción (marca, modelo, medida,
      // índice): lo mismo que ve el operario en la pantalla.
      producto: l.productoTexto ?? leerDescripcion(l.descripcionProveedor).bonito,
      descripcionProveedor: l.descripcionProveedor,
      esperada: l.cantidadEsperada,
      recibida: l.cantidadRecibida,
      diferencia: l.diferencia,
    })),
    incidencias: incidencias
      .filter((i) => i.estado !== "CANCELADA")
      .map((i) => ({
        producto: i.descripcionProducto,
        esperada: i.cantidadEsperada,
        recibida: i.cantidadRecibida,
        diferencia: i.diferencia,
        tipo: i.tipo,
        observaciones: i.observaciones,
      })),
    rectificaciones: rectificaciones.map((r) => ({
      numero: r.numero,
      motivo: r.motivo,
      nombre: r.rectificadoNombre,
      fecha: new Date(r.rectificadoAt),
      cambios: r.lineas.map((l) => `${fmtCantidad(l.cantidadAnterior)} → ${fmtCantidad(l.cantidadNueva)}`).join(", "),
    })),
    avisoOriginal,
  });

  const { fecha, hora } = fechaHora(new Date(recepcion.recibidoAt));
  const marca = `RECEPCIONADO ${recepcion.numero} · ${fecha} ${hora} · ${recepcion.operarioNombre || recepcion.recibidoNombre} · ${recepcion.resultado === "OK" ? "OK" : "CON INCIDENCIA"}`;
  const { pdf, originalIncrustado } = await montarRecepcionado(contenidoOriginal, sello, marca);
  if (contenidoOriginal && !originalIncrustado) {
    // Se guarda igual: el sello es el justificante; el aviso queda en el log.
    console.warn(`[Recepciones] ${recepcion.numero}: el original no se ha incrustado, el recepcionado lleva sólo el sello.`);
  }

  const hash = hashDeFichero(pdf);
  const ruta = rutaDocumento(ctx.empresaId, hash);
  await guardarDocumento(ruta, pdf);
  const sufijo = rectificaciones.length > 0 ? `_R${rectificaciones.length}` : "";
  const documento = await repo.crearDocumento(ctx.empresaId, {
    tipo: "ALBARAN_RECEPCION",
    albaranId: albaran.id,
    recepcionId,
    nombreFichero: `${albaran.proveedorCodigo}_${limpio(albaran.numeroProveedor)}_${recepcion.numero}${sufijo}.pdf`,
    storagePath: ruta,
    hashSha256: hash,
    tamanoBytes: pdf.length,
    mime: "application/pdf",
    origen: "GENERADO",
    generadoDesdeHash: original?.hashSha256 ?? null,
    subidoPor: ctx.userId,
    subidoNombre: ctx.userNombre,
  });
  await repo.fijarDocumentoRecepcion(ctx.empresaId, recepcionId, { documentoId: documento.id, estado: "GENERADO", error: null });
  await repo.anotarEvento(ctx.empresaId, {
    pedidoId: recepcion.pedidoId,
    albaranId: albaran.id,
    recepcionId,
    tipo: "DOCUMENTO_GENERADO",
    actorTipo: "sistema",
    datos: { documentoId: documento.id, nombre: documento.nombreFichero, hash, conOriginal: originalIncrustado },
    descripcion: `Documento ${documento.nombreFichero} generado${originalIncrustado ? " sobre el albarán original" : ""}.`,
  });
  return documento;
}

/** Nombre de fichero seguro a partir de un número de albarán. */
export function limpio(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "SN";
}
