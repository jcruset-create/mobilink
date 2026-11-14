/**
 * La hoja de trabajo del patio, en papel.
 *
 * Una ficha por vehículo, agrupadas por base, con todo lo que se sabe de él:
 * dónde está, cuánto lleva, qué le toca, cuándo se revisó por última vez y
 * cómo quedaron sus ruedas.
 *
 * Es un documento para llevar en la mano por el patio, así que va en fichas
 * y no en una tabla apretada: se lee de pie, tachando.
 *
 * Aquí solo se pinta. Qué sale lo decide `armar.ts`.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { enPalabras, type BaseDoc, type DocumentoPendientes, type VehiculoPendiente } from "./armar.ts";
import { limpiarParaPdf } from "../informes/texto.ts";

const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN = 36;
const PIE = 44;

const TINTA = rgb(0.12, 0.14, 0.18);
const SUAVE = rgb(0.42, 0.45, 0.5);
const LINEA = rgb(0.82, 0.84, 0.87);
const ROJO = rgb(0.72, 0.15, 0.17);
const AMBAR = rgb(0.72, 0.47, 0.05);
const FONDO = rgb(0.95, 0.96, 0.97);
const CASILLA = rgb(0.55, 0.58, 0.62);

const ETIQUETA_PERIODICIDAD: Record<string, string> = {
  sin_revision: "SIN REVISIÓN",
  vencida: "VENCIDA",
  proxima: "PRÓXIMA",
};

interface Lienzo {
  doc: PDFDocument; normal: PDFFont; negrita: PDFFont;
  pagina: PDFPage; y: number; paginas: PDFPage[];
}

function nuevaPagina(l: Lienzo): void {
  l.pagina = l.doc.addPage([A4.ancho, A4.alto]);
  l.paginas.push(l.pagina);
  l.y = A4.alto - MARGEN;
}

function sitio(l: Lienzo, alto: number): number {
  if (l.y - alto < PIE) nuevaPagina(l);
  l.y -= alto;
  return l.y;
}

function texto(l: Lienzo, s: string, x: number, y: number, o: {
  tam?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; ancho?: number;
} = {}): void {
  const tam = o.tam ?? 8.5;
  const font = o.font ?? l.normal;
  // pdf-lib revienta con lo que la fuente no tiene: se limpia en vez de
  // dejar que falle la generación entera por un carácter raro.
  let t = limpiarParaPdf(s);
  if (o.ancho) while (t.length > 1 && font.widthOfTextAtSize(t, tam) > o.ancho) t = t.slice(0, -1);
  l.pagina.drawText(t, { x, y, size: tam, font, color: o.color ?? TINTA });
}

const fecha = (iso: string | null) => {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
};
const num = (n: number | null | undefined, suf = "") =>
  n == null ? "—" : `${Math.round(n).toLocaleString("es-ES")}${suf}`;

/** Un par etiqueta/valor dentro de la ficha. */
function dato(l: Lienzo, x: number, y: number, ancho: number, etiqueta: string, valor: string,
              color = TINTA): void {
  texto(l, etiqueta.toUpperCase(), x, y + 10, { tam: 5.8, color: SUAVE, ancho });
  texto(l, valor, x, y, { tam: 8.5, color, ancho });
}

export async function generarPendientesPdf(d: DocumentoPendientes): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const l: Lienzo = {
    doc,
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
    pagina: null as unknown as PDFPage, y: 0, paginas: [],
  };
  nuevaPagina(l);

  texto(l, d.titulo, MARGEN, sitio(l, 24), { tam: 17, font: l.negrita });
  texto(l, d.empresa + (d.baseFiltrada ? `  ·  ${d.baseFiltrada}` : "  ·  todas las bases"),
    MARGEN, sitio(l, 15), { tam: 11, color: SUAVE });
  const gen = new Date(d.generado);
  texto(l,
    `${d.total} vehículo(s) dentro de una base y pendientes de revisar`
    + `  ·  foto del ${String(gen.getUTCDate()).padStart(2, "0")}/`
    + `${String(gen.getUTCMonth() + 1).padStart(2, "0")}/${gen.getUTCFullYear()} `
    + `a las ${String(gen.getUTCHours()).padStart(2, "0")}:${String(gen.getUTCMinutes()).padStart(2, "0")} UTC`,
    MARGEN, sitio(l, 14), { tam: 8, color: SUAVE });
  texto(l, "Los vehículos se mueven: esto vale para el rato siguiente, no para mañana.",
    MARGEN, sitio(l, 14), { tam: 7.5, color: SUAVE });

  for (const base of d.bases) pintarBase(l, base);

  if (d.advertencias.length > 0) {
    sitio(l, 10);
    texto(l, "NOTAS", MARGEN, sitio(l, 14), { tam: 8, font: l.negrita, color: SUAVE });
    for (const a of d.advertencias) {
      texto(l, `- ${a}`, MARGEN, sitio(l, 11), { tam: 7.5, color: SUAVE, ancho: A4.ancho - 2 * MARGEN });
    }
  }

  pies(l, d);
  return doc.save();
}

function pintarBase(l: Lienzo, base: BaseDoc): void {
  sitio(l, 8);
  // Una base no empieza al final de una página: con menos de una ficha de
  // hueco, se pasa a la siguiente.
  if (l.y < PIE + 110) nuevaPagina(l);
  const y = sitio(l, 20);
  l.pagina.drawRectangle({ x: MARGEN - 4, y: y - 4, width: A4.ancho - 2 * MARGEN + 8, height: 19, color: FONDO });
  texto(l, base.nombre, MARGEN, y + 2, { tam: 11, font: l.negrita });
  const der = `${base.vehiculos.length} pendiente(s)`
    + (base.vencidos ? `  ·  ${base.vencidos} vencida(s) o sin revisión` : "");
  texto(l, der, A4.ancho - MARGEN - l.normal.widthOfTextAtSize(der, 8), y + 3,
    { tam: 8, color: base.vencidos ? ROJO : SUAVE });

  for (const v of base.vehiculos) pintarVehiculo(l, v);
}

