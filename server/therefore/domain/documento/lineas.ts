/**
 * Las líneas de artículo de un albarán, con lo que se sabe y lo que no.
 *
 * ── La comprobación que sostiene todo lo demás ──────────────────────────────
 *
 * `cantidad × precio × (1−d₁) × (1−d₂)` tiene que dar el importe. Cuando da,
 * los cinco números se corroboran entre sí y se pueden dar por buenos; cuando
 * no da, alguno está mal leído y NINGUNO merece confianza, aunque cuatro de
 * ellos parezcan perfectos. Es la salvaguarda contra el fallo que de otro modo
 * no se ve: un `77,50` leído como `77,56` no rompe nada, no lanza ningún error
 * y se convierte en un número contable equivocado.
 *
 * Por eso la aritmética no es una validación más al final: es lo que decide la
 * confianza de cada celda de la fila.
 *
 * ── Lo que no es una línea ──────────────────────────────────────────────────
 *
 * «Portes 12,50» tiene la forma de una línea y no lo es. Si entrara, la suma
 * del albarán dejaría de ser la suma del albarán y el descuadre contra la
 * incidencia —lo que hay que detectar— quedaría explicado por accidente. Se
 * aparta a `conceptos`, se enseña aparte y no se suma (§32).
 *
 * ── Y lo que no se corrige ──────────────────────────────────────────────────
 *
 * Una referencia con un `O` donde el resto de la columna lleva ceros es una
 * referencia ILEGIBLE, no una referencia con una errata. El parser la deja en
 * `null` con confianza 0,30 y la manda a revisión. Corregirla sería inventarse
 * un código de artículo, que es de las pocas cosas de este módulo que nadie
 * podría detectar después.
 */

import { leerImporte } from "../correo/importes.ts";
import { normalizar } from "../correo/texto.ts";
import {
  VOCABULARIO_CONCEPTOS,
  conceptoGlobal,
  esArrastre,
  totalDocumento,
  type VocabularioConceptos,
} from "./conceptos.ts";
import { factorRestante, leerDescuentos, type Descuento } from "./descuentos.ts";
import {
  SINONIMOS_COLUMNA_POR_DEFECTO,
  detectarRejilla,
  repartirEnColumnas,
  titulosEnLaFila,
  type Rejilla,
  type SinonimosColumna,
} from "./tabla.ts";
import { cajaEnvolvente, type Caja, type LineaTexto } from "./tipos.ts";

/** Redondeos de céntimo: nada más. */
export const TOLERANCIA_CENTIMOS_POR_DEFECTO = 2;

/** Confianza de una celda cuando la fila cuadra. */
const CONFIANZA_CUADRA = 0.95;
/** Techo cuando no cuadra: algo está mal y no se sabe qué. */
const TECHO_NO_CUADRA = 0.8;
/** Una referencia que no se puede leer. */
const CONFIANZA_REFERENCIA_DUDOSA = 0.3;

export type ConfianzaLinea = {
  referencia: number;
  descripcion: number;
  cantidad: number;
  precio: number;
  importe: number;
  descuentos: number;
};

export type LineaArticulo = {
  numeroLinea: number;
  referencia: string | null;
  descripcion: string | null;
  /** Unidades. Puede llevar decimales (kg, litros). */
  cantidad: number | null;
  precioUnitarioCentimos: number | null;
  importeCentimos: number | null;
  descuentos: Descuento[];
  /** La celda de descuento entera, tal y como estaba impresa. */
  descuentosRaw: string;
  confianza: ConfianzaLinea;
  /**
   * `true` si la aritmética cuadra, `false` si no, `null` si faltan datos para
   * comprobarlo. Los tres casos son distintos y el tercero no es un fallo.
   */
  cuadraAritmetica: boolean | null;
  /** La fila entera tal y como se leyó. Es la trazabilidad de la extracción. */
  rawText: string;
  pagina: number;
  caja: Caja | null;
};

export type ConceptoAdicional = {
  etiqueta: string;
  importeCentimos: number | null;
  raw: string;
  pagina: number;
};

