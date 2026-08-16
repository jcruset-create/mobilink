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
 * La regla es una sola, y va por delante del precinto: **se devuelve siempre
 * con las piezas de mayor valor que haya**. Si la moneda que toca está dentro
 * de un tubo, el tubo se abre.
 *
 * El precinto solo se respeta DENTRO de cada denominación: si de esa moneda hay
 * sueltas suficientes, se gastan las sueltas y el tubo no se toca. Lo que no se
 * hace es esquivar la apertura a base de piezas más pequeñas — devolver 4,50 €
 * con nueve monedas de 0,50 € teniendo un tubo de 2 € vacía la caja de calderilla,
 * que es justo lo que la caja necesita conservar.
 *
 * Se resuelve, por tanto, contra TODO el dinero disponible (sueltas más el
 * contenido de los tubos) minimizando piezas, y después se deduce cuántos tubos
 * hay que abrir de cada denominación.
 *
 * Limitación consciente: minimiza PIEZAS y luego deduce los tubos que esa
 * combinación necesita. No busca la combinación que abra menos tubos, que sería
 * otro óptimo y otro algoritmo. Con el sistema de monedas del euro, minimizar
 * piezas es exactamente dar las de mayor valor, que es lo que se pide.
 */
export function calcularCambioConCartuchos(
  importe: Centimos,
  stock: StockConCartuchos,
  porCartucho: PiezasPorCartucho
): ResultadoCambioCartuchos {
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
