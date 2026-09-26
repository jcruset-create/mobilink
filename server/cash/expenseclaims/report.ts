/**
 * La liquidación en PDF: el resumen delante y los tickets detrás.
 *
 * Se puede sacar en CUALQUIER estado, y es a propósito. Antes de pagar es el
 * papel que se firma —el trabajador reconoce sus gastos, el responsable los
 * aprueba—; después, el que se archiva con el pago. Por eso el estado va en
 * grande arriba: un borrador impreso no puede confundirse con una liquidación
 * pagada.
 *
 * Las mismas dos herramientas que el informe de cierre (`../report.ts`):
 * pdfkit para la portada y `montar` (pdf-lib) para incrustar los tickets tal
 * cual vienen. Un ticket ilegible no rompe el PDF: sale una página diciéndolo.
 */

import PDFDocument from "pdfkit";
import pool from "../../db.ts";
import { formatearEuros } from "../domain/money.ts";
import { GRIS, M, M_LOGO, TINTA, logoMobilink, montar } from "../report.ts";
import type { Contexto } from "../service.ts";
import { type EstadoLiquidacion, periodoDe, totalesPorConcepto } from "./domain.ts";
import { cargarLiquidacion, lineasDe, paraReglas } from "./repository.ts";

const eur = (c: number) => `${formatearEuros(c)} €`;

const ETIQUETA: Record<EstadoLiquidacion, { texto: string; color: string }> = {
  BORRADOR: { texto: "BORRADOR", color: "#64748b" },
  PRESENTADA: { texto: "PRESENTADA · PENDIENTE DE APROBAR", color: "#b45309" },
  APROBADA: { texto: "APROBADA · PENDIENTE DE PAGO", color: "#1d4ed8" },
  RECHAZADA: { texto: "RECHAZADA", color: "#b91c1c" },
  PAGADA: { texto: "PAGADA", color: "#15803d" },
  ANULADA: { texto: "ANULADA", color: "#b91c1c" },
};

