/**
 * Reparto del cierre: qué se queda en caja y qué se lleva al banco.
 *
 * Vive aquí y no dentro de la pantalla por un fallo concreto: la lista del
 * ingreso se pintaba con las monedas sueltas y el total se calculaba con las
 * sueltas MÁS los cartuchos. Con un tubo de 2 € y otro de 1 € en el cajón, el
 * total decía 644,37 € y las líneas sumaban 569,37 €: 75 € que iban al banco
 * sin aparecer en la hoja que se lleva quien hace el ingreso.
 *
 * Con el reparto en un solo sitio, lo que se enseña y lo que se suma salen de
 * la misma cuenta y no pueden volver a separarse. La prueba lo fija.
 *
 * El dinero va en dos dimensiones que NO se pueden fundir: monedas sueltas y
 * tubos precintados. Un tubo entero se queda o se va —no se parte al cerrar—,
 * así que el reparto se hace por separado en cada dimensión.
 */

import type { Denominacion, LineaDenominacion } from "../types";

export type LineaTubo = LineaDenominacion & {
  /** Monedas que trae cada tubo. */
  piezasPorCartucho: number;
  /** Valor de la línea: tubos × piezas × valor. */
  importe: number;
};

export type RepartoCierre = {
  /** Monedas y billetes sueltos que van al banco. */
  sueltas: LineaDenominacion[];
  /** Tubos precintados que van al banco, sin abrir. */
  tubos: LineaTubo[];
  /** Lo que suman las dos listas de arriba. Nada más. */
  totalCentimos: number;
};

export type EntradaReparto = {
  /** Lo contado en el arqueo, suelto. */
  sueltasContadas: readonly LineaDenominacion[];
  /** Lo contado en el arqueo, en tubos. `cantidad` son tubos. */
  tubosContados: readonly LineaDenominacion[];
  /** Lo que se deja en caja, suelto: valor en céntimos → piezas. */
  cambioFinalSueltas: Record<number, number>;
  /** Tubos que se quedan precintados para mañana. */
  cambioFinalTubos: readonly LineaDenominacion[];
  denominaciones: readonly Denominacion[];
};

/** Lo que se lleva al banco = lo contado − lo que se queda, en las dos dimensiones. */
export function repartirIngreso(e: EntradaReparto): RepartoCierre {
  const piezasDe = (valor: number) =>
    e.denominaciones.find((d) => d.valor === valor)?.piezasPorCartucho ?? 0;

  const sueltas = e.sueltasContadas
    .map((l) => ({ valor: l.valor, cantidad: l.cantidad - (e.cambioFinalSueltas[l.valor] ?? 0) }))
    .filter((l) => l.cantidad > 0)
    .sort((a, b) => b.valor - a.valor);

  const tubos = e.tubosContados
    .map((t) => {
      const sequedan = e.cambioFinalTubos.find((x) => x.valor === t.valor)?.cantidad ?? 0;
      const cantidad = t.cantidad - sequedan;
      const piezasPorCartucho = piezasDe(t.valor);
      return {
        valor: t.valor,
        cantidad,
        piezasPorCartucho,
        importe: cantidad * piezasPorCartucho * t.valor,
      };
    })
    .filter((t) => t.cantidad > 0)
    .sort((a, b) => b.valor - a.valor);

  const totalCentimos =
    sueltas.reduce((a, l) => a + l.valor * l.cantidad, 0) + tubos.reduce((a, t) => a + t.importe, 0);

  return { sueltas, tubos, totalCentimos };
}

/** Valor de unas líneas de tubos, para el lado que se queda en caja. */
export function valorEnTubos(
  lineas: readonly LineaDenominacion[],
  denominaciones: readonly Denominacion[]
): number {
  return lineas.reduce((a, l) => {
    const piezas = denominaciones.find((d) => d.valor === l.valor)?.piezasPorCartucho ?? 0;
    return a + l.valor * l.cantidad * piezas;
  }, 0);
}
