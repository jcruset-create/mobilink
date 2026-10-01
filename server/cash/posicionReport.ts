/**
 * Informe de la posición global en PDF: la misma pantalla, en papel.
 *
 * Es lo que se descarga y se manda a quien pregunte cuánto efectivo hay: el
 * total, lo que está en la caja, lo que espera para el banco y la tabla pieza
 * a pieza, con la foto de cada billete y cada moneda. Viste igual que el
 * resguardo del ingreso y el cierre: los tres se archivan juntos.
 *
 * Las fotos salen del catálogo; si alguna no se puede bajar, esa pieza sale con
 * su etiqueta y el informe se genera igual.
 */

import PDFDocument from "pdfkit";
import * as XLSX from "xlsx";
import pool from "../db.ts";
import { formatearEuros } from "./domain/money.ts";
import { ErrorCaja, cargarDenominaciones } from "./repository.ts";
import { GRIS, M, M_LOGO, TINTA, imagenesDelCatalogo, logoMobilink } from "./report.ts";
import { agregarPosicion, posicionGlobal, type PosicionCaja } from "./posicion.ts";

const eur = (c: number) => `${formatearEuros(c)} €`;

const AZUL = "#101a33";
const FONDO = "#eef2f7";
const BORDE = "#cbd5e1";

