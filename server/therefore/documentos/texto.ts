/**
 * Abrir un PDF y sacar su texto con coordenadas.
 *
 * Es la única pieza del análisis que toca un fichero. Todo lo que viene
 * después —secciones, tabla, líneas, validaciones— es puro y se prueba con
 * objetos escritos a mano; esto se prueba con PDF generados en el propio test.
 *
 * ── Por qué se lee carácter a carácter ──────────────────────────────────────
 *
 * mupdf ya agrupa el texto en «líneas», pero las agrupa por proximidad: en una
 * fila de albarán junta la referencia con la descripción —van pegadas— y deja
 * el importe aparte —va lejos—. El resultado es que la referencia y la
 * descripción acaban en la misma cadena, sin saber dónde termina una y empieza
 * la otra, que es justo lo que hay que saber para asignarlas a su columna.
 *
 * `walk()` da la posición EXACTA de cada carácter. Con eso se construyen las
 * palabras de verdad, cada una con su `x`, y la rejilla de la tabla deja de ser
 * una estimación. Cuesta un recorrido más y ahorra toda una familia de fallos
 * silenciosos: una referencia que se cuela dentro de la descripción no hace
 * fallar nada, sólo deja la columna de referencia vacía.
 *
 * ── Texto primero; la imagen sólo si no hay texto ───────────────────────────
 *
 * Un PDF digital NUNCA se degrada a imagen. `esEscaneado()` sólo es cierto
 * cuando el documento no llega a un mínimo de caracteres por página, y sólo
 * entonces tiene sentido rasterizar y pedirle ayuda a la IA. Rasterizar un PDF
 * que ya trae su texto es cambiar un dato exacto por una lectura aproximada.
 */

import * as mupdf from "mupdf";
import { caracteres, type DocumentoTexto, type LineaTexto, type PaginaTexto, type Palabra } from "../domain/documento/tipos.ts";

/** Por encima de esto no se intenta: un PDF así no es una factura. */
export const MAX_PAGINAS_POR_DEFECTO = 60;
export const MAX_BYTES_POR_DEFECTO = 15 * 1024 * 1024;

/** Menos caracteres por página que esto y se considera escaneado. */
export const MIN_CHARS_PAGINA_POR_DEFECTO = 40;

/**
 * Dos caracteres pertenecen a la misma palabra si el hueco entre ellos es
 * menor que esta fracción del tamaño de fuente.
 *
 * No vale con partir por el carácter espacio: hay plantillas que colocan las
 * celdas sin escribir ningún espacio entre ellas, y entonces «27,90» y «1,00»
 * llegarían pegados. Y al revés, una fuente ancha puede dejar huecos dentro de
 * una palabra. El hueco relativo al cuerpo de letra distingue los dos casos.
 */
const HUECO_PALABRA = 0.28;

/** Dos palabras están en la misma fila si sus líneas base casi coinciden. */
const TOLERANCIA_FILA = 3;

export class DocumentoIlegible extends Error {}

type CharPos = { c: string; x: number; y: number; ancho: number; alto: number; tamano: number };

/**
 * Junta los caracteres de UNA fila, ya ordenados por `x`, en palabras.
 *
 * No vale con partir por el carácter espacio: hay plantillas que colocan las
 * celdas sin escribir ninguno, y entonces «77,50» y «27,90» llegarían pegados.
 * Y al revés, una fuente ancha deja huecos dentro de una palabra. El hueco
 * medido en fracción del cuerpo de letra distingue los dos casos.
 */
function palabrasDeLaFila(chars: CharPos[]): Palabra[] {
  const palabras: Palabra[] = [];
  let actual: CharPos[] = [];

  const cerrar = () => {
    if (actual.length === 0) return;
    const texto = actual.map((c) => c.c).join("").trim();
    if (texto) {
      const x = Math.min(...actual.map((c) => c.x));
      const derecha = Math.max(...actual.map((c) => c.x + c.ancho));
      const y = Math.min(...actual.map((c) => c.y));
      const alto = Math.max(...actual.map((c) => c.alto));
      palabras.push({ texto, x, y, w: derecha - x, h: alto });
    }
    actual = [];
  };

  for (const c of chars) {
    if (!c.c.trim()) {
      cerrar();
      continue;
    }
    const anterior = actual[actual.length - 1];
    if (anterior) {
      const hueco = c.x - (anterior.x + anterior.ancho);
      if (hueco > Math.max(1, c.tamano * HUECO_PALABRA)) cerrar();
    }
    actual.push(c);
  }
  cerrar();
  return palabras;
}

/**
 * Agrupa los caracteres de una página en filas y cada fila en palabras.
 *
 * El orden importa y costó un rato: mupdf entrega los caracteres en el ORDEN EN
 * QUE SE DIBUJARON, no en orden de lectura. Una plantilla puede pintar primero
 * la columna de la izquierda de todas las filas y luego la de la derecha, así
 * que agrupar por proximidad sin ordenar antes pega el final de una fila con el
 * principio de otra: «0501234» y «Ref» acaban siendo la misma palabra. Primero
 * se reparten por altura, luego se ordena cada fila por `x`, y sólo entonces se
 * forman las palabras.
 */