export type ExtraccionLineas = {
  lineas: LineaArticulo[];
  /** Portes, tasas, recargos: cuestan dinero y no son línea. */
  conceptos: ConceptoAdicional[];
  rejilla: Rejilla;
  /** Filas con texto que no se pudieron leer como artículo ni como concepto. */
  descartadas: number;
  /**
   * Filas de texto dentro de la tabla que no son artículo: «SE ANULA
   * PULMÓN», «3er EJE IZQUIERDO», «CASO 4711». Llevan cantidad o un número
   * suelto pero ningún importe. Se guardan como observaciones del albarán:
   * no se suman y no se pierden.
   */
  notas: string[];
};

export type OpcionesLineas = {
  sinonimos?: SinonimosColumna;
  conceptos?: VocabularioConceptos;
  toleranciaCentimos?: number;
  /** Techo de confianza. Lo baja el extractor de IA a 0,85. */
  techoConfianza?: number;
};

/** Un importe al final de la fila: lo que la convierte en candidata. */
const IMPORTE_AL_FINAL = /[-−+]?\d[\d.,]*\s*(?:€|EUR)?\s*$/i;

/** Todos los números del final de la fila: «-2,00 4,00 -8,00», «4 1,80 € 7,20 €». */
const NUMEROS_AL_FINAL = /(?:(?:^|\s+)[-−+]?\d[\d.,]*\s*(?:%|€|EUR)?)+\s*$/i;

/** Sólo los que llevan decimales: la cantidad de una nota («... 1,00»), no su número («CASO 4711»). */
const DECIMALES_AL_FINAL = /(?:(?:^|\s+)[-−+]?\d+[.,]\d{1,3}\s*(?:%|€|EUR)?)+\s*$/i;

/** El texto de una fila sin los números de sus columnas ni el guion de viñeta. */
function textoSinNumeros(texto: string, patron: RegExp = NUMEROS_AL_FINAL): string {
  return texto
    .trim()
    .replace(/^[-–—•·*\s]+/, "")
    .replace(patron, "")
    .trim();
}

/** Cuánto de su columna llena el texto de una fila: 1 es hasta el borde. */
function llenadoDeColumna(fila: LineaTexto, rejilla: Rejilla, tipo: "descripcion"): number | null {
  const col = rejilla.columnas.find((c) => c.tipo === tipo);
  if (!col || !Number.isFinite(col.x1) || fila.palabras.length === 0) return null;
  const dentro = fila.palabras.filter((p) => p.x + p.w / 2 >= col.x0 && p.x + p.w / 2 < col.x1);
  if (dentro.length === 0) return null;
  // La primera columna no tiene borde izquierdo: se toma donde empieza el texto.
  const inicio = Number.isFinite(col.x0) ? col.x0 : Math.min(...dentro.map((p) => p.x));
  const fin = Math.max(...dentro.map((p) => p.x + p.w));
  if (col.x1 <= inicio) return null;
  return (fin - inicio) / (col.x1 - inicio);
}

/** A partir de qué llenado una descripción «se sale» y sigue en la fila de abajo. */
const LLENADO_QUE_DESBORDA = 0.75;

/** Letras que se confunden con dígitos en un escaneo o una fuente estrecha. */
const CONFUNDIBLES = /[OoIilSs]/;

function leerCantidad(celda: string | undefined): { valor: number | null; confianza: number } {
  if (!celda) return { valor: null, confianza: 0 };
  const t = normalizar(celda).replace(/\s+/g, "");
  // Una cantidad no lleva separador de millares en ningún albarán que se haya
  // visto; la coma o el punto que traiga son decimales.
  const m = t.match(/^[-−+]?\d+(?:[.,]\d{1,3})?$/);
  if (!m) return { valor: null, confianza: 0 };
  const negativo = t.startsWith("-") || t.startsWith("−");
  const valor = Number(t.replace(/^[-−+]/, "").replace(",", "."));
  if (!Number.isFinite(valor)) return { valor: null, confianza: 0 };
  return { valor: negativo ? -valor : valor, confianza: 1 };
}

