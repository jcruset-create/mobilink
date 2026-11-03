/**
 * El informe de revisiones, dibujado.
 *
 * Se dibuja de cero con pdf-lib, no se estampa sobre una plantilla: esto no
 * es un documento contractual como el parte Conti360, es un informe nuestro
 * y su tamaño depende de los datos.
 *
 * Lo único que hace este fichero es pintar. Qué sale y qué no lo decide
 * `armar.ts`, que se puede probar; aquí no hay reglas de negocio, y si
 * alguna se cuela es un error.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Documento, RevisionDoc, RuedaDoc } from "./armar.ts";

const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN = 40;
const PIE = 48;

const TINTA = rgb(0.12, 0.14, 0.18);
const SUAVE = rgb(0.42, 0.45, 0.5);
const LINEA = rgb(0.82, 0.84, 0.87);
const ROJO = rgb(0.72, 0.15, 0.17);
const AMBAR = rgb(0.72, 0.47, 0.05);
const VERDE = rgb(0.13, 0.45, 0.28);
const FONDO = rgb(0.95, 0.96, 0.97);

interface Lienzo {
  doc: PDFDocument;
  normal: PDFFont;
  negrita: PDFFont;
  pagina: PDFPage;
  y: number;
  paginas: PDFPage[];
}

function nuevaPagina(l: Lienzo): void {
  l.pagina = l.doc.addPage([A4.ancho, A4.alto]);
  l.paginas.push(l.pagina);
  l.y = A4.alto - MARGEN;
}

/** Reserva `alto`; si no cabe, pasa de página. Devuelve la Y de escritura. */
function sitio(l: Lienzo, alto: number): number {
  if (l.y - alto < PIE) nuevaPagina(l);
  l.y -= alto;
  return l.y;
}

function texto(l: Lienzo, s: string, x: number, y: number, opts: {
  tam?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; ancho?: number;
} = {}): void {
  const tam = opts.tam ?? 9;
  const font = opts.font ?? l.normal;
  let t = s ?? "";
  // pdf-lib revienta con caracteres que la fuente no tiene (WinAnsi): se
  // limpian en vez de dejar que falle la generación entera por una ñ rara.
  t = t.replace(/[^\x20-\x7E -ÿ€]/g, "");
  if (opts.ancho) {
    while (t.length > 1 && font.widthOfTextAtSize(t, tam) > opts.ancho) t = t.slice(0, -1);
  }
  l.pagina.drawText(t, { x, y, size: tam, font, color: opts.color ?? TINTA });
}

const fecha = (iso: string) => {
  const [a, m, d] = (iso ?? "").split("-");
  return a && m && d ? `${d}/${m}/${a}` : (iso ?? "");
};
const mesLargo = (ym: string) => {
  const [a, m] = (ym ?? "").split("-");
  const nombres = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return a && m ? `${nombres[Number(m) - 1] ?? m} ${a}` : ym;
};
const mm = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}`);
const bar = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}`);

const COLOR_ESTADO: Record<RuedaDoc["estado"], ReturnType<typeof rgb>> = {
  ok: VERDE, aviso: AMBAR, bajo_minimo: ROJO, sin_medir: SUAVE,
};

interface Columna { t: string; x: number; w: number; derecha?: boolean }

function cabeceraTabla(l: Lienzo, cols: Columna[]): void {
  const y = sitio(l, 16);
  l.pagina.drawRectangle({
    x: MARGEN - 4, y: y - 3, width: A4.ancho - 2 * MARGEN + 8, height: 15, color: FONDO,
  });
  for (const c of cols) {
    // Se mide lo que se DIBUJA. Medir el texto sin mayúsculas y pintarlo con
    // ellas corría la cabecera a la izquierda y «PRESIÓN BAR» se comía
    // «ESTADO» de la columna siguiente.
    const etiqueta = c.t.toUpperCase();
    const x = c.derecha ? c.x + c.w - l.negrita.widthOfTextAtSize(etiqueta, 7.5) : c.x;
    texto(l, etiqueta, x, y + 1, { tam: 7.5, font: l.negrita, color: SUAVE });
  }
}

