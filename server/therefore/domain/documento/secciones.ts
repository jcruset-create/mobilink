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
  abrePieDeDocumento,
  cierraSeccion,
  esArrastre,
  esCabeceraDeTotales,
  type VocabularioConceptos,
} from "./conceptos.ts";
import {
  SINONIMOS_COLUMNA_POR_DEFECTO,
  titulosEnLaFila,
  type SinonimosColumna,
} from "./tabla.ts";
import { cajaDe, sinFechas, type Caja, type DocumentoTexto, type LineaTexto } from "./tipos.ts";

/**
 * Sinónimos de «albarán». Configurable: `albaran.cabeceras`.
 *
 * Se comparan contra el texto YA NORMALIZADO —sin acentos—, así que van sin
 * ellos. «albara» es el catalán «albarà», que es como factura media Tarragona.
 */
export const CABECERAS_ALBARAN_POR_DEFECTO = [
  "albaran",
  "albara",
  "alb.",
  "alb:",
  "no albaran",
  "n. albaran",
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
const IDENTIFICADOR =
  /[A-Z0-9]{0,8}[-/]?\d{2,}(?:[-/.\s]\d+)+|[A-Z0-9]{0,8}[-/]?\d{3,}/;

/** Un número con dos decimales: lo que distingue una fila de tabla. */
const CON_DECIMALES = /\d[.,]\d{2}/;

/** «REF: D000004711», «Nuestro pedido: 4711 de fecha …»: etiqueta y valor. */
const ETIQUETA_CORTA = /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .º/]{1,24}:\s*\S+/i;

/** Cuántas filas de «etiqueta: valor» por encima de la marca son suyas. */
const MAX_ETIQUETAS_ANTES = 2;

/**
 * Longitud a partir de la cual un texto idéntico en dos páginas es plantilla.
 *
 * Alta a propósito. Una FILA DE DATOS puede repetirse palabra por palabra en
 * varias páginas —«Nuestro pedido: 1021294542 de fecha 07.09.2026» encabeza
 * los cuatro albaranes de la misma factura— y borrarla se lleva por delante
 * información del albarán. Un párrafo legal de cien caracteres no es una fila
 * de datos de nadie. Dejar un pie de página sin retirar cuesta una nota de
 * más; retirar una fila de datos cuesta un dato que ya no está.
 */