/** ¿La fila sólo tiene texto de concepto y un importe? */
function comoConcepto(
  fila: LineaTexto,
  vocabulario: VocabularioConceptos
): ConceptoAdicional | null {
  // Se compara sobre el texto normalizado y se GUARDA el original: `normalizar`
  // quita los acentos y pone en mayúsculas, que sirve para reconocer y no para
  // enseñar («Tasa de reciclaje» no se guarda como «TASA DE RECICLAJE»).
  const original = fila.texto.trim();
  const sinImporteOriginal = textoSinNumeros(original);
  const paraComparar = normalizar(sinImporteOriginal);
  const etiqueta = conceptoGlobal(paraComparar, vocabulario) ?? totalDocumento(paraComparar, vocabulario);
  if (!etiqueta) return null;
  // Con referencia o con cantidad no es un concepto: es un artículo que se
  // llama así, y los hay.
  if (/\d{6,}/.test(paraComparar)) return null;
  const importe = original.match(IMPORTE_AL_FINAL)?.[0] ?? "";
  return {
    etiqueta: sinImporteOriginal || etiqueta,
    importeCentimos: leerImporte(importe).centimos,
    raw: original,
    pagina: fila.pagina,
  };
}

/** ¿Podría ser una fila de artículo? Texto a la izquierda y un importe al final. */
function pareceArticulo(fila: LineaTexto): boolean {
  const t = normalizar(fila.texto).trim();
  if (!t) return false;
  const m = t.match(IMPORTE_AL_FINAL);
  if (!m) return false;
  const antes = t.slice(0, t.length - m[0].length).trim();
  if (!antes) return false;
  // Al menos un número con dos decimales en la fila: es lo que distingue una
  // fila de tabla de un párrafo que acaba en un número.
  return /\d+[.,]\d{2}(?:\s*(?:€|EUR))?\s*$/i.test(t);
}

/** Una continuación: descripción que salta de línea, sin ningún número. */
function esContinuacion(fila: LineaTexto): boolean {
  const t = normalizar(fila.texto).trim();
  if (!t) return false;
  return !/\d[.,]\d/.test(t) && !/\d{3,}/.test(t) && t.length > 2;
}

/**
 * Extrae las líneas de una sección ya delimitada.
 *
 * `cabeceraPrevia` son las filas anteriores a la sección, por si la tabla
 * tiene sus títulos una sola vez para todo el documento y la sección empieza
 * por debajo de ellos.
 */