function fila(l: Lienzo, cols: Columna[], valores: Array<string | { t: string; color?: ReturnType<typeof rgb>; negrita?: boolean }>): void {
  const y = sitio(l, 13);
  cols.forEach((c, i) => {
    const v = valores[i];
    const t = typeof v === "string" ? v : v?.t ?? "";
    const color = typeof v === "string" ? TINTA : v?.color ?? TINTA;
    const font = typeof v === "string" ? l.normal : (v?.negrita ? l.negrita : l.normal);
    const x = c.derecha ? c.x + c.w - font.widthOfTextAtSize(t.slice(0, 40), 8) : c.x;
    texto(l, t, x, y + 1, { tam: 8, font, color, ancho: c.w - 4 });
  });
  l.pagina.drawLine({
    start: { x: MARGEN - 4, y: y - 3 }, end: { x: A4.ancho - MARGEN + 4, y: y - 3 },
    thickness: 0.4, color: LINEA,
  });
}

function titulo(l: Lienzo, s: string, tam = 12): void {
  const y = sitio(l, tam + 12);
  texto(l, s, MARGEN, y, { tam, font: l.negrita });
}

/** Genera el PDF. Devuelve los bytes. */
export async function generarInformeRevisiones(d: Documento, empresa: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const l: Lienzo = {
    doc,
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
    pagina: null as unknown as PDFPage,
    y: 0,
    paginas: [],
  };
  nuevaPagina(l);

  // ── Portada ──────────────────────────────────────────────────────────────
  texto(l, d.titulo, MARGEN, sitio(l, 26), { tam: 19, font: l.negrita });
  texto(l, empresa, MARGEN, sitio(l, 16), { tam: 12, color: SUAVE });
  texto(l, `Del ${fecha(d.periodo.desde)} al ${fecha(d.periodo.hasta)}`, MARGEN, sitio(l, 14), { tam: 9, color: SUAVE });
  texto(l,
    d.ambito === "cliente"
      ? "Informe para el cliente. Incluye solo revisiones completadas."
      : "Informe interno. Incluye revisiones sin terminar, marcadas como tales.",
    MARGEN, sitio(l, 16), { tam: 8, color: SUAVE });

  sitio(l, 8);

  // ── Resumen ──────────────────────────────────────────────────────────────
  titulo(l, "Resumen del periodo");
  const r = d.resumen;
  const kpis: Array<[string, string, ReturnType<typeof rgb>]> = [
    ["Revisiones", String(r.revisiones), TINTA],
    ["Vehículos", String(r.vehiculos), TINTA],
    ["Ruedas medidas", String(r.mediciones), TINTA],
    ["Bajo mínimo", String(r.bajoMinimo), r.bajoMinimo ? ROJO : VERDE],
    ["En aviso", String(r.enAviso), r.enAviso ? AMBAR : VERDE],
    ["Sin medir", String(r.sinMedir), SUAVE],
  ];
  if (d.ambito === "interno") kpis.push(["Sin terminar", String(r.borradores), r.borradores ? AMBAR : VERDE]);

  const anchoKpi = (A4.ancho - 2 * MARGEN) / kpis.length;
  const yk = sitio(l, 40);
  kpis.forEach(([etiqueta, valor, color], i) => {
    const x = MARGEN + i * anchoKpi;
    texto(l, valor, x, yk + 14, { tam: 16, font: l.negrita, color });
    texto(l, etiqueta, x, yk + 2, { tam: 7, color: SUAVE, ancho: anchoKpi - 6 });
  });

  // ── Evolución por mes ────────────────────────────────────────────────────
  if (d.meses.length > 0) {
    sitio(l, 6);
    titulo(l, "Por mes", 10);
    const cols: Columna[] = [
      { t: "Mes", x: MARGEN, w: 90 },
      { t: "Revisiones", x: MARGEN + 90, w: 80, derecha: true },
      { t: "Vehiculos", x: MARGEN + 180, w: 80, derecha: true },
      { t: "Ruedas bajo mínimo", x: MARGEN + 275, w: 125, derecha: true },
    ];
    cabeceraTabla(l, cols);
    for (const m of d.meses) {
      fila(l, cols, [
        mesLargo(m.mes), String(m.revisiones), String(m.vehiculos),
        { t: String(m.bajoMinimo), color: m.bajoMinimo ? ROJO : SUAVE },
      ]);
    }
  }

  // ── El cuerpo, según el formato ──────────────────────────────────────────
  if (d.formato === "vehiculo") {
    for (const v of d.vehiculos) {
      sitio(l, 10);
      if (l.y < PIE + 90) nuevaPagina(l);
      titulo(l, `${v.matricula}${v.unidad ? `  ·  unidad ${v.unidad}` : ""}`, 11);
      texto(l, `${v.revisiones.length} revisión(es) en el periodo · ${v.bajoMinimo} rueda(s) bajo mínimo`,
        MARGEN, sitio(l, 12), { tam: 8, color: v.bajoMinimo ? ROJO : SUAVE });
      for (const rev of v.revisiones) pintarRevisionConRuedas(l, rev, d.ambito === "interno", false);
    }
  } else if (d.formato === "detalle") {
    sitio(l, 10);
    titulo(l, "Revisiones, rueda a rueda", 11);
    for (const rev of d.revisiones) pintarRevisionConRuedas(l, rev, d.ambito === "interno");
  } else {
    sitio(l, 10);
    titulo(l, "Revisiones", 11);
    const cols: Columna[] = [
      { t: "Fecha", x: MARGEN, w: 55 },
      { t: "Matrícula", x: MARGEN + 58, w: 62 },
      { t: "Unidad", x: MARGEN + 122, w: 40 },
      { t: "Km", x: MARGEN + 164, w: 55, derecha: true },
      ...(d.ambito === "interno" ? [{ t: "Técnico", x: MARGEN + 224, w: 86 }] : []),
      // Las X van calculadas y no a ojo: con el técnico la tabla se corre
      // 94 pt a la derecha, y el hueco entre «Aviso» y «Estado» tiene que
      // seguir siendo visible o se leen como una sola palabra.
      { t: "Medidas", x: MARGEN + (d.ambito === "interno" ? 314 : 224), w: 46, derecha: true },
      { t: "Bajo mín.", x: MARGEN + (d.ambito === "interno" ? 366 : 276), w: 46, derecha: true },
      { t: "Aviso", x: MARGEN + (d.ambito === "interno" ? 418 : 328), w: 36, derecha: true },
      { t: "Estado", x: MARGEN + (d.ambito === "interno" ? 466 : 376), w: 76 },
    ];
    cabeceraTabla(l, cols);
    for (const rev of d.revisiones) {
      fila(l, cols, [
        fecha(rev.fecha), rev.matricula, rev.unidad ?? "—",
        rev.km == null ? "—" : rev.km.toLocaleString("es-ES"),
        ...(d.ambito === "interno" ? [rev.tecnico ?? "—"] : []),
        String(rev.medidas),
        { t: String(rev.bajoMinimo), color: rev.bajoMinimo ? ROJO : SUAVE, negrita: rev.bajoMinimo > 0 },
        { t: String(rev.enAviso), color: rev.enAviso ? AMBAR : SUAVE },
        { t: rev.estado === "completada" ? "Completada" : "Sin terminar",
          color: rev.estado === "completada" ? SUAVE : AMBAR },
      ]);
    }
  }

  // ── Advertencias ─────────────────────────────────────────────────────────
  if (d.advertencias.length > 0) {
    sitio(l, 12);
    titulo(l, "Notas", 10);
    for (const a of d.advertencias) texto(l, `- ${a}`, MARGEN, sitio(l, 12), { tam: 8, color: SUAVE, ancho: A4.ancho - 2 * MARGEN });
  }

  pies(l, empresa, d);
  return doc.save();
}