/** «25/09/2026 17:40», en la hora de Madrid, que es la del taller. */
function cuando(ms: number | null): string {
  if (ms == null) return "";
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

const fechaCorta = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

/**
 * Nombres de quien presentó, aprobó y pagó.
 *
 * `app_usuarios` es del SaaS y en una base del módulo puede no existir: sin
 * nombre se pone el identificador, que sigue siendo rastreable. Un PDF sin
 * nombres es peor que uno con un uuid, pero mucho mejor que no tener PDF.
 */
async function nombresDe(ids: (string | null)[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const mapa = new Map<string, string>();
  if (unicos.length === 0) return mapa;
  try {
    const { rows } = await pool.query(
      `SELECT id::text AS id, nombre FROM app_usuarios WHERE id = ANY($1::uuid[])`,
      [unicos]
    );
    for (const r of rows) mapa.set(r.id, r.nombre);
  } catch {
    /* sin tabla de usuarios: se queda el id */
  }
  return mapa;
}

export async function informeLiquidacion(ctx: Contexto, id: number): Promise<Buffer> {
  const l = await cargarLiquidacion(pool, ctx, id);
  const lineas = await lineasDe(pool, id);
  const incluidas = lineas.filter((x) => x.situacion === "INCLUIDA");
  const excluidas = lineas.filter((x) => x.situacion === "EXCLUIDA");
  const totales = totalesPorConcepto(lineas.map(paraReglas));
  /*
   * En borrador el total y el periodo guardados todavía no existen —se fijan
   * al presentar—, así que se calculan con lo que hay. Desde PRESENTADA manda
   * lo guardado: es lo que se aprobó.
   */
  const total = l.estado === "BORRADOR" ? totales.totalCentimos : l.totalCentimos;
  const periodo =
    l.estado === "BORRADOR" ? periodoDe(lineas.map(paraReglas)) : { desde: l.periodoDesde, hasta: l.periodoHasta };

  let sesion: { fecha: string; caja: string } | null = null;
  if (l.sessionIdPago) {
    const { rows } = await pool.query(
      `SELECT s.fecha::text AS fecha, r.nombre AS caja
         FROM cash_sessions s JOIN cash_registers r ON r.id = s.register_id
        WHERE s.id = $1`,
      [l.sessionIdPago]
    );
    sesion = rows[0] ?? null;
  }
  const nombres = await nombresDe([l.presentadaPor, l.aprobadaPor, l.pagadaPor, l.rechazadaPor, l.anuladaPor]);
  /*
   * Sin nombre, el final del identificador: basta para rastrearlo en la
   * auditoría y cabe en la línea. El uuid entero desbordaba la columna.
   */
  const quien = (uid: string | null) => (uid ? (nombres.get(uid) ?? `usuario …${uid.slice(-6)}`) : "—");

  const doc = new PDFDocument({ margin: M, size: "A4", bufferPages: true });
  const trozos: Buffer[] = [];
  doc.on("data", (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(trozos))));
  const ancho = doc.page.width - M * 2;

  const cabecera = () => {
    doc.rect(0, 0, doc.page.width, 58).fill("#101a33");
    let x = M;
    try {
      const logo = logoMobilink();
      if (logo) {
        doc.image(logo, M_LOGO, 12, { height: 34 });
        x = M + 132;
      }
    } catch {
      /* sin logotipo: manda el texto */
    }
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(15).text("Liquidación de gastos", x, 16, {
      lineBreak: false,
    });
    doc.fontSize(13).text(`${l.numero} · ${l.empleadoNombre}`, x, 34, { lineBreak: false });
    doc.fillColor(TINTA).font("Helvetica").fontSize(10);
    doc.x = M;
    doc.y = 78;
  };
  cabecera();
  doc.on("pageAdded", cabecera);

  const titulo = (texto: string) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.6);
    const y = doc.y;
    doc.rect(M, y, ancho, 18).fill("#eef2f7");
    doc.rect(M, y, 3, 18).fill("#101a33");
    doc.font("Helvetica-Bold").fontSize(10).fillColor(TINTA).text(texto.toUpperCase(), M + 10, y + 5, {
      width: ancho - 20,
      lineBreak: false,
    });
    doc.y = y + 24;
    doc.font("Helvetica").fontSize(10).fillColor(TINTA);
  };

  /** `reparto`: qué parte del ancho se lleva la etiqueta. */
  const fila = (izq: string, der: string, destacado = false, reparto = 0.62) => {
    const y = doc.y;
    doc.font(destacado ? "Helvetica-Bold" : "Helvetica").fillColor(destacado ? TINTA : GRIS)
      .text(izq, M, y, { width: ancho * reparto, lineBreak: false, ellipsis: true });
    doc.font("Helvetica-Bold").fillColor(TINTA).text(der, M + ancho * reparto, y, {
      width: ancho * (1 - reparto),
      align: "right",
      lineBreak: false,
      ellipsis: true,
    });
    doc.y = y + 16;
  };

  // ── Estado, en grande ────────────────────────────────────────────────────
  const etiqueta = ETIQUETA[l.estado];
  const yEstado = doc.y;
  doc.roundedRect(M, yEstado, ancho, 34, 4).fill(etiqueta.color);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(14).text(etiqueta.texto, M + 12, yEstado + 10, {
    width: ancho * 0.6,
    lineBreak: false,
  });
  doc.text(eur(total), M + ancho * 0.6, yEstado + 10, { width: ancho * 0.4 - 12, align: "right", lineBreak: false });
  doc.y = yEstado + 44;
  doc.fillColor(TINTA).font("Helvetica").fontSize(10);
  if (l.estado === "BORRADOR") {
    doc.fillColor(GRIS).fontSize(9).text(
      "Borrador: los importes pueden cambiar hasta que se presente. No sirve como justificante de pago.",
      M,
      doc.y,
      { width: ancho }
    );
    doc.fillColor(TINTA).fontSize(10);
  }

  titulo("Datos");
  fila("Trabajador", l.empleadoNombre, true);
  fila("Periodo", periodo.desde ? `${fechaCorta(periodo.desde)} – ${fechaCorta(periodo.hasta)}` : "—");
  fila("Tickets incluidos", String(incluidas.length));
  if (excluidas.length > 0) fila("Tickets excluidos", String(excluidas.length));
  fila("Creada", cuando(l.createdAtMs));
  if (l.notas) {
    doc.fillColor(GRIS).text(`Notas: ${l.notas}`, M, doc.y, { width: ancho });
    doc.fillColor(TINTA);
  }

  // ── Tickets ──────────────────────────────────────────────────────────────
  titulo("Tickets");
  const cols = [
    { t: "#", w: 0.05, a: "left" },
    { t: "Fecha", w: 0.12, a: "left" },
    { t: "Establecimiento", w: 0.3, a: "left" },
    { t: "Concepto", w: 0.18, a: "left" },
    { t: "Base", w: 0.11, a: "right" },
    { t: "IVA", w: 0.1, a: "right" },
    { t: "Importe", w: 0.14, a: "right" },
  ] as const;
  const filaTabla = (celdas: string[], negrita = false) => {
    if (doc.y > doc.page.height - 70) doc.addPage();
    const y = doc.y;
    let x = M;
    doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(negrita ? TINTA : "#1e293b");
    cols.forEach((c, i) => {
      doc.text(celdas[i] ?? "", x + 2, y, { width: ancho * c.w - 4, align: c.a, lineBreak: false, ellipsis: true });
      x += ancho * c.w;
    });
    doc.y = y + 15;
  };
  filaTabla(cols.map((c) => c.t), true);
  doc.moveTo(M, doc.y - 3).lineTo(M + ancho, doc.y - 3).strokeColor("#cbd5e1").stroke();
  incluidas.forEach((x, i) =>
    filaTabla([
      String(i + 1),
      fechaCorta(x.fecha),
      x.emisorNombre || x.nombre,
      x.conceptoNombre ?? "Sin concepto",
      x.baseCentimos == null ? "" : eur(x.baseCentimos),
      x.ivaCentimos == null ? "" : eur(x.ivaCentimos),
      eur(x.importeCentimos),
    ])
  );
  if (incluidas.length === 0) {
    doc.fillColor(GRIS).fontSize(9).text("Ningún ticket incluido.", M, doc.y);
  }

  // ── Totales por concepto ─────────────────────────────────────────────────
  titulo("Totales");
  for (const t of totales.porConcepto) fila(`${t.nombre} (${t.lineas})`, eur(t.importeCentimos));
  doc.moveTo(M, doc.y + 1).lineTo(M + ancho, doc.y + 1).strokeColor("#0f172a").stroke();
  doc.y += 5;
  fila("TOTAL", eur(total), true);

  if (excluidas.length > 0) {
    titulo("Excluidos (no se pagan)");
    for (const x of excluidas) {
      fila(`${x.emisorNombre || x.nombre} · ${x.excluidaMotivo ?? ""}`, eur(x.importeCentimos), false, 0.8);
    }
  }

  /*
   * Los duplicados que alguien decidió pagar igualmente, con su motivo. Es
   * justo lo que un auditor preguntará, y la respuesta tiene que estar en el
   * mismo papel.
   */
  const aceptados = incluidas.flatMap((x) =>
    x.duplicados
      .filter((d) => d.resolucion === "ACEPTADA")
      .map((d) => ({ linea: incluidas.indexOf(x) + 1, d }))
  );
  if (aceptados.length > 0) {
    titulo("Posibles duplicados pagados igualmente");
    for (const { linea, d } of aceptados) {
      doc.fillColor(TINTA).fontSize(9).text(
        `Ticket ${linea}: coincide con ${d.referenciaNumero ?? d.referenciaTipo.toLowerCase()} (${d.tipo.toLowerCase().replace(/_/g, " ")}). Motivo: ${d.motivo ?? "—"} · ${quien(d.resueltoPor)}, ${cuando(d.resueltoAtMs)}`,
        M,
        doc.y,
        { width: ancho }
      );
      doc.moveDown(0.3);
    }
  }

  // ── Quién ────────────────────────────────────────────────────────────────
  titulo("Tramitación");
  const pendiente = "pendiente";
  fila("Presentada", l.presentadaAtMs ? `${quien(l.presentadaPor)} · ${cuando(l.presentadaAtMs)}` : pendiente, false, 0.3);
  if (l.rechazadaAtMs) {
    fila("Rechazada", `${quien(l.rechazadaPor)} · ${cuando(l.rechazadaAtMs)}`, false, 0.3);
    if (l.rechazoMotivo) doc.fillColor(GRIS).fontSize(9).text(`Motivo: ${l.rechazoMotivo}`, M, doc.y, { width: ancho });
    doc.fillColor(TINTA).fontSize(10);
  }
  fila("Aprobada", l.aprobadaAtMs ? `${quien(l.aprobadaPor)} · ${cuando(l.aprobadaAtMs)}` : pendiente, false, 0.3);
  fila(
    "Pagada",
    l.pagadaAtMs
      ? `${quien(l.pagadaPor)} · ${cuando(l.pagadaAtMs)}`
      : l.estado === "ANULADA"
        ? "—"
        : pendiente,
    false,
    0.3
  );
  if (l.pagoNumero) {
    fila("Pago en caja", `${l.pagoNumero}${sesion ? ` · ${sesion.caja} · ${fechaCorta(sesion.fecha)}` : ""}`, true, 0.3);
  }
  if (l.anuladaAtMs) {
    fila("Anulada", `${quien(l.anuladaPor)} · ${cuando(l.anuladaAtMs)}`, false, 0.3);
    if (l.anuladaMotivo) doc.fillColor(GRIS).fontSize(9).text(`Motivo: ${l.anuladaMotivo}`, M, doc.y, { width: ancho });
    doc.fillColor(TINTA).fontSize(10);
  }

  // Firmas: el papel que se imprime antes de pagar se firma.
  if (doc.y > doc.page.height - 130) doc.addPage();
  doc.moveDown(2);
  const yFirma = doc.y + 40;
  const mitad = (ancho - 30) / 2;
  doc.moveTo(M, yFirma).lineTo(M + mitad, yFirma).strokeColor("#94a3b8").stroke();
  doc.moveTo(M + mitad + 30, yFirma).lineTo(M + ancho, yFirma).stroke();
  doc.fillColor(GRIS).fontSize(9)
    .text("Firma del trabajador", M, yFirma + 4, { width: mitad, lineBreak: false })
    .text("Aprobado por", M + mitad + 30, yFirma + 4, { width: mitad, lineBreak: false });

  /*
   * Numeración de hojas en la cabecera, como el informe de cierre. Abajo no:
   * escribir por debajo del margen hace que pdfkit abra una hoja nueva.
   */
  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    doc.font("Helvetica").fontSize(9).fillColor("#ffffff").text(`${i + 1} de ${rango.count}`, M, 38, {
      width: ancho,
      align: "right",
      lineBreak: false,
    });
  }
  doc.flushPages();
  doc.end();
  const portada = await listo;

  const { rows: rutas } = await pool.query(
    `SELECT id, ruta FROM cash_expense_claim_lines WHERE claim_id = $1`,
    [id]
  );
  const rutaDe = new Map<number, string>(rutas.map((r: { id: number; ruta: string }) => [r.id, r.ruta]));
  return montar(
    portada,
    incluidas.map((x, i) => ({
      ruta: rutaDe.get(x.id) ?? "",
      mime: x.mime,
      nombre: x.nombre,
      operacionNumero: `${l.numero} · ticket ${i + 1}`,
    }))
  );
}