export function extraerLineas(
  seccion: LineaTexto[],
  opciones: OpcionesLineas = {},
  cabeceraPrevia: LineaTexto[] = []
): ExtraccionLineas {
  const sinonimos = opciones.sinonimos ?? SINONIMOS_COLUMNA_POR_DEFECTO;
  const vocabulario = opciones.conceptos ?? VOCABULARIO_CONCEPTOS;
  const tolerancia = opciones.toleranciaCentimos ?? TOLERANCIA_CENTIMOS_POR_DEFECTO;
  const techo = opciones.techoConfianza ?? 1;

  let rejilla = detectarRejilla(seccion, sinonimos);
  if (rejilla.modo === "POSICIONAL" && cabeceraPrevia.length > 0) {
    const heredada = detectarRejilla(cabeceraPrevia, sinonimos);
    if (heredada.modo === "CABECERA") rejilla = heredada;
  }

  const lineas: LineaArticulo[] = [];
  const conceptos: ConceptoAdicional[] = [];
  const notas: string[] = [];
  const filasDeCadaLinea: LineaTexto[][] = [];
  // Con rejilla, lo que no es artículo ni concepto es nota; sin rejilla, todo
  // lo que tiene un importe se lee como fila. Ya no queda nada que descartar,
  // pero el contador sigue en el contrato porque se guarda y se enseña.
  const descartadas = 0;
  const hayColumna = (tipo: "referencia" | "descripcion") =>
    rejilla.modo === "CABECERA" && rejilla.columnas.some((c) => c.tipo === tipo);
  /*
   * Un título de bloque sin importe («TASAS Y OTROS CONCEPTOS») abre un bloque:
   * lo que viene debajo, hasta el final de la sección, es concepto aunque
   * tenga forma de artículo con su cantidad y su precio.
   */
  let bloqueDeConceptos = false;

  const anotar = (texto: string) => {
    const limpio = textoSinNumeros(texto, DECIMALES_AL_FINAL);
    if (/[A-Za-z0-9]/.test(limpio)) notas.push(limpio);
  };

  for (const fila of seccion) {
    if (fila === rejilla.filaCabecera) continue;
    const texto = fila.texto.trim();
    if (!texto) continue;
    // La cabecera de la tabla repetida en la página siguiente.
    if (titulosEnLaFila(fila, sinonimos) >= 3) continue;
    // «Suma y sigue»: dinero ya contado.
    if (esArrastre(texto, vocabulario)) continue;

    const concepto = comoConcepto(fila, vocabulario);
    if (concepto) {
      conceptos.push(concepto);
      if (concepto.importeCentimos === null && !/\d[.,]\d{2}/.test(texto)) bloqueDeConceptos = true;
      continue;
    }

    if (!pareceArticulo(fila)) {
      const ultima = lineas[lineas.length - 1];
      if (ultima && esContinuacion(fila)) {
        /*
         * ¿Continuación o nota? Una descripción sigue en la fila de abajo
         * porque no cabía: la de arriba llega hasta el borde de su columna.
         * Si la de arriba se queda corta, lo de abajo es otra cosa —el nombre
         * de la flota, el taller— y va a observaciones, no pegado al artículo.
         */
        const primera = filasDeCadaLinea[filasDeCadaLinea.length - 1][0];
        const llenado = rejilla.modo === "CABECERA" ? llenadoDeColumna(primera, rejilla, "descripcion") : null;
        if (llenado === null || llenado >= LLENADO_QUE_DESBORDA) {
          ultima.descripcion = [ultima.descripcion, texto].filter(Boolean).join(" ");
          ultima.rawText += `\n${fila.texto}`;
          filasDeCadaLinea[filasDeCadaLinea.length - 1].push(fila);
        } else {
          anotar(texto);
        }
        continue;
      }
      // Una fila sin importe antes de la primera línea es cabecera de la
      // sección (fecha, matrícula, destinatario): la lee `complementarios`.
      // Después de la primera, es una nota del albarán («CASO 4711»).
      if (lineas.length > 0 && /\d/.test(texto)) anotar(texto);
      continue;
    }

    if (bloqueDeConceptos) {
      conceptos.push({
        etiqueta: textoSinNumeros(texto),
        importeCentimos: leerImporte(texto.match(IMPORTE_AL_FINAL)?.[0] ?? "").centimos,
        raw: texto,
        pagina: fila.pagina,
      });
      continue;
    }

    const celdas = repartirEnColumnas(fila, rejilla);

    // Con rejilla, una fila sin nada en la columna del importe no es un
    // artículo: es texto con una cantidad al lado («SE ANULA PULMÓN 1,00»).
    if (rejilla.modo === "CABECERA" && !celdas.importe?.trim()) {
      anotar(texto);
      continue;
    }

    // Sin columna de descripción, el texto largo bajo «Referencia» es la
    // descripción: una referencia no lleva espacios. La referencia no falta:
    // el documento no la trae.
    let referenciaAusente = !hayColumna("referencia");
    if (!hayColumna("descripcion") && celdas.referencia && /\s/.test(celdas.referencia.trim())) {
      celdas.descripcion = celdas.referencia;
      delete celdas.referencia;
      referenciaAusente = true;
    }
    const cantidad = leerCantidad(celdas.cantidad);
    const precio = leerImporte(celdas.precio ?? "");
    const importe = leerImporte(celdas.importe ?? "");
    const dtos = leerDescuentos(celdas.descuento);

    lineas.push({
      numeroLinea: lineas.length + 1,
      referencia: celdas.referencia?.trim() || null,
      descripcion: celdas.descripcion?.trim() || null,
      cantidad: cantidad.valor,
      precioUnitarioCentimos: precio.centimos,
      importeCentimos: importe.centimos,
      descuentos: dtos.descuentos,
      descuentosRaw: dtos.raw,
      confianza: {
        // Sin columna de referencia en la tabla, la referencia no falta: no
        // existe en este documento. Se deja vacía con la confianza de la
        // rejilla para que no cuente como «sin leer».
        referencia: celdas.referencia || referenciaAusente ? rejilla.confianza : 0,
        descripcion: celdas.descripcion ? rejilla.confianza : 0,
        cantidad: cantidad.valor === null ? 0 : Math.min(rejilla.confianza, cantidad.confianza),
        precio: precio.centimos === null ? 0 : Math.min(rejilla.confianza, precio.confianza),
        importe: importe.centimos === null ? 0 : Math.min(rejilla.confianza, importe.confianza),
        descuentos: dtos.reconocido ? rejilla.confianza : 0.4,
      },
      cuadraAritmetica: null,
      rawText: fila.texto,
      pagina: fila.pagina,
      caja: null,
    });
    filasDeCadaLinea.push([fila]);
  }

  for (let i = 0; i < lineas.length; i++) {
    comprobarAritmetica(lineas[i], tolerancia);
    lineas[i].caja = cajaEnvolvente(filasDeCadaLinea[i]);
    aplicarTecho(lineas[i], techo);
  }
  marcarReferenciasDudosas(lineas);

  return { lineas, conceptos, rejilla, descartadas, notas };
}

