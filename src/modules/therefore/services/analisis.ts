/**
 * Lo que la pantalla del albarán calcula para pintarse.
 *
 * Mismo criterio que `bandeja.ts`: en este proyecto no hay pruebas de
 * componentes, así que lo que tiene una regla sale del `.tsx` y se prueba
 * aquí. Y aquí hay tres reglas que merecen prueba: el encabezado cambia según
 * lo que se pida hacer, la suma se recalcula en pantalla en vez de creerse la
 * guardada, y una celda dudosa no es lo mismo que una celda vacía.
 */

import type { AlbaranAnalizado, EstadoAnalisis, LineaAlbaran, ValidacionAnalisis } from "../types";

/**
 * El encabezado del bloque, según lo que la actuación pida (§41).
 *
 * No es cosmética: quien va a GRABAR necesita saber que lo que tiene delante es
 * lo que va a teclear en el ERP, y quien va a MODIFICAR que es el estado del
 * papel contra el que comparar. El mismo título para los dos hace que el
 * segundo crea que ya está hecho.
 */
export function tituloAnalisis(tipoAccion: string): string {
  switch (tipoAccion) {
    case "GRABAR":
      return "Datos para entrada manual en ERP";
    case "MODIFICAR":
      return "Datos del documento para modificación en ERP";
    default:
      return "Albarán estructurado";
  }
}

/**
 * La suma de las líneas, recalculada en pantalla.
 *
 * `null` si a alguna le falta el importe: una suma parcial enseñada como total
 * es un número que cuadra con nada y que alguien copiará igualmente.
 */
export function sumaDeLineas(lineas: LineaAlbaran[]): number | null {
  if (lineas.length === 0) return null;
  let total = 0;
  for (const l of lineas) {
    if (l.importeCentimos === null) return null;
    total += l.importeCentimos;
  }
  return total;
}

export type ResumenCeldas = {
  /** Están, pero por debajo del umbral. */
  dudosas: number;
  /** No están. Hay que rellenarlas a mano. */
  vacias: number;
};

/** Cuántas celdas críticas no se han leído bien, separando dudosa de vacía. */
export function celdasFlojas(lineas: LineaAlbaran[], umbral: number): ResumenCeldas {
  let dudosas = 0;
  let vacias = 0;
  for (const l of lineas) {
    const campos: [unknown, number][] = [
      [l.referencia, l.confianza.referencia],
      [l.cantidad, l.confianza.cantidad],
      [l.precioUnitarioCentimos, l.confianza.precio],
      [l.importeCentimos, l.confianza.importe],
    ];
    for (const [valor, confianza] of campos) {
      if (valor === null || valor === undefined || valor === "") vacias++;
      else if (confianza < umbral) dudosas++;
    }
  }
  return { dudosas, vacias };
}

const ORDEN: Record<EstadoAnalisis, number> = { OK: 0, REVISAR: 1, ERROR: 2 };

/** El peor estado de una lista de validaciones. Vacía = OK. */
export function peorEstado(validaciones: ValidacionAnalisis[]): EstadoAnalisis {
  let peor: EstadoAnalisis = "OK";
  for (const v of validaciones) if (ORDEN[v.estado] > ORDEN[peor]) peor = v.estado;
  return peor;
}

/**
 * Qué enseñar en la pestaña mientras el análisis no ha terminado.
 *
 * Un albarán en cola no tiene nada que contar todavía, y enseñar «0 líneas»
 * haría creer que el documento no traía ninguna.
 */
export function estadoParaPantalla(a: AlbaranAnalizado): { estado: string; enCurso: boolean } {
  if (a.estadoProceso === "PENDIENTE" || a.estadoProceso === "PROCESANDO") {
    return { estado: a.estadoProceso, enCurso: true };
  }
  return { estado: a.estadoAnalisis ?? a.estadoProceso, enCurso: false };
}

/** Los análisis que ya no son el vigente: se guardan, pero no se enseñan arriba. */
export function esHistorico(a: AlbaranAnalizado): boolean {
  return Boolean(a.metadata?.sustituidaPor);
}
