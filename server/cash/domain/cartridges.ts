/**
 * Cartuchos de monedas.
 *
 * Un cartucho NO es otro tipo de dinero: es un envoltorio de 25 o 50 monedas
 * iguales. Y en una caja real tiene dos propiedades que mandan sobre todo lo
 * demás:
 *
 *  · **Se abre, y no se vuelve a cerrar.** Nadie se pone a reencartuchar
 *    monedas en el mostrador. Abrir un tubo es irreversible: sus monedas pasan
 *    a ser sueltas para siempre.
 *  · **Solo se abre si hace falta.** Si hay sueltas suficientes de esa misma
 *    denominación, el tubo no se toca.
 *
 * De ahí que el stock tenga que distinguir sueltas de encartuchadas. Contarlo
 * todo como piezas —que es lo que hacía la primera versión— dejaba al operador
 * sin saber que de las cuatro monedas de 1 € que le pide la pantalla solo una
 * está suelta y las otras tres están dentro de un tubo precintado.
 */

import type { Centimos } from "./money.ts";
import { type Inventario, type LineaDenominacion, inventarioDesdeLineas } from "./inventory.ts";
import { calcularCambio, type MotivoCambioImposible } from "./change.ts";
import { esExito, esFallo } from "./result.ts";

/** Cuántas piezas trae un cartucho de cada denominación. Sin entrada = sin cartucho. */
export type PiezasPorCartucho = ReadonlyMap<Centimos, number>;

/** Existencias separadas por formato. */
export type StockConCartuchos = {
  /** Monedas y billetes sueltos, por valor. */
  sueltas: Inventario;
  /** Tubos precintados, por valor de la moneda que contienen. */
  cartuchos: ReadonlyMap<Centimos, number>;
};

/** Cartuchos que hay que abrir para poder entregar una combinación. */
export type AperturaCartucho = {
  valor: Centimos;
  cartuchos: number;
  /** Monedas que salen del tubo al abrirlo. */
  piezas: number;
};

export type ResultadoCambioCartuchos =
  | {
      ok: true;
      lineas: LineaDenominacion[];
      piezas: number;
      /** Vacío cuando ha bastado con las sueltas. */
      aperturas: AperturaCartucho[];
    }
  | { ok: false; motivo: MotivoCambioImposible; mensaje: string };

/** Piezas totales de una denominación, estén sueltas o dentro de un tubo. */
export function piezasTotales(
  stock: StockConCartuchos,
  valor: Centimos,
  porCartucho: PiezasPorCartucho
): number {
  const sueltas = stock.sueltas.get(valor) ?? 0;
  const tubos = stock.cartuchos.get(valor) ?? 0;
  return sueltas + tubos * (porCartucho.get(valor) ?? 0);
}

/** Inventario equivalente con todos los tubos abiertos. Es el máximo disponible. */
export function inventarioConTodoAbierto(
  stock: StockConCartuchos,
  porCartucho: PiezasPorCartucho
): Inventario {
  const m = new Map(stock.sueltas);
  for (const [valor, tubos] of stock.cartuchos) {
    const n = porCartucho.get(valor) ?? 0;
    if (tubos > 0 && n > 0) m.set(valor, (m.get(valor) ?? 0) + tubos * n);
  }
  return m;
}

/**
 * Cambio teniendo en cuenta los cartuchos.
 *
 * Dos pasadas, y el orden es la regla de negocio:
 *
 *  1. Se intenta con las **sueltas solas**. Si sale, no se abre ningún tubo,
 *     aunque abriendo uno se pudiera devolver con menos piezas. Es lo que pide
 *     la caja: mientras haya suelto, el precinto no se rompe.
 *  2. Si no sale, se resuelve con todo el pool (tubos incluidos) y se calcula
 *     cuántos hay que abrir de cada denominación.
 *
 * Limitación consciente: la segunda pasada minimiza PIEZAS y luego deduce los
 * tubos que esa combinación necesita. No busca la combinación que abra menos
 * tubos, que sería otro óptimo y otro algoritmo. En una caja con tubos de una o
 * dos denominaciones —lo normal— coinciden; si algún día no basta, el sitio
 * donde tocarlo es éste y las pruebas lo fijan.
 */
export function calcularCambioConCartuchos(
  importe: Centimos,
  stock: StockConCartuchos,
  porCartucho: PiezasPorCartucho
): ResultadoCambioCartuchos {
  // 1. ¿Basta con lo suelto?
  const soloSueltas = calcularCambio(importe, stock.sueltas);
  if (esExito(soloSueltas)) {
    return { ok: true, lineas: soloSueltas.lineas, piezas: soloSueltas.piezas, aperturas: [] };
  }

  // 2. Hay que abrir. Se resuelve con todo el pool disponible.
  const todo = inventarioConTodoAbierto(stock, porCartucho);
  const conTubos = calcularCambio(importe, todo);
  if (esFallo(conTubos)) return conTubos;

  const aperturas: AperturaCartucho[] = [];
  for (const linea of conTubos.lineas) {
    const sueltas = stock.sueltas.get(linea.valor) ?? 0;
    const faltan = linea.cantidad - sueltas;
    if (faltan <= 0) continue;

    const n = porCartucho.get(linea.valor) ?? 0;
    /* c8 ignore next — si faltan piezas y no hay cartucho, `calcularCambio` no
       habría encontrado esta solución: el pool no las tendría. */
    if (n <= 0) continue;

    const tubos = Math.ceil(faltan / n);
    aperturas.push({ valor: linea.valor, cartuchos: tubos, piezas: tubos * n });
  }

  return { ok: true, lineas: conTubos.lineas, piezas: conTubos.piezas, aperturas };
}

/** Atajo para las pruebas y la API, que hablan en líneas. */
export function stockDesdeLineas(
  sueltas: readonly LineaDenominacion[],
  cartuchos: readonly LineaDenominacion[] = []
): StockConCartuchos {
  return {
    sueltas: inventarioDesdeLineas(sueltas),
    cartuchos: inventarioDesdeLineas(cartuchos),
  };
}

/**
 * Comprueba que una entrega cabe en el stock, abriendo tubos si hace falta, y
 * devuelve las aperturas necesarias.
 *
 * Es la validación que usa el servidor al confirmar: el operador puede haber
 * cambiado a mano la propuesta, y hay que volver a decidir qué tubos se abren
 * con lo que finalmente entrega.
 */
export function aperturasNecesarias(
  entrega: readonly LineaDenominacion[],
  stock: StockConCartuchos,
  porCartucho: PiezasPorCartucho
):
  | { ok: true; aperturas: AperturaCartucho[] }
  | { ok: false; valor: Centimos; pedido: number; disponible: number } {
  const aperturas: AperturaCartucho[] = [];

  for (const { valor, cantidad } of entrega) {
    if (cantidad <= 0) continue;
    const sueltas = stock.sueltas.get(valor) ?? 0;
    if (cantidad <= sueltas) continue;

    const faltan = cantidad - sueltas;
    const n = porCartucho.get(valor) ?? 0;
    const tubos = n > 0 ? Math.ceil(faltan / n) : 0;
    const disponiblesTubos = stock.cartuchos.get(valor) ?? 0;

    if (n <= 0 || tubos > disponiblesTubos) {
      return {
        ok: false,
        valor,
        pedido: cantidad,
        disponible: sueltas + disponiblesTubos * n,
      };
    }
    aperturas.push({ valor, cartuchos: tubos, piezas: tubos * n });
  }

  return { ok: true, aperturas };
}