/**
 * Comprueba la aritmética y ajusta la confianza de toda la fila.
 *
 * Si cuadra, los cinco valores suben a 0,95: no es que cada uno se haya leído
 * mejor, es que juntos forman una identidad que sólo se cumple si todos son
 * correctos. Si no cuadra, ninguno pasa de 0,80, incluidos los que se leyeron
 * con una rejilla perfecta.
 */
function comprobarAritmetica(l: LineaArticulo, tolerancia: number): void {
  if (l.cantidad === null || l.precioUnitarioCentimos === null || l.importeCentimos === null) {
    l.cuadraAritmetica = null;
    return;
  }
  const esperado = Math.round(l.cantidad * l.precioUnitarioCentimos * factorRestante(l.descuentos));
  const cuadra = Math.abs(esperado - l.importeCentimos) <= tolerancia;
  l.cuadraAritmetica = cuadra;

  for (const campo of ["referencia", "descripcion", "cantidad", "precio", "importe", "descuentos"] as const) {
    const actual = l.confianza[campo];
    if (actual === 0) continue;
    l.confianza[campo] = cuadra ? Math.max(actual, CONFIANZA_CUADRA) : Math.min(actual, TECHO_NO_CUADRA);
  }
}

function aplicarTecho(l: LineaArticulo, techo: number): void {
  if (techo >= 1) return;
  for (const campo of ["referencia", "descripcion", "cantidad", "precio", "importe", "descuentos"] as const) {
    l.confianza[campo] = Math.min(l.confianza[campo], techo);
  }
}

/**
 * Una referencia que mezcla letras confundibles en una columna por lo demás
 * numérica no se lee: se deja en `null`.
 *
 * Hace falta ver la columna entera para decidirlo. `44OO111222333` con una `O`
 * donde todas las demás filas llevan dígitos es un error de lectura, no un
 * código raro; pero en una columna donde las referencias ya mezclan letras y
 * números, esa misma cadena es perfectamente normal.
 */
function marcarReferenciasDudosas(lineas: LineaArticulo[]): void {
  const conReferencia = lineas.filter((l) => l.referencia);
  if (conReferencia.length < 2) return;
  const numericas = conReferencia.filter((l) => /^\d+$/.test(l.referencia!.replace(/[\s.-]/g, "")));
  if (numericas.length < conReferencia.length - 1) return;

  for (const l of conReferencia) {
    const limpia = l.referencia!.replace(/[\s.-]/g, "");
    if (/^\d+$/.test(limpia)) continue;
    if (CONFUNDIBLES.test(limpia) && /\d/.test(limpia)) {
      l.referencia = null;
      l.confianza.referencia = CONFIANZA_REFERENCIA_DUDOSA;
    }
  }
}

/** La suma de las líneas. `null` si alguna no tiene importe. */
export function sumaDeLineas(lineas: LineaArticulo[]): number | null {
  if (lineas.length === 0) return null;
  let total = 0;
  for (const l of lineas) {
    if (l.importeCentimos === null) return null;
    total += l.importeCentimos;
  }
  return total;
}