function fechaHora(ms: number): string {
  return new Date(ms).toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/**
 * Lo que comparten el PDF y el Excel: las cajas elegidas, su suma, el
 * catálogo y cómo se llama lo que se enseña. Que salga de un solo sitio es lo
 * que garantiza que los dos ficheros digan las mismas cifras.
 */
async function prepararInforme(empresaId: string, centroId: string | null, registerId: number | null) {
  const datos = await posicionGlobal(empresaId, centroId);
  const cajas: PosicionCaja[] =
    registerId == null ? datos.cajas : datos.cajas.filter((c) => c.registerId === registerId);
  if (cajas.length === 0) {
    throw new ErrorCaja("CAJA_NO_ENCONTRADA", "No hay ninguna caja que enseñar.", 404);
  }
  const p = agregarPosicion(cajas);
  const denominaciones = (await cargarDenominaciones(pool, false)).sort((a, b) => b.valor - a.valor);

  const centros = new Set(datos.cajas.map((c) => c.centro ?? ""));
  const subtitulo =
    registerId != null
      ? `${cajas[0].centro ? `${cajas[0].centro} · ` : ""}${cajas[0].nombre}`
      : centros.size === 1 && [...centros][0]
        ? `Todas las cajas de ${[...centros][0]} (${cajas.length})`
        : `Todas las cajas (${cajas.length})`;
  const fecha = new Date(datos.actualizadoMs).toISOString().slice(0, 10);
  const quien =
    registerId == null ? "todas" : cajas[0].nombre.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-");
  return { datos, cajas, p, denominaciones, subtitulo, base: `posicion-${quien}-${fecha}` };
}

/**
 * @param registerId la caja, o `null` para todas las que ve el usuario.
 */
export async function informePosicion(
  empresaId: string,
  centroId: string | null,
  registerId: number | null
): Promise<{ pdf: Buffer; nombre: string }> {
  const { datos, cajas, p, denominaciones, subtitulo, base } = await prepararInforme(
    empresaId,
    centroId,
    registerId
  );
  const imagenes = await imagenesDelCatalogo(denominaciones);

  const doc = new PDFDocument({ margin: M, size: "A4" });
  const trozos: Buffer[] = [];
  doc.on("data", (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(trozos))));
  const ancho = doc.page.width - M * 2;
  const limite = doc.page.height - M - 20;

  // ── Cabecera: la banda de todos los informes de caja ──
  const cabecera = () => {
    doc.rect(0, 0, doc.page.width, 58).fill(AZUL);
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
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(15).text("Posición global de efectivo", x, 16, {
      lineBreak: false,
    });
    doc.font("Helvetica-Bold").fontSize(12).text(subtitulo, x, 35, { lineBreak: false });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#cbd5e1")
      .text(fechaHora(datos.actualizadoMs), doc.page.width - M_LOGO - 160, 24, {
        width: 160,
        align: "right",
        lineBreak: false,
      });
    doc.fillColor(TINTA).font("Helvetica").fontSize(10);
    doc.x = M;
    doc.y = 74;
  };
  cabecera();

  const saltoSiHaceFalta = (alto: number) => {
    if (doc.y + alto > limite) {
      doc.addPage();
      cabecera();
    }
  };

  const titulo = (texto: string) => {
    saltoSiHaceFalta(40);
    doc.moveDown(0.5);
    const y = doc.y;
    doc.rect(M, y, ancho, 18).fill(FONDO);
    doc.rect(M, y, 3, 18).fill(AZUL);
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(TINTA)
      .text(texto.toUpperCase(), M + 10, y + 5, { width: ancho - 20, lineBreak: false });
    doc.y = y + 24;
    doc.font("Helvetica").fontSize(10).fillColor(TINTA);
  };

  // ── Las tres cifras ──
  const billetes = denominaciones.filter((d) => d.tipo === "BILLETE");
  const monedas = denominaciones.filter((d) => d.tipo === "MONEDA");
  const totalDe = (m: Map<number, number>, grupo: typeof denominaciones) =>
    grupo.reduce((a, d) => a + (m.get(d.valor) ?? 0) * d.valor, 0);
  const cajaBilletes = totalDe(p.caja, billetes);
  const cajaMonedas = totalDe(p.caja, monedas);
  const pendBilletes = totalDe(p.pendiente, billetes);
  const pendMonedas = totalDe(p.pendiente, monedas) + p.sinDesgloseCentimos;
  const total = p.cajaCentimos + p.pendienteCentimos;

  const yCajas = doc.y;
  const altoCaja = 64;
  const anchos = [ancho * 0.4, ancho * 0.3 - 6, ancho * 0.3 - 6];
  const xs = [M, M + anchos[0] + 6, M + anchos[0] + anchos[1] + 12];
  const recuadro = (i: number, rotulo: string, valor: number, color: string, pie: string, grande = false) => {
    doc.roundedRect(xs[i], yCajas, anchos[i], altoCaja, 6).fillAndStroke(grande ? "#e0f2fe" : "#f8fafc", BORDE);
    doc
      .fillColor(GRIS)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(rotulo, xs[i] + 10, yCajas + 9, { width: anchos[i] - 20, lineBreak: false });
    doc
      .fillColor(color)
      .font("Helvetica-Bold")
      .fontSize(grande ? 22 : 17)
      .text(eur(valor), xs[i] + 10, yCajas + 22, { width: anchos[i] - 20, lineBreak: false });
    doc
      .fillColor(GRIS)
      .font("Helvetica")
      .fontSize(8)
      .text(pie, xs[i] + 10, yCajas + 48, { width: anchos[i] - 20, lineBreak: false });
  };
  recuadro(
    0,
    "EFECTIVO DISPONIBLE TOTAL",
    total,
    "#0c4a6e",
    `Billetes ${eur(cajaBilletes + pendBilletes)} · monedas ${eur(cajaMonedas + pendMonedas)}`,
    true
  );
  recuadro(1, "EN LA CAJA", p.cajaCentimos, "#047857", `Billetes ${eur(cajaBilletes)} · monedas ${eur(cajaMonedas)}`);
  recuadro(
    2,
    "PENDIENTE DE INGRESAR",
    p.pendienteCentimos,
    "#b45309",
    `Billetes ${eur(pendBilletes)} · monedas ${eur(pendMonedas)}`
  );
  doc.y = yCajas + altoCaja + 4;

  if (cajas.length === 1) {
    const c = cajas[0];
    const origen =
      c.estado === "ABIERTA"
        ? `En la caja: efectivo teórico de la jornada abierta del ${fechaCorta(c.fecha)}.`
        : c.estado === "CERRADA"
          ? `En la caja: caja cerrada, el cambio que dejó el cierre del ${fechaCorta(c.fecha)}.`
          : "En la caja: esta caja todavía no ha abierto ninguna jornada.";
    doc.font("Helvetica").fontSize(8).fillColor(GRIS).text(origen, M, doc.y, { width: ancho });
  }

  // ── La tabla pieza a pieza ──
  titulo("Efectivo por billete y moneda");
  const col = {
    pieza: { x: M, w: 125 },
    cU: { x: M + 125, w: 45 },
    cI: { x: M + 170, w: 75 },
    pU: { x: M + 245, w: 45 },
    pI: { x: M + 290, w: 75 },
    tU: { x: M + 365, w: 50 },
    tI: { x: M + 415, w: ancho - 415 },
  };
  const ALTO = 19;

  const cabeceraTabla = () => {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GRIS);
    doc.text("EN LA CAJA", col.cU.x, y, { width: col.cU.w + col.cI.w, align: "center", lineBreak: false });
    doc.text("PENDIENTE DE INGRESAR", col.pU.x, y, { width: col.pU.w + col.pI.w, align: "center", lineBreak: false });
    doc.text("TOTAL", col.tU.x, y, { width: col.tU.w + col.tI.w, align: "center", lineBreak: false });
    const y2 = y + 11;
    doc.text("PIEZA", col.pieza.x + 4, y2, { lineBreak: false });
    for (const [u, i] of [
      [col.cU, col.cI],
      [col.pU, col.pI],
      [col.tU, col.tI],
    ]) {
      doc.text("UDS.", u.x, y2, { width: u.w - 4, align: "right", lineBreak: false });
      doc.text("IMPORTE", i.x, y2, { width: i.w - 4, align: "right", lineBreak: false });
    }
    doc
      .moveTo(M, y2 + 11)
      .lineTo(M + ancho, y2 + 11)
      .lineWidth(0.8)
      .strokeColor(BORDE)
      .stroke();
    doc.y = y2 + 14;
  };
  cabeceraTabla();

  const celda = (c: { x: number; w: number }, texto: string, y: number, negrita = false, color = TINTA) =>
    doc
      .font(negrita ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9.5)
      .fillColor(color)
      .text(texto, c.x, y + 5, { width: c.w - 4, align: "right", lineBreak: false });

  const separadores = (y: number, alto: number) => {
    for (const x of [col.cU.x, col.pU.x, col.tU.x]) {
      doc
        .moveTo(x, y)
        .lineTo(x, y + alto)
        .lineWidth(0.5)
        .strokeColor("#e2e8f0")
        .stroke();
    }
  };

  const seccion = (texto: string) => {
    saltoSiHaceFalta(ALTO * 2);
    const y = doc.y;
    doc.rect(M, y, ancho, 15).fill("#f1f5f9");
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(GRIS)
      .text(texto.toUpperCase(), M + 4, y + 4, { lineBreak: false });
    doc.y = y + 15;
  };

  const filas = (grupo: typeof denominaciones) => {
    const visibles = grupo.filter((d) => (p.caja.get(d.valor) ?? 0) + (p.pendiente.get(d.valor) ?? 0) > 0);
    if (visibles.length === 0) {
      const y = doc.y;
      doc.font("Helvetica").fontSize(9).fillColor(GRIS).text("Ninguno.", M + 4, y + 5, { lineBreak: false });
      doc.y = y + ALTO;
      return;
    }
    for (const d of visibles) {
      saltoSiHaceFalta(ALTO);
      const y = doc.y;
      const c = p.caja.get(d.valor) ?? 0;
      const pe = p.pendiente.get(d.valor) ?? 0;
      const foto = imagenes.get(d.valor);
      if (foto) {
        try {
          doc.image(foto, col.pieza.x + 2, y + 1.5, { fit: [30, 16], align: "center", valign: "center" });
        } catch {
          /* PNG corrupto: manda la etiqueta */
        }
      }
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(TINTA)
        .text(d.etiqueta || eur(d.valor), col.pieza.x + 38, y + 5, { width: col.pieza.w - 40, lineBreak: false });
      celda(col.cU, c ? `×${c}` : "—", y, false, c ? TINTA : "#94a3b8");
      celda(col.cI, c ? eur(c * d.valor) : "", y);
      celda(col.pU, pe ? `×${pe}` : "—", y, false, pe ? TINTA : "#94a3b8");
      celda(col.pI, pe ? eur(pe * d.valor) : "", y);
      celda(col.tU, `×${c + pe}`, y, true);
      celda(col.tI, eur((c + pe) * d.valor), y, true);
      separadores(y, ALTO);
      doc
        .moveTo(M, y + ALTO)
        .lineTo(M + ancho, y + ALTO)
        .lineWidth(0.4)
        .strokeColor("#e2e8f0")
        .stroke();
      doc.y = y + ALTO;
    }
  };

  const subtotal = (texto: string, caja: number, pendiente: number, total = false) => {
    saltoSiHaceFalta(ALTO);
    const y = doc.y;
    doc.rect(M, y, ancho, ALTO).fill(total ? AZUL : "#e2e8f0");
    const color = total ? "#ffffff" : TINTA;
    doc
      .font("Helvetica-Bold")
      .fontSize(total ? 10.5 : 9.5)
      .fillColor(color)
      .text(texto, M + 4, y + 5, { lineBreak: false });
    celda(col.cI, eur(caja), y, true, color);
    celda(col.pI, eur(pendiente), y, true, color);
    celda(col.tI, eur(caja + pendiente), y, true, color);
    doc.y = y + ALTO;
  };

  seccion("Billetes");
  filas(billetes);
  subtotal("Total billetes", cajaBilletes, pendBilletes);
  seccion("Monedas");
  filas(monedas);
  if (p.sinDesgloseCentimos > 0) {
    saltoSiHaceFalta(ALTO);
    const y = doc.y;
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .fillColor(TINTA)
      .text("Sin desglose, del último ingreso", M + 4, y + 5, { width: col.pieza.w + col.cU.w + col.cI.w, lineBreak: false });
    celda(col.pI, eur(p.sinDesgloseCentimos), y);
    celda(col.tI, eur(p.sinDesgloseCentimos), y, true);
    doc.y = y + ALTO;
  }
  subtotal("Total monedas", cajaMonedas, pendMonedas);
  subtotal("TOTAL EFECTIVO", p.cajaCentimos, p.pendienteCentimos, true);

  // ── Si la bolsa no cuadra, se dice ──
  const descuadre = p.piezasPendienteCentimos + p.sinDesgloseCentimos - p.pendienteCentimos;
  if (descuadre !== 0) {
    doc.moveDown(0.6);
    saltoSiHaceFalta(40);
    const faltan = [...p.faltan.entries()].sort((a, b) => b[0] - a[0]);
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#b45309")
      .text(
        `Atención: las piezas de la bolsa suman ${eur(p.piezasPendienteCentimos + p.sinDesgloseCentimos)} y lo pendiente de ingresar son ${eur(p.pendienteCentimos)}` +
          (faltan.length
            ? `: se sacaron de la bolsa ${faltan.map(([v, n]) => `${n} × ${eur(v)}`).join(", ")} que, según los cierres, no estaban.`
            : ".") +
          " El total usa lo pendiente de la cuenta.",
        M,
        doc.y,
        { width: ancho }
      );
  }

  // ── De dónde sale lo pendiente ──
  titulo("De dónde sale lo pendiente de ingresar");
  const fila = (izq: string, der: string, negrita = false) => {
    saltoSiHaceFalta(14);
    const y = doc.y;
    doc
      .font(negrita ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9.5)
      .fillColor(negrita ? TINTA : GRIS)
      .text(izq, M, y, { width: ancho * 0.7, lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fillColor(TINTA)
      .text(der, M + ancho * 0.7, y, { width: ancho * 0.3, align: "right", lineBreak: false });
    doc.y = y + 14;
  };
  fila(`Cierres sin ingresar (${p.numCierres})`, eur(p.cierresCentimos));
  fila("Sin ingresar del último ingreso", eur(p.remanenteCentimos));
  fila("Repuesto al cajón", eur(-p.repuestoCentimos));
  fila("Pendiente de ingresar", eur(p.pendienteCentimos), true);

  if (cajas.length > 1) {
    titulo("Por caja");
    for (const c of cajas) {
      fila(
        `${c.centro ? `${c.centro} · ` : ""}${c.nombre}: caja ${eur(c.cajaCentimos)} + pendiente ${eur(c.pendienteCentimos)}`,
        eur(c.cajaCentimos + c.pendienteCentimos)
      );
    }
  }

  doc.moveDown(0.8);
  saltoSiHaceFalta(30);
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(GRIS)
    .text(
      "En la caja: efectivo teórico de la jornada abierta (tubos y bolsas precintadas incluidos) o, con la caja cerrada, el cambio del último cierre. Pendiente de ingresar: la bolsa de Ingresos bancarios. No incluye tarjetas, Bizum ni transferencias, ni el dinero fuera de la tienda (cambio pedido al banco, entregas a personas).",
      M,
      doc.y,
      { width: ancho }
    );

  doc.end();
  return { pdf: await listo, nombre: `${base}.pdf` };
}

/**
 * La misma posición en Excel: para quien la quiere sumar, filtrar o pegar en
 * su hoja. Los importes van como NÚMEROS en euros, con formato de moneda, no
 * como texto: un «1.250,00 €» escrito no se puede sumar.
 *
 * Hojas:
 * · «Posición»: cabecera, las tres cifras, la tabla pieza a pieza (con lo que
 *   quedó sin desglose) y de dónde sale lo pendiente.
 * · «Por caja», solo si son varias: cada caja con su caja, pendiente y total.
 */
export async function excelPosicion(
  empresaId: string,
  centroId: string | null,
  registerId: number | null
): Promise<{ xlsx: Buffer; nombre: string }> {
  const { datos, cajas, p, denominaciones, subtitulo, base } = await prepararInforme(
    empresaId,
    centroId,
    registerId
  );
  const e = (c: number) => Math.round(c) / 100;
  const billetes = denominaciones.filter((d) => d.tipo === "BILLETE");
  const monedas = denominaciones.filter((d) => d.tipo === "MONEDA");
  const totalDe = (m: Map<number, number>, grupo: typeof denominaciones) =>
    grupo.reduce((a, d) => a + (m.get(d.valor) ?? 0) * d.valor, 0);
  const cajaB = totalDe(p.caja, billetes);
  const cajaM = totalDe(p.caja, monedas);
  const pendB = totalDe(p.pendiente, billetes);
  const pendM = totalDe(p.pendiente, monedas) + p.sinDesgloseCentimos;

  type Celda = string | number | null;
  const filas: Celda[][] = [
    ["Posición global de efectivo"],
    [subtitulo],
    [`Generado el ${fechaHora(datos.actualizadoMs)}`],
    [],
    ["Efectivo disponible total", e(p.cajaCentimos + p.pendienteCentimos)],
    ["En la caja", e(p.cajaCentimos)],
    ["Pendiente de ingresar", e(p.pendienteCentimos)],
    [],
    ["Pieza", "Tipo", "En la caja (uds.)", "En la caja (€)", "Pendiente (uds.)", "Pendiente (€)", "Total (uds.)", "Total (€)"],
  ];
  /** Filas cuyo importe va en la columna B (resumen y «de dónde sale»). */
  const filasResumen: number[] = [4, 5, 6];
  /** Filas de la tabla: importes en las columnas D, F y H. */
  const filasEuros: number[] = [];

  const grupo = (lista: typeof denominaciones, tipo: string) => {
    for (const d of lista) {
      const c = p.caja.get(d.valor) ?? 0;
      const pe = p.pendiente.get(d.valor) ?? 0;
      if (c + pe === 0) continue;
      filasEuros.push(filas.length);
      filas.push([d.etiqueta || `${e(d.valor)} €`, tipo, c, e(c * d.valor), pe, e(pe * d.valor), c + pe, e((c + pe) * d.valor)]);
    }
  };
  grupo(billetes, "Billete");
  filasEuros.push(filas.length);
  filas.push(["Total billetes", "", null, e(cajaB), null, e(pendB), null, e(cajaB + pendB)]);
  grupo(monedas, "Moneda");
  if (p.sinDesgloseCentimos > 0) {
    filasEuros.push(filas.length);
    filas.push(["Sin desglose, del último ingreso", "Moneda", null, null, null, e(p.sinDesgloseCentimos), null, e(p.sinDesgloseCentimos)]);
  }
  filasEuros.push(filas.length);
  filas.push(["Total monedas", "", null, e(cajaM), null, e(pendM), null, e(cajaM + pendM)]);
  filasEuros.push(filas.length);
  filas.push(["TOTAL EFECTIVO", "", null, e(p.cajaCentimos), null, e(p.pendienteCentimos), null, e(p.cajaCentimos + p.pendienteCentimos)]);

  filas.push([]);
  filas.push(["De dónde sale lo pendiente de ingresar"]);
  for (const [texto, valor] of [
    [`Cierres sin ingresar (${p.numCierres})`, p.cierresCentimos],
    ["Sin ingresar del último ingreso", p.remanenteCentimos],
    ["Repuesto al cajón", -p.repuestoCentimos],
    ["Pendiente de ingresar", p.pendienteCentimos],
  ] as const) {
    filasResumen.push(filas.length);
    filas.push([texto, e(valor)]);
  }

  const descuadre = p.piezasPendienteCentimos + p.sinDesgloseCentimos - p.pendienteCentimos;
  if (descuadre !== 0) {
    filas.push([]);
    filas.push([
      `Atención: las piezas pendientes suman ${eur(p.piezasPendienteCentimos + p.sinDesgloseCentimos)} y lo pendiente de ingresar son ${eur(p.pendienteCentimos)}. El total usa lo pendiente de la cuenta.`,
    ]);
  }

  const hoja = XLSX.utils.aoa_to_sheet(filas);
  hoja["!cols"] = [{ wch: 34 }, { wch: 9 }, { wch: 16 }, { wch: 15 }, { wch: 16 }, { wch: 15 }, { wch: 12 }, { wch: 15 }];
  // Formato de moneda en las columnas de euros; las de unidades, enteras.
  const FORMATO_EUR = '#,##0.00 "€"';
  const conFormato = (r: number, c: number) => {
    const celda = hoja[XLSX.utils.encode_cell({ r, c })];
    if (celda && celda.t === "n") celda.z = FORMATO_EUR;
  };
  for (const r of filasResumen) conFormato(r, 1);
  for (const r of filasEuros) for (const c of [3, 5, 7]) conFormato(r, c);

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Posición");

  if (cajas.length > 1) {
    const porCaja: Celda[][] = [["Taller", "Caja", "Estado", "En la caja (€)", "Pendiente de ingresar (€)", "Total (€)"]];
    for (const c of cajas) {
      porCaja.push([
        c.centro ?? "",
        c.nombre,
        c.estado === "ABIERTA" ? "Abierta" : c.estado === "CERRADA" ? "Cerrada" : "Sin jornadas",
        e(c.cajaCentimos),
        e(c.pendienteCentimos),
        e(c.cajaCentimos + c.pendienteCentimos),
      ]);
    }
    const h2 = XLSX.utils.aoa_to_sheet(porCaja);
    h2["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 12 }, { wch: 16 }, { wch: 24 }, { wch: 14 }];
    for (let r = 1; r < porCaja.length; r++) {
      for (const col of [3, 4, 5]) {
        const celda = h2[XLSX.utils.encode_cell({ r, c: col })];
        if (celda) celda.z = FORMATO_EUR;
      }
    }
    XLSX.utils.book_append_sheet(libro, h2, "Por caja");
  }

  return { xlsx: XLSX.write(libro, { type: "buffer", bookType: "xlsx" }) as Buffer, nombre: `${base}.xlsx` };
}
