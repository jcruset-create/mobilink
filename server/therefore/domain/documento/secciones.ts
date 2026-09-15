/**
 * Encontrar los albaranes dentro de una factura y saber dónde acaba cada uno.
 *
 * Es el paso del que dependen todos los demás. Si la sección está mal
 * delimitada, las líneas que se extraigan serán correctas una por una y la
 * suma será la de otro albarán; y un total que cuadra con el albarán
 * equivocado es peor que no tener total, porque nadie lo mira dos veces.
 *
 * ── Tres cosas que hacen esto difícil de verdad ─────────────────────────────
 *
 * · UNA FACTURA TRAE VARIOS ALBARANES, uno detrás de otro, a veces sin una
 *   línea en blanco entre ellos. El final de uno es el principio del
 *   siguiente, así que «buscar el siguiente albarán» no es una comprobación
 *   auxiliar: es la única forma de cerrar el anterior.
 *
 * · UN ALBARÁN SE PARTE ENTRE DOS PÁGINAS, y entre sus dos mitades hay un pie
 *   de página, un logotipo y una cabecera. Si se leen las páginas por separado
 *   salen dos medios albaranes; si se concatenan sin quitar eso, la basura
 *   entra como si fueran líneas. Por eso lo primero que se hace es RETIRAR lo
 *   que se repite igual en el mismo sitio en varias páginas.
 *
 * · EL PIE DE LA FACTURA (base imponible, IVA, total) no pertenece a ningún
 *   albarán, y aparece justo detrás del último. Cierra la sección.
 *
 * ── Lo que NO se hace ───────────────────────────────────────────────────────
 *
 * No se adivina. Un documento sin ninguna marca de albarán no se reparte «a
 * ojo» en trozos: se trata como una sección única de documento entero, y esa
 * sección nunca puede dar MATCH —como mucho UNCERTAIN—, porque nadie ha leído
 * el número en ningún sitio. Inventar la separación es lo que produce el fallo
 * caro: líneas de un albarán cobradas en otro.
 */

import { normalizar } from "../correo/texto.ts";
import {
  VOCABULARIO_CONCEPTOS,
  totalDocumento,
  type VocabularioConceptos,
} from "./conceptos.ts";
import { cajaDe, type Caja, type DocumentoTexto, type LineaTexto } from "./tipos.ts";

/** Sinónimos de «albarán». Configurable: `albaran.cabeceras`. */
export const CABECERAS_ALBARAN_POR_DEFECTO = [
  "albarán",
  "albaran",
  "alb.",
  "nº albarán",
  "n. albarán",
  "delivery note",
  "entrega",
  "ENT-",
] as const;

/**
 * El patrón de un identificador de documento.
 *
 * Deliberadamente genérico (§48): hasta cuatro letras de prefijo, un separador
 * opcional, y al menos tres dígitos, con más grupos detrás. Cubre `0501234`,
 * `ENT-770199-0501234` y `ALB 2024 001` sin conocer a ningún proveedor.
 */
const IDENTIFICADOR = /[A-Z]{0,4}[-\s]?\d{3,}(?:[-\s]\d+)*/;

/** Tolerancia al comparar posiciones entre páginas, en puntos. */
const TOLERANCIA_PT = 2;

/** Franja de página donde vive una cabecera o un pie, en tanto por uno. */
const BANDA_BORDE = 0.12;

export type MarcaAlbaran = {
  /** Índice dentro de la secuencia aplanada. */
  indice: number;
  /** Tal y como está impreso: `ENT-770199-0501234`. */
  numeroRaw: string;
  pagina: number;
  caja: Caja;
};

export type FinDeSeccion = "SIGUIENTE_MARCA" | "TOTALES" | "FIN_DOCUMENTO";