function filasDe(chars: CharPos[], pagina: number, tamanoPorDefecto: number): LineaTexto[] {
  const ordenados = [...chars].sort((a, b) => a.y - b.y || a.x - b.x);

  const grupos: CharPos[][] = [];
  let referencia: number | null = null;
  for (const c of ordenados) {
    if (referencia === null || Math.abs(c.y - referencia) > TOLERANCIA_FILA) {
      grupos.push([c]);
      referencia = c.y;
      continue;
    }
    grupos[grupos.length - 1].push(c);
  }

  const filas: LineaTexto[] = [];
  for (const g of grupos) {
    const palabras = palabrasDeLaFila([...g].sort((a, b) => a.x - b.x));
    if (palabras.length === 0) continue;
    const x = Math.min(...palabras.map((p) => p.x));
    const derecha = Math.max(...palabras.map((p) => p.x + p.w));
    const y = Math.min(...palabras.map((p) => p.y));
    const h = Math.max(...palabras.map((p) => p.h));
    filas.push({
      pagina,
      x,
      y,
      w: derecha - x,
      h,
      tamano: h || tamanoPorDefecto,
      texto: palabras.map((p) => p.texto).join(" "),
      palabras,
    });
  }
  return filas;
}

export type OpcionesLectura = {
  maxPaginas?: number;
  maxBytes?: number;
};

/**
 * Lee el PDF. Lanza `DocumentoIlegible` con un mensaje para la pantalla si no
 * se puede abrir o se pasa de los topes.
 */
export function leerDocumento(buffer: Buffer, opciones: OpcionesLectura = {}): DocumentoTexto {
  const maxPaginas = opciones.maxPaginas ?? MAX_PAGINAS_POR_DEFECTO;
  const maxBytes = opciones.maxBytes ?? MAX_BYTES_POR_DEFECTO;

  if (buffer.length === 0) throw new DocumentoIlegible("El documento está vacío.");
  if (buffer.length > maxBytes) {
    throw new DocumentoIlegible(
      `El documento pesa ${Math.round(buffer.length / 1024 / 1024)} MB y el máximo son ${Math.round(maxBytes / 1024 / 1024)} MB.`
    );
  }

  let doc: mupdf.Document;
  try {
    doc = mupdf.Document.openDocument(buffer, "application/pdf");
  } catch {
    throw new DocumentoIlegible("El documento no se puede abrir: no parece un PDF válido.");
  }

  let total: number;
  try {
    total = doc.countPages();
  } catch {
    throw new DocumentoIlegible("El documento está dañado y no se puede recorrer.");
  }
  if (total > maxPaginas) {
    throw new DocumentoIlegible(`El documento tiene ${total} páginas y el máximo son ${maxPaginas}.`);
  }

  const paginas: PaginaTexto[] = [];
  for (let i = 0; i < total; i++) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const chars: CharPos[] = [];

    page.toStructuredText("preserve-whitespace").walk({
      /*
       * El quad son las cuatro esquinas seguidas —arriba-izquierda,
       * arriba-derecha, abajo-izquierda, abajo-derecha—, no un objeto con
       * nombres. Tomar el mínimo y el máximo de cada eje da la caja aunque el
       * texto venga rotado, que es lo único que hace falta aquí.
       */
      onChar(c, origin, _font, size, quad) {
        const xs = [quad[0], quad[2], quad[4], quad[6]];
        const ys = [quad[1], quad[3], quad[5], quad[7]];
        const izquierda = Math.min(...xs);
        const derecha = Math.max(...xs);
        const arriba = Math.min(...ys);
        const abajo = Math.max(...ys);
        chars.push({
          c,
          x: Number.isFinite(izquierda) ? izquierda : origin[0],
          y: Number.isFinite(arriba) ? arriba : origin[1],
          ancho: Math.max(0, derecha - izquierda),
          alto: Math.max(0, abajo - arriba),
          tamano: size || 9,
        });
      },
    });

    paginas.push({
      numero: i + 1,
      ancho: x1 - x0,
      alto: y1 - y0,
      lineas: filasDe(chars, i + 1, 9),
    });
  }

  return { paginas };
}

/**
 * ¿Es un escaneado? Sólo entonces se rasteriza y se pide ayuda a la visión.
 *
 * Se mira el TOTAL entre el número de páginas y no página a página: una
 * factura de tres páginas con la última casi en blanco sigue siendo digital.
 */
export function esEscaneado(doc: DocumentoTexto, minCharsPagina = MIN_CHARS_PAGINA_POR_DEFECTO): boolean {
  if (doc.paginas.length === 0) return true;
  return caracteres(doc) / doc.paginas.length < minCharsPagina;
}
