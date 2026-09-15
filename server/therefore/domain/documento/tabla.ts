/**
 * La rejilla de la tabla: qué columna es cada cosa.
 *
 * Una fila de albarán son cinco o seis datos colocados en columnas. Lo que
 * dice a cuál pertenece cada uno no es el orden —cambia de un proveedor a
 * otro— sino la POSICIÓN. Por eso se busca primero la fila de títulos y se
 * convierte en franjas verticales; a partir de ahí, «lo que caiga en esta
 * franja es el precio» es una afirmación comprobable.
 *
 * ── Y cuando no hay títulos ─────────────────────────────────────────────────
 *
 * Hay albaranes sin cabecera de tabla: las filas están, los títulos no. Ahí se
 * pasa a MODO POSICIONAL, que lee cada fila por la forma de sus tokens —una
 * tirada larga de dígitos es una referencia, el último número con dos
 * decimales es el importe— y **baja la confianza a 0,70 en todos los campos**.
 * Es una lectura razonable, no una lectura segura, y el que la use tiene que
 * saberlo: con esa confianza ninguna línea llega a `OK` sin que además le
 * cuadre la aritmética.
 *
 * Los sinónimos de cada columna son configurables (`albaran.columnas.*`) para
 * que un proveedor que escriba «Uds.» en vez de «Cant.» se atienda sin
 * desplegar. Cuando no basta con una palabra, se escribe un parser específico:
 * la configuración no es el sitio donde meter la lógica de nadie.
 */

import { normalizar } from "../correo/texto.ts";
import type { LineaTexto, Palabra } from "./tipos.ts";

export type TipoColumna =
  | "referencia"
  | "descripcion"
  | "cantidad"
  | "precio"
  | "descuento"
  | "importe";

export const TIPOS_COLUMNA: readonly TipoColumna[] = [
  "referencia",
  "descripcion",
  "cantidad",
  "precio",
  "descuento",
  "importe",
];

export type SinonimosColumna = Record<TipoColumna, readonly string[]>;

export const SINONIMOS_COLUMNA_POR_DEFECTO: SinonimosColumna = {
  referencia: ["ref", "ref.", "referencia", "artículo", "articulo", "código", "codigo", "cod."],
  descripcion: ["descripción", "descripcion", "concepto", "denominación", "denominacion", "detalle"],
  cantidad: ["cant", "cant.", "cantidad", "uds", "uds.", "unid", "unidades"],
  precio: ["precio", "p.unit", "p. unit", "p.v.p", "pvp", "precio unitario"],
  descuento: ["dto", "dto.", "desc", "desc.", "descuento", "dto%", "%dto"],
  importe: ["importe", "total", "neto", "importe neto"],
};

/** Confianza de lo leído sin cabecera de columnas. */
export const CONFIANZA_POSICIONAL = 0.7;

export type Columna = {
  tipo: TipoColumna;
  /** El título tal y como está impreso. */
  etiqueta: string;
  /** Franja vertical. `-Infinity` / `Infinity` en los extremos. */
  x0: number;
  x1: number;
};

export type Rejilla = {
  modo: "CABECERA" | "POSICIONAL";
  columnas: Columna[];
  filaCabecera: LineaTexto | null;
  /** Techo de confianza de lo que se lea con esta rejilla. */
  confianza: number;
};

export const REJILLA_POSICIONAL: Rejilla = {
  modo: "POSICIONAL",
  columnas: [],
  filaCabecera: null,
  confianza: CONFIANZA_POSICIONAL,
};

/** Mínimo de títulos reconocidos para dar una fila por cabecera de tabla. */
const MIN_TITULOS = 3;

function limpia(v: string): string {
  return normalizar(v).toLowerCase().replace(/[:|]/g, "").trim();
}

/** Qué columna nombra esta palabra, si nombra alguna. */
export function columnaDe(palabra: string, sinonimos: SinonimosColumna): TipoColumna | null {
  const t = limpia(palabra);
  if (!t) return null;
  let mejor: { tipo: TipoColumna; largo: number } | null = null;
  for (const tipo of TIPOS_COLUMNA) {
    for (const s of sinonimos[tipo]) {
      const n = limpia(s);
      if (t === n && (!mejor || n.length > mejor.largo)) mejor = { tipo, largo: n.length };
    }
  }
  return mejor?.tipo ?? null;
}

/** Cuántos títulos de columna reconoce esta fila. */
export function titulosEnLaFila(fila: LineaTexto, sinonimos: SinonimosColumna): number {
  const vistos = new Set<TipoColumna>();
  for (const p of fila.palabras) {
    const tipo = columnaDe(p.texto, sinonimos);
    if (tipo) vistos.add(tipo);
  }
  // Los títulos de dos palabras («Precio unitario») se cuentan una vez más.
  const juntas = limpia(fila.texto);
  for (const tipo of TIPOS_COLUMNA) {
    if (vistos.has(tipo)) continue;
    for (const s of sinonimos[tipo]) {
      const n = limpia(s);
      if (n.includes(" ") && juntas.includes(n)) vistos.add(tipo);
    }
  }
  return vistos.size;
}

/**
 * Busca la fila de títulos y la convierte en franjas.
 *
 * La frontera entre dos columnas es el punto medio entre el final de un título
 * y el principio del siguiente. Es la elección que aguanta las dos formas de
 * alinear que existen: los textos se alinean a la izquierda bajo su título y
 * los números a la derecha, a veces sobresaliendo por el lado contrario.
 */