export type SeccionAlbaran = {
  indice: number;
  /** `null` sólo en la sección «documento entero». */
  numeroDocumento: string | null;
  lineas: LineaTexto[];
  paginaInicio: number;
  paginaFin: number;
  /** Dónde está escrito el número, para el resalte del visor. */
  cajaInicio: Caja | null;
  finPor: FinDeSeccion;
  /** No había ninguna marca en el documento. */
  documentoEntero: boolean;
  /** Números de las secciones de al lado. Los usa la validación de separación. */
  vecinaAnterior: string | null;
  vecinaSiguiente: string | null;
  /**
   * Líneas que quedaron entre el final de esta sección y la marca siguiente.
   *
   * Con una separación limpia son cero. Que no lo sean significa que algo se
   * leyó y no se le encontró dueño, y eso es exactamente lo que hay que
   * enseñar en vez de repartirlo al azar.
   */
  huerfanas: number;
};

export type Localizacion = {
  secciones: SeccionAlbaran[];
  /** Lo anterior a la primera marca: la cabecera de la factura. */
  cabeceraDocumento: LineaTexto[];
  /** Cuántas líneas se retiraron por repetirse en varias páginas. */
  lineasRepetidasRetiradas: number;
};

export type OpcionesSecciones = {
  cabeceras?: readonly string[];
  conceptos?: VocabularioConceptos;
  /** Sinónimos de columna; se usan sólo para no borrar una cabecera de tabla. */
  sinonimosColumna?: readonly string[];
};

function clave(texto: string): string {
  return normalizar(texto).toLowerCase().replace(/\s+/g, " ").trim();
}

/** El mismo texto con los dígitos borrados: «Página 1 de 2» y «Página 2 de 2». */
function forma(texto: string): string {
  return clave(texto).replace(/\d+/g, "#");
}

function mismaPosicion(a: LineaTexto, b: LineaTexto): boolean {
  return Math.abs(a.x - b.x) <= TOLERANCIA_PT && Math.abs(a.y - b.y) <= TOLERANCIA_PT;
}

/**
 * Quita cabeceras y pies repetidos.
 *
 * Dos reglas, y las dos exigen que la línea aparezca en DOS PÁGINAS DISTINTAS
 * en la misma posición:
 *
 * 1. Texto idéntico, esté donde esté en la página. Logotipos, direcciones
 *    fiscales, «Documento sin valor contable».
 * 2. Mismo texto salvo los dígitos, y sólo si está pegada al borde superior o
 *    inferior. Es lo que atrapa «Página 1 de 2», que nunca es idéntica a
 *    «Página 2 de 2». Se restringe a los bordes porque en el cuerpo de la
 *    página esa regla se llevaría por delante filas de artículo parecidas.
 *
 * Con una excepción que no es cosmética: **nunca se retira una cabecera de
 * columnas**. Cuando una tabla continúa en la página siguiente, sus títulos se
 * repiten en la misma posición y encajan en la regla 1; borrarlos dejaría a la
 * segunda mitad de la tabla sin rejilla y sus celdas se asignarían a ojo.
 */
function retirarRepetidas(
  doc: DocumentoTexto,
  sinonimosColumna: readonly string[]
): { paginas: DocumentoTexto; retiradas: number } {
  if (doc.paginas.length < 2) return { paginas: doc, retiradas: 0 };

  const esCabeceraDeTabla = (l: LineaTexto): boolean => {
    const t = clave(l.texto);
    let n = 0;
    for (const s of sinonimosColumna) if (t.includes(s)) n++;
    return n >= 3;
  };

  type Candidata = { linea: LineaTexto; pagina: number; enBorde: boolean };
  const todas: Candidata[] = [];
  for (const p of doc.paginas) {
    for (const l of p.lineas) {
      const enBorde = l.y <= p.alto * BANDA_BORDE || l.y >= p.alto * (1 - BANDA_BORDE);
      todas.push({ linea: l, pagina: p.numero, enBorde });
    }
  }

  const aRetirar = new Set<LineaTexto>();
  for (let i = 0; i < todas.length; i++) {
    const a = todas[i];
    if (aRetirar.has(a.linea) || esCabeceraDeTabla(a.linea)) continue;
    const iguales: Candidata[] = [a];
    for (let j = i + 1; j < todas.length; j++) {
      const b = todas[j];
      if (b.pagina === a.pagina || !mismaPosicion(a.linea, b.linea)) continue;
      const identicas = clave(a.linea.texto) === clave(b.linea.texto);
      const mismaForma = a.enBorde && b.enBorde && forma(a.linea.texto) === forma(b.linea.texto);
      if (identicas || mismaForma) iguales.push(b);
    }
    if (iguales.length >= 2 && !iguales.some((c) => esCabeceraDeTabla(c.linea))) {
      for (const c of iguales) aRetirar.add(c.linea);
    }
  }

  return {
    paginas: {
      paginas: doc.paginas.map((p) => ({ ...p, lineas: p.lineas.filter((l) => !aRetirar.has(l)) })),
    },
    retiradas: aRetirar.size,
  };
}

