/**
 * Varios tickets en una hoja A4: dónde va cada uno.
 *
 * Dominio puro. Entran los tamaños de los tickets —ya recortado el blanco del
 * escáner— y la zona útil de la hoja; salen las hojas con la posición de cada
 * ticket. Ni PDF, ni base de datos: quien dibuja es `montar()` en `report.ts`.
 * Diseño y decisiones en `docs/PROMPT_tickets_en_a4.md`.
 *
 * ## Las reglas
 *
 * · **Al 100 %, y hasta el 80 % si con eso sobra una hoja.** Un ticket térmico
 *   se imprime con letra de unos 2,5 mm; al 80 % queda en 2 mm, que se lee
 *   bien en papel. Nunca se amplía: un ticket ampliado no es más legible, solo
 *   más grande.
 * · **La misma escala para todo el grupo.** Una hoja con tickets a tamaños
 *   distintos parece un error, y comparar dos tickets del mismo bar pide que
 *   estén igual.
 * · **Por filas y en orden de lectura**, de izquierda a derecha, cada fila
 *   centrada. Se probó por columnas: dejaba un tercio de hoja vacío.
 * · **Se elige la mayor escala que da el mínimo de hojas.** Reducir solo tiene
 *   sentido si ahorra papel; si al 90 % salen las mismas hojas que al 100 %,
 *   se queda al 100 %.
 */

/** Puntos por milímetro (1 pt = 1/72 pulgada). */
export const PT_POR_MM = 72 / 25.4;

export const ESCALA_MAXIMA = 1;
export const ESCALA_MINIMA = 0.8;

export type Tamano = { ancho: number; alto: number };

/** La zona de la hoja donde van los tickets, en puntos. */
export type Zona = {
  ancho: number;
  alto: number;
  /** Aire entre tickets, a lo ancho y a lo alto. */
  separacion: number;
  /** Alto del rótulo que va encima de cada ticket. */
  rotulo: number;
};

/** Un ticket colocado. `x` e `y` son la esquina de arriba a la izquierda del RÓTULO, medidas desde la de la zona. */
export type Colocacion = {
  /** Su posición en la lista de entrada. */
  indice: number;
  x: number;
  y: number;
  /** Ya escalados. El ticket va debajo del rótulo. */
  ancho: number;
  alto: number;
};

export type Reparto = { escala: number; hojas: Colocacion[][] };

/** Si un ticket cabe solo en la hoja a esa escala. */
export function cabeSolo(t: Tamano, zona: Zona, escala: number): boolean {
  return t.ancho * escala <= zona.ancho + 1e-6 && t.alto * escala + zona.rotulo <= zona.alto + 1e-6;
}

/**
 * Por filas a una escala dada. `null` si alguno no cabe ni solo en la hoja.
 */
function porFilas(tamanos: readonly Tamano[], zona: Zona, escala: number): Colocacion[][] | null {
  if (!tamanos.every((t) => cabeSolo(t, zona, escala))) return null;

  const hojas: Colocacion[][] = [];
  let hoja: Colocacion[] = [];
  let fila: Colocacion[] = [];
  let x = 0;
  let y = 0;
  let altoFila = 0;

  const cerrarFila = () => {
    if (fila.length === 0) return;
    // Centrada: el hueco que sobra, a partes iguales a cada lado.
    const ocupado = x - zona.separacion;
    const margen = (zona.ancho - ocupado) / 2;
    for (const c of fila) c.x += margen;
    hoja.push(...fila);
    fila = [];
  };

  tamanos.forEach((t, indice) => {
    const ancho = t.ancho * escala;
    const alto = t.alto * escala;
    const altoCasilla = alto + zona.rotulo;

    // No cabe a lo ancho: fila nueva.
    if (fila.length > 0 && x + ancho > zona.ancho + 1e-6) {
      cerrarFila();
      y += altoFila + zona.separacion;
      x = 0;
      altoFila = 0;
    }
    // No cabe a lo alto: hoja nueva.
    if (y + altoCasilla > zona.alto + 1e-6) {
      cerrarFila();
      hojas.push(hoja);
      hoja = [];
      x = 0;
      y = 0;
      altoFila = 0;
    }
    fila.push({ indice, x, y, ancho, alto });
    x += ancho + zona.separacion;
    altoFila = Math.max(altoFila, altoCasilla);
  });
  cerrarFila();
  if (hoja.length > 0) hojas.push(hoja);
  return hojas;
}

/**
 * El reparto de un grupo: la mayor escala entre el 80 % y el 100 % que da el
 * menor número de hojas. `null` si alguno no cabe ni al 80 % —ese no es un
 * ticket para el mosaico, va en su hoja como siempre—.
 */