const LARGO_PLANTILLA = 100;

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
  /** Sinónimos de columna; se usan sólo para reconocer una cabecera de tabla. */
  columnas?: SinonimosColumna;
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
  esCabeceraDeTabla: (l: LineaTexto) => boolean
): { paginas: DocumentoTexto; retiradas: number } {
  if (doc.paginas.length < 2) return { paginas: doc, retiradas: 0 };

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
      if (b.pagina === a.pagina) continue;
      const identicas = clave(a.linea.texto) === clave(b.linea.texto);
      const mismaForma = forma(a.linea.texto) === forma(b.linea.texto);
      const misma = mismaPosicion(a.linea, b.linea);
      /*
       * Cuatro maneras de ser plantilla, y sólo las dos primeras exigen que la
       * línea caiga en el mismo sitio en las dos páginas. Las otras dos son
       * para las plantillas que no ponen el pie al pie: lo imprimen debajo del
       * contenido, y entonces cada página lo tiene a una altura distinta. Un
       * párrafo largo, idéntico y sin importes es plantilla; una fila de
       * artículo repetida lleva los suyos y no entra. Y «Página 1 de 2» se
       * reconoce por la palabra, vaya donde vaya y en la línea que sea.
       */
      const sinImportes = !CON_DECIMALES.test(sinFechas(a.linea.texto));
      const largas = sinImportes && clave(a.linea.texto).length >= LARGO_PLANTILLA;
      const paginacion = sinImportes && /\bpag(?:ina|\.)?\b/.test(clave(a.linea.texto));
      const esPlantilla =
        (misma && identicas) ||
        (misma && mismaForma && a.enBorde && b.enBorde) ||
        (identicas && largas) ||
        (mismaForma && paginacion);
      if (esPlantilla) iguales.push(b);
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
 * Dónde empieza la cabecera dentro del texto, si empieza por palabra entera.
 *
 * «alb.» dentro de «calb.» no es una cabecera. Sólo se mira el lado
 * izquierdo: por la derecha la cabecera puede continuar («albaranes») y eso
 * sí es un albarán.
 */
function posicionEntera(texto: string, cabecera: string): number {
  /*
   * Por la derecha sólo se mira cuando la cabecera acaba en signo. «albaran»
   * puede seguir («albaranes») y sigue siendo lo mismo; «alb.» seguido de
   * letra es otra palabra —«ALB.ABON» es el albarán que se abona, no el de
   * esta línea—, y tomarla por una marca parte la factura por donde no es.
   */
  const cierra = !/[a-z0-9]/i.test(cabecera[cabecera.length - 1]);
  let desde = 0;
  for (;;) {
    const pos = texto.indexOf(cabecera, desde);
    if (pos < 0) return -1;
    const izquierda = pos === 0 || !/[a-z0-9]/i.test(texto[pos - 1]);
    const derecha = !cierra || !/[a-z]/i.test(texto[pos + cabecera.length] ?? "");
    if (izquierda && derecha) return pos;
    desde = pos + 1;
  }
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
    const pos = posicionEntera(minus, c.toLowerCase());
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
function esPieDeFactura(
  linea: LineaTexto,
  conceptos: VocabularioConceptos,
  esCabeceraDeTabla: (l: LineaTexto) => boolean
): boolean {
  const t = normalizar(linea.texto);
  // «Suma y sigue» no es el pie: el albarán continúa en la página siguiente.
  if (esArrastre(t, conceptos)) return false;
  // La fila de títulos del pie («Base imponible  IVA  Total»), con los
  // importes debajo. Una cabecera de tabla no lo es aunque lleve «Total».
  if (esCabeceraDeTotales(t, conceptos) && !esCabeceraDeTabla(linea)) return true;
  // Y el bloque de pago, que va detrás de las líneas de todas todas.
  if (abrePieDeDocumento(t, conceptos)) return true;
  const sinImporte = t.replace(/[-−+]?[\d.,]+\s*[-−]?\s*(?:€|EUR)?\s*$/i, "").trim();
  /*
   * Sólo un total DEL DOCUMENTO cierra. El «Total» que remata el bloque de un
   * artículo no: detrás vienen los demás artículos de la factura.
   */
  if (!cierraSeccion(sinImporte, conceptos)) return false;
  if (/\d{6,}/.test(sinImporte)) return false;
  const numeros = t.match(/\d[\d.,]*/g) ?? [];
  return numeros.length <= 2;
}

/**
 * Descarta las marcas que no abren ningún albarán.
 *
 * Dentro del bloque de un albarán hay líneas que NOMBRAN otro documento:
 * una fila «ALB: … fecha» debajo de un artículo es el albarán del cliente al
 * que se refiere el trabajo, «ALB.ABON …» el que se abona. Llevan la misma
 * palabra que la marca de verdad y engañan a `numeroDeLaMarca`, y lo que
 * cuestan es caro: la sección del albarán bueno se corta ahí, y todo lo que
 * venía detrás —las notas del montaje, el cliente, la posición de la rueda—
 * sale como si fuera de otro albarán. Es justo lo que se ve al subrayar: el
 * bloque amarillo se queda a medias.
 *
 * Lo que las delata es que detrás no traen NINGÚN IMPORTE. Una factura no
 * cobra un albarán sin una sola línea con precio, así que una marca a la que
 * no sigue ni un número con decimales antes de la marca siguiente no abre
 * nada: es una referencia escrita dentro del albarán que la contiene, y sus
 * líneas son suyas.
 *
 * Sólo se aplica **con dos marcas o más**. Con una sola no hay nada que
 * repartir mal, y descartarla dejaría el documento sin número —perder el
 * número de un albarán que sí está impreso es peor que leerle una nota de
 * más—. Y si la regla se llevara todas por delante, no se aplica: un
 * documento sin marcas se lee entero, y eso no es lo que pasa aquí.
 */
function marcasConImporte(marcas: MarcaAlbaran[], lineas: LineaTexto[]): MarcaAlbaran[] {
  if (marcas.length < 2) return marcas;
  const conImporte = marcas.filter((marca, m) => {
    const tope = m + 1 < marcas.length ? marcas[m + 1].indice : lineas.length;
    for (let i = marca.indice; i < tope; i++) {
      if (CON_DECIMALES.test(sinFechas(lineas[i].texto))) return true;
    }
    return false;
  });
  return conImporte.length > 0 ? conImporte : marcas;
}

/**
 * Localiza y delimita todos los albaranes del documento.
 *
 * `columnas` sólo se usa para reconocer las cabeceras de tabla —para no
 * retirarlas y para no confundirlas con el pie—; aquí no se extrae ninguna
 * celda.
 */
export function localizarAlbaranes(
  doc: DocumentoTexto,
  opciones: OpcionesSecciones = {}
): Localizacion {
  const cabeceras = opciones.cabeceras ?? CABECERAS_ALBARAN_POR_DEFECTO;
  const conceptos = opciones.conceptos ?? VOCABULARIO_CONCEPTOS;
  const columnas = opciones.columnas ?? SINONIMOS_COLUMNA_POR_DEFECTO;

  /*
   * Se cuentan TIPOS de columna distintos, no palabras reconocidas. El pie de
   * una factura —«Importe neto … IVA … Total»— usa tres palabras que son
   * todas sinónimo de «importe»: contando palabras parecía una cabecera de
   * tabla y dejaba de cerrar la sección.
   */
  const esCabeceraDeTabla = (l: LineaTexto): boolean => titulosEnLaFila(l, columnas) >= 3;

  const { paginas: limpio, retiradas } = retirarRepetidas(doc, esCabeceraDeTabla);

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

  const reales = marcasConImporte(marcas, lineas);

  if (reales.length === 0) {
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

  /*
   * Las etiquetas de justo encima de la marca («REF: D000004711», «Nuestro
   * pedido: 4711 de fecha …») son las primeras líneas del albarán, no las
   * últimas del anterior: hay plantillas que abren el bloque con dos o tres
   * filas de datos y ponen el número del albarán en la segunda. Se admiten
   * hasta dos, en la misma página, sin importes y con forma de «etiqueta:
   * valor» —una fila de artículo nunca lo tiene—.
   *
   * Y tienen que estar PEGADAS A LA MARCA: más cerca de ella que de la fila
   * que llevan encima. El albarán anterior también acaba en filas con esa
   * forma —«CLIENTE: …», «POS: DELANTERA IZQ» son notas del montaje—, y ésas
   * van pegadas a las suyas, con el blanco que separa los dos bloques por
   * debajo. Sin esta comprobación las últimas notas de cada albarán salían
   * como primeras líneas del siguiente.
   */
  const inicio = reales.map((marca, m) => {
    let i = marca.indice;
    for (let n = 0; n < MAX_ETIQUETAS_ANTES; n++) {
      const j = i - 1;
      if (j < 0) break;
      const previa = lineas[j];
      if (previa.pagina !== marca.pagina) break;
      if (m > 0 && reales[m - 1].indice >= j) break;
      const t = normalizar(previa.texto).trim();
      if (CON_DECIMALES.test(sinFechas(t)) || !ETIQUETA_CORTA.test(t)) break;
      if (numeroDeLaMarca(previa, [], cabeceras)) break;
      // Sin nada encima —o con la página cortada— no hay con qué compararla.
      const encima = j > 0 && lineas[j - 1].pagina === previa.pagina ? lineas[j - 1] : null;
      if (encima && previa.y - encima.y < Math.abs(lineas[i].y - previa.y)) break;
      i = j;
    }
    return i;
  });

  const secciones: SeccionAlbaran[] = [];
  for (let m = 0; m < reales.length; m++) {
    const desde = inicio[m];
    const tope = m + 1 < reales.length ? inicio[m + 1] : lineas.length;

    let hasta = tope;
    let finPor: FinDeSeccion = m + 1 < reales.length ? "SIGUIENTE_MARCA" : "FIN_DOCUMENTO";
    for (let i = reales[m].indice + 1; i < tope; i++) {
      if (esPieDeFactura(lineas[i], conceptos, esCabeceraDeTabla)) {
        hasta = i;
        finPor = "TOTALES";
        break;
      }
    }

    const suyas = lineas.slice(desde, hasta);
    secciones.push({
      indice: m,
      numeroDocumento: reales[m].numeroRaw,
      lineas: suyas,
      paginaInicio: suyas[0].pagina,
      paginaFin: suyas[suyas.length - 1].pagina,
      cajaInicio: reales[m].caja,
      finPor,
      documentoEntero: false,
      vecinaAnterior: m > 0 ? reales[m - 1].numeroRaw : null,
      vecinaSiguiente: m + 1 < reales.length ? reales[m + 1].numeroRaw : null,
      /*
       * Lo que quedó entre el corte por totales y la MARCA SIGUIENTE.
       *
       * Sólo cuenta si hay marca siguiente. Detrás del último albarán está el
       * pie de la factura —base imponible, IVA, total—, que no es de nadie por
       * definición; contarlo como huérfano pondría en revisión todos los
       * documentos bien formados, que es la manera más rápida de que nadie
       * mire las revisiones.
       */
      huerfanas: m + 1 < reales.length ? tope - hasta : 0,
    });
  }

  return {
    secciones,
    cabeceraDocumento: lineas.slice(0, inicio[0]),
    lineasRepetidasRetiradas: retiradas,
  };
}