/**
 * ¿Esta línea abre un albarán? Devuelve el número tal y como está impreso.
 *
 * El número puede estar en la misma línea que la palabra o justo al lado, como
 * un trozo de texto independiente a la misma altura: en un PDF, «Albarán:» y
 * «0501234» a menudo son dos cadenas distintas porque van en columnas
 * distintas de la plantilla.
 */
function numeroDeLaMarca(
  linea: LineaTexto,
  banda: LineaTexto[],
  cabeceras: readonly string[]
): string | null {
  const t = normalizar(linea.texto);
  const minus = t.toLowerCase();

  let mejorPos = -1;
  let fin = -1;
  for (const c of cabeceras) {
    const pos = minus.indexOf(c.toLowerCase());
    if (pos < 0) continue;
    // Gana la cabecera que aparece antes: «Nº albarán» delante de «albarán».
    if (mejorPos < 0 || pos < mejorPos) {
      mejorPos = pos;
      fin = pos + c.length;
    }
  }
  if (mejorPos < 0) return null;

  // Desde la propia cabecera, para que un prefijo como «ENT-» entre en el
  // número; si ahí no hay nada, desde justo detrás de ella.
  const desdeLaMarca = t.slice(mejorPos).match(IDENTIFICADOR);
  if (desdeLaMarca && desdeLaMarca[0].replace(/\D/g, "").length >= 3) {
    return desdeLaMarca[0].trim();
  }
  const detras = t.slice(fin).match(IDENTIFICADOR);
  if (detras && detras[0].replace(/\D/g, "").length >= 3) return detras[0].trim();

  // En la misma banda horizontal, a la derecha: la celda de al lado.
  for (const otra of banda) {
    if (otra === linea || otra.x < linea.x) continue;
    const m = normalizar(otra.texto).match(IDENTIFICADOR);
    if (m && m[0].replace(/\D/g, "").length >= 3) return m[0].trim();
  }
  return null;
}

/**
 * ¿Es el pie de la factura?
 *
 * Una etiqueta de total y un importe, y nada más: ni referencia ni cantidad.
 * Esa es la diferencia con un artículo que se llamara «Total» —que los hay—,
 * y por eso se exige que en la línea no haya una tirada larga de dígitos
 * (referencia) ni más de dos números.
 */
function esPieDeFactura(linea: LineaTexto, conceptos: VocabularioConceptos): boolean {
  const t = normalizar(linea.texto);
  const sinImporte = t.replace(/[-−+]?[\d.,]+\s*(?:€|EUR)?\s*$/i, "").trim();
  if (!totalDocumento(sinImporte, conceptos)) return false;
  if (/\d{6,}/.test(sinImporte)) return false;
  const numeros = t.match(/\d[\d.,]*/g) ?? [];
  return numeros.length <= 2;
}

/**
 * Localiza y delimita todos los albaranes del documento.
 *
 * `sinonimosColumna` sólo se usa para proteger las cabeceras de tabla al
 * retirar lo repetido; esta función no extrae ninguna celda.
 */