/** Una revisión con su tabla de ruedas, para `detalle` y `vehiculo`. */
function pintarRevisionConRuedas(l: Lienzo, rev: RevisionDoc, interno: boolean, conMatricula = true): void {
  // Una revisión no se parte entre dos páginas por una línea: si no caben la
  // cabecera y un par de ruedas, se empieza en la siguiente.
  if (l.y - (34 + Math.min(rev.ruedas.length, 2) * 13) < PIE) nuevaPagina(l);

  const y = sitio(l, 18);
  // En el formato por vehículo la matrícula ya está en el título de la
  // sección: repetirla en cada revisión solo hace ruido.
  texto(l, conMatricula
      ? `${fecha(rev.fecha)}  ·  ${rev.matricula}${rev.unidad ? ` (u. ${rev.unidad})` : ""}`
      : fecha(rev.fecha),
    MARGEN, y + 3, { tam: 9.5, font: l.negrita });
  const derecha = [
    rev.km != null ? `${rev.km.toLocaleString("es-ES")} km` : null,
    interno && rev.tecnico ? rev.tecnico : null,
    rev.estado === "completada" ? null : "SIN TERMINAR",
  ].filter(Boolean).join("  ·  ");
  if (derecha) {
    const w = l.normal.widthOfTextAtSize(derecha, 8);
    texto(l, derecha, A4.ancho - MARGEN - w, y + 3, {
      tam: 8, color: rev.estado === "completada" ? SUAVE : AMBAR,
    });
  }

  if (rev.ruedas.length === 0) {
    texto(l, "Sin mediciones de neumático guardadas.", MARGEN + 8, sitio(l, 12), { tam: 8, color: SUAVE });
    return;
  }

  const cols: Columna[] = [
    { t: "Posición", x: MARGEN + 8, w: 95 },
    { t: "Prof. mm", x: MARGEN + 106, w: 50, derecha: true },
    { t: "Mínimo", x: MARGEN + 160, w: 45, derecha: true },
    { t: "Presión bar", x: MARGEN + 208, w: 56, derecha: true },
    { t: "Estado", x: MARGEN + 280, w: 70 },
    { t: "Neumático", x: MARGEN + 354, w: 155 },
  ];
  cabeceraTabla(l, cols);
  for (const rd of rev.ruedas) {
    fila(l, cols, [
      rd.posicion,
      { t: mm(rd.profundidad), color: COLOR_ESTADO[rd.estado], negrita: rd.estado === "bajo_minimo" },
      mm(rd.minimo),
      bar(rd.presion),
      {
        t: rd.estado === "bajo_minimo" ? "Bajo mínimo"
          : rd.estado === "aviso" ? "Aviso"
          : rd.estado === "sin_medir" ? "Sin medir" : "Correcto",
        color: COLOR_ESTADO[rd.estado],
      },
      rd.detalle ?? "—",
    ]);
  }
  if (rev.observaciones) {
    texto(l, `Observaciones: ${rev.observaciones}`, MARGEN + 8, sitio(l, 12),
      { tam: 7.5, color: SUAVE, ancho: A4.ancho - 2 * MARGEN - 16 });
  }
}

/** Pie con empresa, periodo y numeración, en todas las páginas. */
function pies(l: Lienzo, empresa: string, d: Documento): void {
  const total = l.paginas.length;
  l.paginas.forEach((p, i) => {
    const izq = `${empresa} · ${fecha(d.periodo.desde)} - ${fecha(d.periodo.hasta)}`;
    p.drawLine({
      start: { x: MARGEN, y: PIE - 8 }, end: { x: A4.ancho - MARGEN, y: PIE - 8 },
      thickness: 0.4, color: LINEA,
    });
    p.drawText(izq.replace(/[^\x20-\x7E -ÿ€]/g, ""), {
      x: MARGEN, y: PIE - 20, size: 7, font: l.normal, color: SUAVE,
    });
    const der = `Página ${i + 1} de ${total}`;
    p.drawText(der, {
      x: A4.ancho - MARGEN - l.normal.widthOfTextAtSize(der, 7), y: PIE - 20,
      size: 7, font: l.normal, color: SUAVE,
    });
  });
}
