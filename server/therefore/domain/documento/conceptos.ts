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

/** Cuestan dinero, no son línea, y no cierran nada. */
export const CONCEPTOS_GLOBALES_POR_DEFECTO = [
  "portes",
  "transporte",
  "gastos de envio",
  "tasa",
  "tasas",
  "recargo",
  "rappel",
] as const;

/**
 * El pie de la factura. Cierran la sección del albarán.
 *
 * `suma` y `subtotal` están aquí y no entre los globales porque no añaden
 * dinero nuevo: repiten el que ya está contado. Sumarlos duplicaría el albarán
 * entero.
 */
export const TOTALES_DOCUMENTO_POR_DEFECTO = [
  "base imponible",
  "base imp",
  "total factura",
  "total documento",
  "iva",
  "i.v.a",
  "subtotal",
  "suma",
  "total",
] as const;

export type VocabularioConceptos = {
  globales: readonly string[];
  totales: readonly string[];
};

export const VOCABULARIO_CONCEPTOS: VocabularioConceptos = {
  globales: CONCEPTOS_GLOBALES_POR_DEFECTO,
  totales: TOTALES_DOCUMENTO_POR_DEFECTO,
};

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
  return empiezaPorAlguna(texto, vocabulario.globales);
}

/** La etiqueta del total de documento, o `null` si no lo es. */
export function totalDocumento(
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
