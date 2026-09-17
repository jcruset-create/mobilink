/**
 * Lo que lleva un importe y NO es un artículo.
 *
 * «Portes 12,50» tiene la misma forma que una línea de albarán: texto a la
 * izquierda, número a la derecha. Pero no es material entregado, y si se cuela
 * entre las líneas pasan dos cosas malas a la vez: la suma del albarán deja de
 * ser la suma del albarán, y el descuadre contra el importe de la incidencia
 * —que es justo lo que hay que detectar— queda explicado por accidente.
 *
 * ── Dos familias, y la diferencia importa ───────────────────────────────────
 *
 * · CONCEPTOS GLOBALES (portes, transporte, tasa, recargo, rappel): cuestan
 *   dinero pero no son línea. Se guardan aparte, se enseñan aparte y no se
 *   suman (§32). El expediente los necesita porque quien mire el descuadre va
 *   a preguntar «¿y los portes?», y la respuesta tiene que estar a la vista.
 *
 * · TOTALES DEL DOCUMENTO (base imponible, IVA, total factura, subtotal): no
 *   pertenecen a ningún albarán, son el pie de la FACTURA. Además de no ser
 *   línea, CIERRAN la sección: lo que viene después ya no es del albarán que
 *   se estaba leyendo. Por eso van en una lista aparte y no en la general.
 *
 * ── Y por qué no basta con mirar el texto ───────────────────────────────────
 *
 * «Base imponible» en una columna de descripción, con su referencia y su
 * cantidad al lado, es un artículo que se llama así —raro, pero pasa, y más en
 * un albarán de servicios—. Lo que distingue al pie es que NO tiene referencia
 * ni cantidad: sólo etiqueta e importe. Esa comprobación la hace quien tiene
 * las celdas delante (`lineas.ts`); aquí sólo se reconoce el texto.
 *
 * Las listas son configurables (`albaran.conceptos_globales`) para que un
 * proveedor que escriba «Gastos de envío» se atienda sin desplegar.
 */

import { normalizar } from "../correo/texto.ts";
import { sinFechas } from "./tipos.ts";

/** Cuestan dinero, no son línea, y no cierran nada. */
export const CONCEPTOS_GLOBALES_POR_DEFECTO = [
  "portes",
  "transporte",
  "gastos de envio",
  "gastos de tratamiento",
  "gastos de gestion",
  "tasa",
  "tasas",
  "recargo",
  "rappel",
] as const;

/**
 * Tasas ambientales: se reconocen aunque no vayan al principio de la fila.
 *
 * «S.I. Gestión de NFU», «Gastos de ecovalor», «Ecotasa»: cada proveedor las
 * escribe con su prefijo, y todas cuestan dinero sin ser material. Por eso
 * esta lista se busca CONTENIDA en el texto, como palabra entera, y no sólo
 * al principio como el resto.
 */
export const CONCEPTOS_AMBIENTALES_POR_DEFECTO = [
  "ecovalor",
  "ecotasa",
  "nfu",
  "sigaus",
  "sigrauto",
  "punto verde",
  "gestion de residuos",
] as const;

/**
 * Arrastres entre páginas: «Suma y sigue», «Suma anterior».
 *
 * Repiten dinero que ya está contado y NO cierran nada: el albarán sigue en
 * la página siguiente. Ni línea, ni concepto, ni pie. Se ignoran.
 */
export const ARRASTRES_POR_DEFECTO = [
  "suma y sigue",
  "suma anterior",
  "a cuenta nueva",
  "sigue en",
  "continua en",
] as const;

/**
 * El pie de la factura. Cierran la sección del albarán.
 *
 * `suma` y `subtotal` están aquí y no entre los globales porque no añaden
 * dinero nuevo: repiten el que ya está contado. Sumarlos duplicaría el albarán
 * entero.
 */
export const TOTALES_DOCUMENTO_POR_DEFECTO = [
  "importe bruto",
  "importe neto",
  "importe total",
  "base imponible",
  "base imp",
  "total sin iva",
  "total con iva",
  "total iva incluido",
  "total factura",
  "total documento",
  "total abono",
  "total a pagar",
  "iva",
  "i.v.a",
] as const;

/**
 * Totales de UNA LÍNEA, no del documento: «Total», «Neto», «Subt2: Net 1».
 *
 * Hay plantillas de ERP que desglosan cada artículo en varias filas —bruto,
 * descuentos, neto— y rematan el bloque con un «Total» a secas. Ese «Total»
 * no es el pie de la factura y NO cierra el albarán: cerrarlo ahí dejaba
 * fuera todo lo que venía detrás, que es el resto de la factura.
 *
 * Siguen sin ser línea: no se suman ni se cuentan como artículo.
 */
export const TOTALES_LINEA_POR_DEFECTO = ["total", "neto", "subtotal", "subt", "suma"] as const;

export type VocabularioConceptos = {
  globales: readonly string[];
  totales: readonly string[];
  /** Se buscan contenidas, como palabra entera. Opcional por compatibilidad. */
  ambientales?: readonly string[];
  arrastres?: readonly string[];
  /** Totales de una línea. No son artículo, pero tampoco cierran la sección. */
  totalesLinea?: readonly string[];
};

