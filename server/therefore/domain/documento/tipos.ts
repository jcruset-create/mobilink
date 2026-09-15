/**
 * Lo que viaja entre el lector de PDF y el parser de albaranes.
 *
 * Todo lo de esta carpeta es PURO: entra texto con coordenadas y sale
 * estructura. No abre ficheros, no toca la base y no sabe que existen los
 * expedientes. Esa frontera es la que permite que el caso difícil —un albarán
 * partido entre dos páginas con la cabecera repetida— se pruebe con un objeto
 * escrito a mano, sin generar un PDF ni levantar PostgreSQL.
 *
 * ── Por qué las coordenadas viajan con el texto ─────────────────────────────
 *
 * Porque una tabla de albarán no es texto, es una rejilla. «60% + 10%» debajo
 * de la columna «Dto» es un descuento; los mismos caracteres debajo de
 * «Descripción» son parte del nombre del artículo. Sin la `x` no se distinguen,
 * y un parser que sólo ve la línea entera acaba adivinando por el orden de las
 * palabras, que es exactamente lo que cambia de un proveedor a otro.
 *
 * Y porque el `bbox` es lo que luego permite enseñar en pantalla DE DÓNDE salió
 * cada celda: sin él, «el precio es 77,50» es una afirmación que nadie puede
 * comprobar sin volver a abrir el PDF a mano.
 *
 * ── El origen de la Y ───────────────────────────────────────────────────────
 *
 * `y` se mide desde ARRIBA de la página, como la da mupdf, y crece hacia
 * abajo. Ordenar por `y` ascendente es leer de arriba abajo. Es la misma
 * convención que `fixtures/pdf.ts`, y cambiarla a mitad de camino es la forma
 * más rápida de que un albarán salga del revés.
 */

/**
 * Una palabra suelta con su caja exacta. Es la unidad que hace posible leer
 * una tabla: la columna a la que pertenece una celda la decide su `x`.
 */
export type Palabra = {
  texto: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Una fila de texto del PDF, con su sitio en la página y sus palabras. */
export type LineaTexto = {
  /** 1-indexada. */
  pagina: number;
  /** Borde izquierdo, en puntos. */
  x: number;
  /** Borde superior, en puntos, medido desde arriba. */
  y: number;
  /** Ancho y alto de la caja que ocupa. */
  w: number;
  h: number;
  /** Tamaño de fuente en puntos. Sirve para distinguir un título de una fila. */
  tamano: number;
  /** Las palabras unidas por un espacio. Es lo que se busca y se enseña. */
  texto: string;
  /** Las mismas, una a una, con su posición. Vacío en las pruebas que no la usan. */
  palabras: Palabra[];
};

export type PaginaTexto = {
  numero: number;
  ancho: number;
  alto: number;
  lineas: LineaTexto[];
};

export type DocumentoTexto = {
  paginas: PaginaTexto[];
};

/** Rectángulo en puntos de página, para el resalte del visor. */
export type Caja = { x: number; y: number; w: number; h: number };

export function cajaDe(l: LineaTexto | Palabra): Caja {
  return { x: l.x, y: l.y, w: l.w, h: l.h };
}

/** La caja que envuelve a varias. Vacía si no hay ninguna. */
export function cajaEnvolvente(lineas: (LineaTexto | Palabra)[]): Caja | null {
  if (lineas.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const l of lineas) {
    x0 = Math.min(x0, l.x);
    y0 = Math.min(y0, l.y);
    x1 = Math.max(x1, l.x + l.w);
    y1 = Math.max(y1, l.y + l.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Las líneas de todas las páginas en una sola secuencia, en orden de lectura.
 *
 * Primero por página, luego por `y` y luego por `x`. Es el orden en el que una
 * persona lee el papel, y el único en el que «la línea siguiente» significa
 * algo.
 */
export function aplanar(doc: DocumentoTexto): LineaTexto[] {
  const todas: LineaTexto[] = [];
  for (const p of [...doc.paginas].sort((a, b) => a.numero - b.numero)) {
    const ordenadas = [...p.lineas].sort((a, b) => a.y - b.y || a.x - b.x);
    todas.push(...ordenadas);
  }
  return todas;
}

/** Cuántos caracteres tiene el documento. Sirve para decidir si está escaneado. */
export function caracteres(doc: DocumentoTexto): number {
  return doc.paginas.reduce(
    (n, p) => n + p.lineas.reduce((m, l) => m + l.texto.trim().length, 0),
    0
  );
}