export function localizarAlbaranes(
  doc: DocumentoTexto,
  opciones: OpcionesSecciones = {}
): Localizacion {
  const cabeceras = opciones.cabeceras ?? CABECERAS_ALBARAN_POR_DEFECTO;
  const conceptos = opciones.conceptos ?? VOCABULARIO_CONCEPTOS;
  const sinonimosColumna = opciones.sinonimosColumna ?? [];

  const { paginas: limpio, retiradas } = retirarRepetidas(doc, sinonimosColumna);

  const lineas: LineaTexto[] = [];
  for (const p of [...limpio.paginas].sort((a, b) => a.numero - b.numero)) {
    lineas.push(...[...p.lineas].sort((a, b) => a.y - b.y || a.x - b.x));
  }

  // Las marcas, en orden de lectura.
  const marcas: MarcaAlbaran[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    const banda = lineas.filter(
      (o) => o.pagina === l.pagina && Math.abs(o.y - l.y) <= Math.max(l.h, o.h, TOLERANCIA_PT)
    );
    const numero = numeroDeLaMarca(l, banda, cabeceras);
    if (!numero) continue;
    // Dos marcas en la misma banda con el mismo número son la misma marca.
    const anterior = marcas[marcas.length - 1];
    if (anterior && anterior.pagina === l.pagina && anterior.numeroRaw === numero) continue;
    marcas.push({ indice: i, numeroRaw: numero, pagina: l.pagina, caja: cajaDe(l) });
  }

  if (marcas.length === 0) {
    // Sin ninguna marca: una sección de documento entero. No podrá dar MATCH.
    const usadas = lineas;
    return {
      secciones:
        usadas.length === 0
          ? []
          : [
              {
                indice: 0,
                numeroDocumento: null,
                lineas: usadas,
                paginaInicio: usadas[0].pagina,
                paginaFin: usadas[usadas.length - 1].pagina,
                cajaInicio: null,
                finPor: "FIN_DOCUMENTO",
                documentoEntero: true,
                vecinaAnterior: null,
                vecinaSiguiente: null,
                huerfanas: 0,
              },
            ],
      cabeceraDocumento: [],
      lineasRepetidasRetiradas: retiradas,
    };
  }

  const secciones: SeccionAlbaran[] = [];
  for (let m = 0; m < marcas.length; m++) {
    const desde = marcas[m].indice;
    const tope = m + 1 < marcas.length ? marcas[m + 1].indice : lineas.length;

    let hasta = tope;
    let finPor: FinDeSeccion = m + 1 < marcas.length ? "SIGUIENTE_MARCA" : "FIN_DOCUMENTO";
    for (let i = desde + 1; i < tope; i++) {
      if (esPieDeFactura(lineas[i], conceptos)) {
        hasta = i;
        finPor = "TOTALES";
        break;
      }
    }

    const suyas = lineas.slice(desde, hasta);
    secciones.push({
      indice: m,
      numeroDocumento: marcas[m].numeroRaw,
      lineas: suyas,
      paginaInicio: suyas[0].pagina,
      paginaFin: suyas[suyas.length - 1].pagina,
      cajaInicio: marcas[m].caja,
      finPor,
      documentoEntero: false,
      vecinaAnterior: m > 0 ? marcas[m - 1].numeroRaw : null,
      vecinaSiguiente: m + 1 < marcas.length ? marcas[m + 1].numeroRaw : null,
      /*
       * Lo que quedó entre el corte por totales y la MARCA SIGUIENTE.
       *
       * Sólo cuenta si hay marca siguiente. Detrás del último albarán está el
       * pie de la factura —base imponible, IVA, total—, que no es de nadie por
       * definición; contarlo como huérfano pondría en revisión todos los
       * documentos bien formados, que es la manera más rápida de que nadie
       * mire las revisiones.
       */
      huerfanas: m + 1 < marcas.length ? tope - hasta : 0,
    });
  }

  return {
    secciones,
    cabeceraDocumento: lineas.slice(0, marcas[0].indice),
    lineasRepetidasRetiradas: retiradas,
  };
}