export function detectarRejilla(
  lineas: LineaTexto[],
  sinonimos: SinonimosColumna = SINONIMOS_COLUMNA_POR_DEFECTO
): Rejilla {
  let cabecera: LineaTexto | null = null;
  let mejor = 0;
  for (const l of lineas) {
    const n = titulosEnLaFila(l, sinonimos);
    if (n >= MIN_TITULOS && n > mejor) {
      mejor = n;
      cabecera = l;
    }
  }
  if (!cabecera) return REJILLA_POSICIONAL;

  // Un título puede ocupar dos palabras seguidas («Precio unitario»): se
  // fusionan para que la franja empiece donde empieza el título completo.
  type Ancla = { tipo: TipoColumna; etiqueta: string; x0: number; x1: number };
  const anclas: Ancla[] = [];
  for (const p of [...cabecera.palabras].sort((a, b) => a.x - b.x)) {
    const tipo = columnaDe(p.texto, sinonimos);
    const ultima = anclas[anclas.length - 1];
    if (!tipo) {
      // Palabra suelta pegada al título anterior: parte de su nombre.
      if (ultima && p.x - ultima.x1 < 6) {
        ultima.etiqueta += ` ${p.texto}`;
        ultima.x1 = p.x + p.w;
      }
      continue;
    }
    if (ultima && ultima.tipo === tipo) {
      ultima.etiqueta += ` ${p.texto}`;
      ultima.x1 = p.x + p.w;
      continue;
    }
    anclas.push({ tipo, etiqueta: p.texto, x0: p.x, x1: p.x + p.w });
  }

  const columnas: Columna[] = anclas.map((a, i) => ({
    tipo: a.tipo,
    etiqueta: a.etiqueta,
    x0: i === 0 ? -Infinity : (anclas[i - 1].x1 + a.x0) / 2,
    x1: i === anclas.length - 1 ? Infinity : (a.x1 + anclas[i + 1].x0) / 2,
  }));

  return { modo: "CABECERA", columnas, filaCabecera: cabecera, confianza: 1 };
}

export type Celdas = Partial<Record<TipoColumna, string>>;

/** A qué columna cae una palabra: la que contiene su centro, o la más cercana. */
function columnaDeLaPalabra(p: Palabra, columnas: Columna[]): Columna | null {
  if (columnas.length === 0) return null;
  const centro = p.x + p.w / 2;
  for (const c of columnas) if (centro >= c.x0 && centro < c.x1) return c;
  let cercana = columnas[0];
  let mejor = Infinity;
  for (const c of columnas) {
    const d = Math.min(Math.abs(centro - c.x0), Math.abs(centro - c.x1));
    if (d < mejor) {
      mejor = d;
      cercana = c;
    }
  }
  return cercana;
}

const NUMERO_CON_DECIMALES = /^[-−+]?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$|^[-−+]?\d+[.,]\d{2}$/;
const PARECE_REFERENCIA = /^(?:\d{6,}|[A-Z0-9][A-Z0-9./-]{4,})$/i;
const PORCENTAJE = /\d+(?:[.,]\d+)?\s*%/;

/** Reparte la fila en celdas usando la rejilla de títulos. */
function porColumnas(fila: LineaTexto, columnas: Columna[]): Celdas {
  const trozos = new Map<TipoColumna, string[]>();
  for (const p of [...fila.palabras].sort((a, b) => a.x - b.x)) {
    const c = columnaDeLaPalabra(p, columnas);
    if (!c) continue;
    const lista = trozos.get(c.tipo);
    if (lista) lista.push(p.texto);
    else trozos.set(c.tipo, [p.texto]);
  }
  const celdas: Celdas = {};
  for (const [tipo, palabras] of trozos) celdas[tipo] = palabras.join(" ").trim();
  return celdas;
}

/**
 * Reparte la fila sin títulos, por la forma de cada token.
 *
 * El orden en el que se consume importa: primero se aparta el importe —el
 * último número con dos decimales—, porque si no el precio se lo llevaría.
 * Lo que no encaja en ningún molde se queda en la descripción, que es el único
 * sitio donde un dato de más no hace daño.
 */
function porForma(fila: LineaTexto): Celdas {
  const palabras = [...fila.palabras].sort((a, b) => a.x - b.x);
  const libres = palabras.map((p) => p.texto);
  const celdas: Celdas = {};

  const descuentos: string[] = [];
  for (let i = libres.length - 1; i >= 0; i--) {
    if (PORCENTAJE.test(libres[i]) || libres[i] === "+") {
      // `60% + 10%` son tres tokens; se recogen en orden.
      descuentos.unshift(libres[i]);
      libres.splice(i, 1);
    }
  }
  if (descuentos.length) celdas.descuento = descuentos.join(" ").replace(/\s*\+\s*/g, " + ").trim();

  const numeros: number[] = [];
  for (let i = 0; i < libres.length; i++) if (NUMERO_CON_DECIMALES.test(libres[i])) numeros.push(i);

  if (numeros.length >= 1) {
    celdas.importe = libres[numeros[numeros.length - 1]];
    libres[numeros[numeros.length - 1]] = "";
  }
  if (numeros.length >= 2) {
    celdas.precio = libres[numeros[numeros.length - 2]];
    libres[numeros[numeros.length - 2]] = "";
  }
  if (numeros.length >= 3) {
    celdas.cantidad = libres[numeros[0]];
    libres[numeros[0]] = "";
  }

  for (let i = 0; i < libres.length; i++) {
    if (libres[i] && PARECE_REFERENCIA.test(libres[i])) {
      celdas.referencia = libres[i];
      libres[i] = "";
      break;
    }
  }

  const resto = libres.filter(Boolean).join(" ").trim();
  if (resto) celdas.descripcion = resto;
  return celdas;
}

export function repartirEnColumnas(fila: LineaTexto, rejilla: Rejilla): Celdas {
  return rejilla.modo === "CABECERA" ? porColumnas(fila, rejilla.columnas) : porForma(fila);
}
