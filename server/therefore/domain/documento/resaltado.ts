/**
 * Por dónde hay que pasar el subrayador.
 *
 * Una factura trae cinco albaranes y a quien la mira sólo le importa uno. El
 * PDF resaltado es ese «uno» señalado en amarillo sobre el papel entero: se
 * puede reenviar al proveedor, imprimir y grapar, y no hay que explicar por
 * teléfono en qué parte de la página tiene que mirar.
 *
 * ── Por qué esto es código puro ─────────────────────────────────────────────
 *
 * Aquí sólo se decide QUÉ rectángulos hay que pintar, a partir de la sección
 * que ya delimitó el parser. Pintarlos es cosa de `documentos/resaltado.ts`,
 * que abre el PDF. Separarlo permite comprobar las cajas con un objeto escrito
 * a mano, sin generar un PDF ni mirarlo con los ojos.
 *
 * ── Y por qué se resalta el bloque entero ───────────────────────────────────
 *
 * No sólo las líneas de artículo: también la cabecera del albarán —su número,
 * su fecha, la dirección de entrega— y sus descuentos y tasas. Es lo que hay
 * que comprobar contra el ERP, y es lo que distingue este albarán del de
 * arriba. Resaltar sólo los importes dejaría fuera precisamente el número que
 * dice de quién son.
 */

import type { SeccionAlbaran } from "./secciones.ts";
import { SINONIMOS_COLUMNA_POR_DEFECTO, titulosEnLaFila, type SinonimosColumna } from "./tabla.ts";
import type { Caja } from "./tipos.ts";

/** `NUMERO` es la marca del albarán; va más fuerte que el resto del bloque. */
export type TipoResaltado = "BLOQUE" | "NUMERO";

export type CajaResaltada = Caja & { pagina: number; tipo: TipoResaltado };

/**
 * Lo que se le añade a cada caja por los cuatro lados.
 *
 * Un rectángulo pegado al texto se lee como un subrayado de máquina. Punto y
 * medio de aire por arriba y por abajo es lo que hace que parezca lo que es:
 * un rotulador pasado por encima.
 */
export const MARGEN_PT = 1.5;

/**
 * Las cajas del albarán, listas para pintar.
 *
 * Vacío cuando no hay nada que señalar, y son dos casos distintos que aquí se
 * tratan igual a propósito: el albarán no se localizó, o el documento no trae
 * ninguna marca y la «sección» es el documento entero. En los dos, pintar
 * sería afirmar algo que nadie ha comprobado.
 */
export function cajasDelAlbaran(
  seccion: SeccionAlbaran | null,
  margen = MARGEN_PT,
  columnas: SinonimosColumna = SINONIMOS_COLUMNA_POR_DEFECTO
): CajaResaltada[] {
  if (!seccion || seccion.documentoEntero) return [];

  /*
   * Una sección llega hasta donde empieza la siguiente, así que su final
   * arrastra lo que hubiera por medio: la cabecera de columnas de la página
   * siguiente y las marcas de la plantilla. Eso NO es del albarán, y pintarlo
   * de amarillo diría que sigue en una página donde no tiene nada.
   *
   * Dos cortes, y los dos son de sentido común mirando el papel: no se pinta
   * una cabecera de columnas, y no se pinta una página en la que el albarán no
   * tiene ni una cifra.
   */
  const suyas = seccion.lineas.filter((l) => titulosEnLaFila(l, columnas) < 3);
  const conCifras = new Set(
    suyas.filter((l) => /\d/.test(l.texto)).map((l) => l.pagina)
  );

  const cajas: CajaResaltada[] = suyas
    .filter((l) => conCifras.has(l.pagina))
    .map((l) => ({
      pagina: l.pagina,
      x: l.x - margen,
      y: l.y - margen,
      w: l.w + margen * 2,
      h: l.h + margen * 2,
      tipo: "BLOQUE" as const,
    }));

  if (seccion.cajaInicio) {
    cajas.push({
      pagina: seccion.paginaInicio,
      x: seccion.cajaInicio.x - margen,
      y: seccion.cajaInicio.y - margen,
      w: seccion.cajaInicio.w + margen * 2,
      h: seccion.cajaInicio.h + margen * 2,
      tipo: "NUMERO",
    });
  }

  return cajas;
}

/** Las páginas que toca el albarán, en orden. Para decirlo en el fichero. */
export function paginasResaltadas(cajas: CajaResaltada[]): number[] {
  return [...new Set(cajas.map((c) => c.pagina))].sort((a, b) => a - b);
}