/** La ficha de un vehículo: dos filas de datos y una casilla para tachar. */
function pintarVehiculo(l: Lienzo, v: VehiculoPendiente): void {
  const ALTO = 62;
  if (l.y - ALTO < PIE) nuevaPagina(l);
  const y = sitio(l, ALTO);
  const ancho = A4.ancho - 2 * MARGEN;

  l.pagina.drawRectangle({
    x: MARGEN - 4, y: y - 2, width: ancho + 8, height: ALTO - 4,
    borderColor: LINEA, borderWidth: 0.6,
  });

  // La casilla para tachar en el patio. Es papel: se usa con un bolígrafo.
  l.pagina.drawRectangle({
    x: MARGEN + 2, y: y + ALTO - 24, width: 11, height: 11,
    borderColor: CASILLA, borderWidth: 0.8,
  });

  const arriba = y + ALTO - 22;
  texto(l, v.matricula, MARGEN + 20, arriba, { tam: 12, font: l.negrita });
  const anchoMat = l.negrita.widthOfTextAtSize(v.matricula, 12);
  if (v.unidad) {
    texto(l, `u. ${v.unidad}`, MARGEN + 26 + anchoMat, arriba + 1, { tam: 9, color: SUAVE });
  }

  const etiqueta = ETIQUETA_PERIODICIDAD[v.periodicidad] ?? v.periodicidad.toUpperCase();
  const colorEt = v.periodicidad === "proxima" ? AMBAR : ROJO;
  const detalle = v.diasVencido != null && v.diasVencido > 0 ? `  ${v.diasVencido} d` : "";
  const txt = etiqueta + detalle;
  const w = l.negrita.widthOfTextAtSize(txt, 8.5);
  l.pagina.drawRectangle({
    x: A4.ancho - MARGEN - w - 10, y: arriba - 3, width: w + 8, height: 14,
    color: colorEt, opacity: 0.12,
  });
  texto(l, txt, A4.ancho - MARGEN - w - 6, arriba, { tam: 8.5, font: l.negrita, color: colorEt });

  const f = v.ficha;
  const col = (i: number) => MARGEN + 20 + i * ((ancho - 20) / 5);

  const fila1 = y + ALTO - 42;
  dato(l, col(0), fila1, 95, "En la base", enPalabras(v.enBaseMin));
  dato(l, col(1), fila1, 95, "Posición de hace", enPalabras(v.posicionMin));
  dato(l, col(2), fila1, 95, "Al centro", v.distanciaM == null ? "—" : `${Math.round(v.distanciaM)} m`);
  dato(l, col(3), fila1, 95, "Última revisión", fecha(v.ultimaRevision));
  dato(l, col(4), fila1, 100, "La hizo", v.ultimaRevisionPor ?? "—");

  const fila2 = y + ALTO - 58;
  dato(l, col(0), fila2, 95, "Tipo", f?.tipo ?? "—");
  dato(l, col(1), fila2, 95, "Config. ejes", f?.config ?? "—");
  dato(l, col(2), fila2, 95, "Medida", f?.medida ?? "—");
  // «0 de 0» no es un dato, es un vehículo sin plan de ejes: se dice así.
  const plano = f?.ruedas_plano ?? 0;
  const montadas = f?.ruedas_montadas ?? 0;
  dato(l, col(3), fila2, 95, "Ruedas",
    !f ? "—" : plano === 0 ? (montadas > 0 ? `${montadas} (sin plan)` : "sin plan de ejes")
      : `${montadas} de ${plano}`,
    f && plano > 0 && montadas < plano ? AMBAR : TINTA);
  dato(l, col(4), fila2, 100, "Prof. mínima",
    f?.profundidad_minima == null ? "—" : `${f.profundidad_minima.toFixed(1)} mm`
      + (f.bajo_minimo ? `  ${f.bajo_minimo} bajo mín.` : f.en_aviso ? `  ${f.en_aviso} aviso` : ""),
    f?.bajo_minimo ? ROJO : f?.en_aviso ? AMBAR : TINTA);

  if (f?.km_actual != null && f.km_actual > 0) {
    const km = `${num(f.km_actual)} km`;
    texto(l, km, A4.ancho - MARGEN - l.normal.widthOfTextAtSize(km, 7.5), y + 4,
      { tam: 7.5, color: SUAVE });
  }
}

function pies(l: Lienzo, d: DocumentoPendientes): void {
  const total = l.paginas.length;
  l.paginas.forEach((p, i) => {
    p.drawLine({ start: { x: MARGEN, y: PIE - 8 }, end: { x: A4.ancho - MARGEN, y: PIE - 8 },
      thickness: 0.4, color: LINEA });
    const izq = `${d.empresa} · pendientes de revisar en base${d.baseFiltrada ? ` · ${d.baseFiltrada}` : ""}`;
    p.drawText(limpiarParaPdf(izq),
      { x: MARGEN, y: PIE - 19, size: 7, font: l.normal, color: SUAVE });
    const der = `Página ${i + 1} de ${total}`;
    p.drawText(limpiarParaPdf(der), { x: A4.ancho - MARGEN - l.normal.widthOfTextAtSize(der, 7), y: PIE - 19,
      size: 7, font: l.normal, color: SUAVE });
  });
}
