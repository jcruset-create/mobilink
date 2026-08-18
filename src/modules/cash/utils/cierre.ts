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
 * El dinero va en tres dimensiones que NO se pueden fundir: monedas sueltas,
 * cartuchos precintados y bolsas precintadas. Un envase entero se queda o se va
 * —no se parte al cerrar—, así que el reparto se hace por separado en cada una.
 */

import type { Denominacion, LineaDenominacion } from "../types";

/** Qué precinto es. Determina de dónde sale el número de piezas. */
export type TipoEnvase = "cartucho" | "bolsa";

export type LineaEnvase = LineaDenominacion & {
  tipo: TipoEnvase;
  /** Monedas que trae cada envase. */
  piezasPorEnvase: number;
  /** Valor de la línea: envases × piezas × valor. */
  importe: number;
};

export type RepartoCierre = {
  /** Monedas y billetes sueltos que van al banco. */
  sueltas: LineaDenominacion[];
  /** Cartuchos precintados que van al banco, sin abrir. */
  tubos: LineaEnvase[];
  /** Bolsas precintadas que van al banco, sin abrir. */
  bolsas: LineaEnvase[];
  /** Lo que suman las tres listas de arriba. Nada más. */
  totalCentimos: number;
};

export type EntradaReparto = {
  /** Lo contado en el arqueo, suelto. */
  sueltasContadas: readonly LineaDenominacion[];
  /** Lo contado en el arqueo, en tubos. `cantidad` son tubos. */
  tubosContados: readonly LineaDenominacion[];
  /** Lo contado en el arqueo, en bolsas. `cantidad` son bolsas. */
  bolsasContadas?: readonly LineaDenominacion[];
  /** Lo que se deja en caja, suelto: valor en céntimos → piezas. */
  cambioFinalSueltas: Record<number, number>;
  /** Tubos que se quedan precintados para mañana. */
  cambioFinalTubos: readonly LineaDenominacion[];
  /** Bolsas que se quedan precintadas para mañana. */
  cambioFinalBolsas?: readonly LineaDenominacion[];
  denominaciones: readonly Denominacion[];
};

/** Piezas que trae un envase de esa denominación, según de cuál se trate. */
function piezasDeEnvase(
  valor: number,
  tipo: TipoEnvase,
  denominaciones: readonly Denominacion[]
): number {
  const d = denominaciones.find((x) => x.valor === valor);
  return (tipo === "cartucho" ? d?.piezasPorCartucho : d?.piezasPorBolsa) ?? 0;
}

/** Lo que se lleva al banco = lo contado − lo que se queda, en las tres dimensiones. */
export function repartirIngreso(e: EntradaReparto): RepartoCierre {
  const sueltas = e.sueltasContadas
    .map((l) => ({ valor: l.valor, cantidad: l.cantidad - (e.cambioFinalSueltas[l.valor] ?? 0) }))
    .filter((l) => l.cantidad > 0)
    .sort((a, b) => b.valor - a.valor);

  const repartirEnvases = (
    contados: readonly LineaDenominacion[],
    sequedan: readonly LineaDenominacion[],
    tipo: TipoEnvase
  ): LineaEnvase[] =>
    contados
      .map((t) => {
        const quedan = sequedan.find((x) => x.valor === t.valor)?.cantidad ?? 0;
        const cantidad = t.cantidad - quedan;
        const piezasPorEnvase = piezasDeEnvase(t.valor, tipo, e.denominaciones);
        return {
          valor: t.valor,
          cantidad,
          tipo,
          piezasPorEnvase,
          importe: cantidad * piezasPorEnvase * t.valor,
        };
      })
      .filter((t) => t.cantidad > 0)
      .sort((a, b) => b.valor - a.valor);

  const tubos = repartirEnvases(e.tubosContados, e.cambioFinalTubos, "cartucho");
  const bolsas = repartirEnvases(e.bolsasContadas ?? [], e.cambioFinalBolsas ?? [], "bolsa");

  const totalCentimos =
    sueltas.reduce((a, l) => a + l.valor * l.cantidad, 0) +
    [...tubos, ...bolsas].reduce((a, t) => a + t.importe, 0);

  return { sueltas, tubos, bolsas, totalCentimos };
}

/** Valor de unas líneas de envases, para el lado que se queda en caja. */
export function valorEnvasado(
  lineas: readonly LineaDenominacion[],
  denominaciones: readonly Denominacion[],
  tipo: TipoEnvase = "cartucho"
): number {
  return lineas.reduce(
    (a, l) => a + l.valor * l.cantidad * piezasDeEnvase(l.valor, tipo, denominaciones),
    0
  );
}