export const VOCABULARIO_CONCEPTOS: VocabularioConceptos = {
  globales: CONCEPTOS_GLOBALES_POR_DEFECTO,
  totales: TOTALES_DOCUMENTO_POR_DEFECTO,
  ambientales: CONCEPTOS_AMBIENTALES_POR_DEFECTO,
  arrastres: ARRASTRES_POR_DEFECTO,
  totalesLinea: TOTALES_LINEA_POR_DEFECTO,
};

/** Minúsculas, sin acentos, con la puntuación de relleno convertida en espacio. */
function llano(texto: string): string {
  return normalizar(texto)
    .toLowerCase()
    .replace(/[.:·-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contieneEntera(texto: string, etiqueta: string): boolean {
  const t = ` ${llano(texto)} `;
  const e = ` ${llano(etiqueta)} `;
  return e.trim().length > 0 && t.includes(e);
}

/**
 * ¿El texto EMPIEZA por una de estas etiquetas?
 *
 * Empieza y no «contiene» a propósito: «Filtro de aceite con portes incluidos»
 * contiene «portes» y es un artículo con todas las letras. La etiqueta de un
 * concepto va delante, porque es el nombre de la fila.
 */
function empiezaPorAlguna(texto: string, etiquetas: readonly string[]): string | null {
  const t = normalizar(texto)
    .toLowerCase()
    // Los dos puntos y los guiones de relleno («Portes .......  12,50») no son
    // parte de la etiqueta.
    .replace(/[.:·-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;

  let mejor: string | null = null;
  for (const e of etiquetas) {
    const normalizada = e.replace(/[.]/g, " ").replace(/\s+/g, " ").trim();
    if (t === normalizada || t.startsWith(normalizada + " ")) {
      // La etiqueta más larga gana: «base imponible» antes que «base».
      if (!mejor || normalizada.length > mejor.length) mejor = e;
    }
  }
  return mejor;
}

/** La etiqueta del concepto global, o `null` si no lo es. */
export function conceptoGlobal(
  texto: string,
  vocabulario: VocabularioConceptos = VOCABULARIO_CONCEPTOS
): string | null {
  const alPrincipio = empiezaPorAlguna(texto, vocabulario.globales);
  if (alPrincipio) return alPrincipio;
  for (const e of vocabulario.ambientales ?? []) {
    if (contieneEntera(texto, e)) return e;
  }
  return null;
}

/** ¿Es un arrastre entre páginas («Suma y sigue»)? Se ignora del todo. */
export function esArrastre(
  texto: string,
  vocabulario: VocabularioConceptos = VOCABULARIO_CONCEPTOS
): boolean {
  return (vocabulario.arrastres ?? []).some((e) => contieneEntera(texto, e));
}

/**
 * ¿Es la fila de TÍTULOS del pie de la factura?
 *
 * Hay plantillas que ponen «Base imponible  IVA  Total» en una fila y los
 * importes en la de debajo. Esa fila de títulos no tiene ningún importe y aun
 * así es el pie: dos o más etiquetas de total, sin ningún número con
 * decimales. Una sola («Total», que también es título de columna) no basta.
 */
export function esCabeceraDeTotales(
  texto: string,
  vocabulario: VocabularioConceptos = VOCABULARIO_CONCEPTOS
): boolean {
  if (/\d[.,]\d{2}/.test(sinFechas(texto))) return false;
  let t = ` ${llano(texto)} `;
  let n = 0;
  // De la más larga a la más corta, retirando lo reconocido para no contar
  // «base imponible» y «base imp» dos veces.
  const etiquetas = [...vocabulario.totales].sort((a, b) => b.length - a.length);
  for (const e of etiquetas) {
    const marca = ` ${llano(e)} `;
    if (!marca.trim()) continue;
    if (t.includes(marca)) {
      n++;
      t = t.split(marca).join("  ");
    }
  }
  return n >= 2;
}

/**
 * La etiqueta de un total —del documento o de una línea—, o `null`.
 *
 * Los dos comparten que no son un artículo. Lo que los separa es si cierran
 * la sección, y eso lo pregunta `cierraSeccion`.
 */
export function totalDocumento(
  texto: string,
  vocabulario: VocabularioConceptos = VOCABULARIO_CONCEPTOS
): string | null {
  return (
    empiezaPorAlguna(texto, vocabulario.totales) ??
    empiezaPorAlguna(texto, vocabulario.totalesLinea ?? [])
  );
}

/** ¿Este total es el pie de la factura, y por tanto cierra el albarán? */
export function cierraSeccion(
  texto: string,
  vocabulario: VocabularioConceptos = VOCABULARIO_CONCEPTOS
): string | null {
  return empiezaPorAlguna(texto, vocabulario.totales);
}

/** Cualquiera de las dos familias. */
export function esConcepto(
  texto: string,
  vocabulario: VocabularioConceptos = VOCABULARIO_CONCEPTOS
): boolean {
  return conceptoGlobal(texto, vocabulario) !== null || totalDocumento(texto, vocabulario) !== null;
}