export function repartir(
  tamanos: readonly Tamano[],
  zona: Zona,
  { minima = ESCALA_MINIMA, maxima = ESCALA_MAXIMA }: { minima?: number; maxima?: number } = {}
): Reparto | null {
  if (tamanos.length === 0) return { escala: maxima, hojas: [] };
  let mejor: Reparto | null = null;
  // De punto en punto: a partir de 100 se cuenta en enteros para no arrastrar decimales.
  for (let p = Math.round(maxima * 100); p >= Math.round(minima * 100); p--) {
    const escala = p / 100;
    const hojas = porFilas(tamanos, zona, escala);
    if (!hojas) continue;
    if (!mejor || hojas.length < mejor.hojas.length) mejor = { escala, hojas };
  }
  return mejor;
}

// ── Qué es un ticket ──────────────────────────────────────────────────────

const A4_MM = { ancho: 210, alto: 297 };

/**
 * Si una página escaneada es un ticket, con su tamaño original y el de lo que
 * tiene tinta, en milímetros.
 *
 * · Estrecho: lo que tiene tinta no pasa de media A4 de ancho (105 mm). Un
 *   ticket térmico es de 58 u 80 mm.
 * · Y además, o el papel entero es pequeño (no más ancho que un A5, 148 mm) o
 *   lo que tiene tinta ocupa como mucho un cuarto de A4 —el escáner que no
 *   recorta y deja el ticket en medio de un A4 blanco—.
 *
 * Una factura A4 no pasa nunca: su tinta ocupa el ancho de la hoja. Tampoco la
 * última hoja de una factura con solo los totales, que van de lado a lado.
 */
export function esTicket(original: Tamano, conTinta: Tamano): boolean {
  if (conTinta.ancho <= 0 || conTinta.alto <= 0) return false;
  if (conTinta.ancho > A4_MM.ancho / 2) return false;
  const papelPequeno = original.ancho <= 148;
  const tintaPequena = conTinta.ancho * conTinta.alto <= (A4_MM.ancho * A4_MM.alto) / 4;
  return papelPequeno || tintaPequena;
}

/**
 * Si el recorte es de fiar.
 *
 * Un ticket de papel pequeño ocupa casi todo su papel: los de la semana de
 * Ivan pierden un 15 % por lado al recortar. Si el recorte se come más del
 * 40 % de un lado, lo más probable es que la impresión sea tan clara que no
 * se ha visto como tinta —pasó con el peaje de Calafell, recortado al código
 * de barras— y se usa la página entera. Mejor un ticket con blanco que un
 * ticket al que le falta el importe.
 *
 * En papel grande (el escáner que no recorta) el ticket es por definición una
 * parte pequeña de la hoja, así que ahí no se aplica.
 */
export function recorteFiable(original: Tamano, conTinta: Tamano): boolean {
  if (original.ancho > 148) return true;
  return conTinta.ancho >= original.ancho * 0.6 && conTinta.alto >= original.alto * 0.6;
}

/**
 * Dónde hay tinta en una página rasterizada en gris: la caja en píxeles, o
 * `null` si está en blanco.
 *
 * Una fila o columna cuenta si más del 0,5 % de sus píxeles es oscuro. Así una
 * mota del cristal del escáner o un punto de polvo no estiran la caja hasta el
 * borde. «Oscuro» es por debajo de 200 sobre 255, y no de 140: a 72 ppp un
 * trazo fino de un ticket térmico desvaído sale en gris claro (el de Calafell,
 * entre 130 y 220), y con 140 se tomaba por blanco.
 */
export function cajaDeTinta(
  gris: Uint8Array | Uint8ClampedArray,
  ancho: number,
  alto: number,
  paso: number,
  { umbral = 200, proporcion = 0.005 }: { umbral?: number; proporcion?: number } = {}
): { x0: number; y0: number; x1: number; y1: number } | null {
  const minFila = Math.max(1, ancho * proporcion);
  const minColumna = Math.max(1, alto * proporcion);
  const filaConTinta = (y: number) => {
    let n = 0;
    for (let x = 0; x < ancho; x++) if (gris[y * paso + x]! < umbral && ++n >= minFila) return true;
    return false;
  };
  const columnaConTinta = (x: number) => {
    let n = 0;
    for (let y = 0; y < alto; y++) if (gris[y * paso + x]! < umbral && ++n >= minColumna) return true;
    return false;
  };
  let y0 = 0;
  while (y0 < alto && !filaConTinta(y0)) y0++;
  if (y0 === alto) return null;
  let y1 = alto - 1;
  while (y1 > y0 && !filaConTinta(y1)) y1--;
  let x0 = 0;
  while (x0 < ancho && !columnaConTinta(x0)) x0++;
  if (x0 === ancho) return null;
  let x1 = ancho - 1;
  while (x1 > x0 && !columnaConTinta(x1)) x1--;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
