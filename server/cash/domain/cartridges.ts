/**
 * Formatos de las monedas: sueltas, en cartucho y en bolsa.
 *
 * Ni el cartucho ni la bolsa son otro tipo de dinero: son envoltorios de
 * monedas iguales —25 o 50 en un tubo, varios cientos en una bolsa del banco—.
 * Y en una caja real tienen dos propiedades que mandan sobre todo lo demás:
 *
 *  · **Se abren, y no se vuelven a cerrar.** Nadie se pone a reencartuchar
 *    monedas en el mostrador. Abrir es irreversible: sus monedas pasan a ser
 *    sueltas para siempre.
 *  · **Solo se abren si hace falta.** Si hay sueltas suficientes de esa misma
 *    denominación, el precinto no se toca.
 *
 * De ahí que el stock distinga los tres formatos. Contarlo todo como piezas
 * —que es lo que hacía la primera versión— dejaba al operador sin saber que de
 * las cuatro monedas de 1 € que le pide la pantalla solo una está suelta y las
 * otras tres están dentro de un tubo precintado.
 *
 * **Orden de apertura dentro de una denominación: sueltas → cartuchos → bolsa.**
 * Se rompe siempre el envoltorio más pequeño primero. Abrir una bolsa de 500
 * monedas para dar dos es desproporcionado si había un tubo de 25 a mano, y
 * deja el cajón lleno de calderilla suelta que ya no se puede volver a guardar.
 */

import type { Centimos } from "./money.ts";
import { type Inventario, type LineaDenominacion, inventarioDesdeLineas } from "./inventory.ts";
import { calcularCambio, type MotivoCambioImposible } from "./change.ts";
import { esExito, esFallo } from "./result.ts";

/** Cuántas piezas trae un cartucho de cada denominación. Sin entrada = sin cartucho. */
export type PiezasPorCartucho = ReadonlyMap<Centimos, number>;

/** Cuántas piezas trae una bolsa de cada denominación. Sin entrada = sin bolsa. */
export type PiezasPorBolsa = ReadonlyMap<Centimos, number>;

/** Existencias separadas por formato. */
export type StockConCartuchos = {
  /** Monedas y billetes sueltos, por valor. */
  sueltas: Inventario;
  /** Tubos precintados, por valor de la moneda que contienen. */
  cartuchos: ReadonlyMap<Centimos, number>;
  /** Bolsas precintadas del banco, por valor de la moneda que contienen. */
  bolsas?: ReadonlyMap<Centimos, number>;
};

/**
 * Lo que hay que abrir para poder entregar una combinación.
 *
 * `cartuchos` y `bolsas` van por separado porque son dos precintos distintos y
 * el asiento en el libro tiene que decir cuál se rompió: no es lo mismo abrir
 * un tubo de 25 que una bolsa de 500.
 */
export type AperturaCartucho = {
  valor: Centimos;
  cartuchos: number;
  bolsas?: number;
  /** Monedas que salen al abrir, sumando los dos formatos. */
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

/** Mapa vacío reutilizable: sin bolsas configuradas nada cambia. */
const SIN_BOLSAS: PiezasPorBolsa = new Map();

/** Piezas totales de una denominación, sueltas o dentro de cualquier precinto. */
export function piezasTotales(
  stock: StockConCartuchos,
  valor: Centimos,
  porCartucho: PiezasPorCartucho,
  porBolsa: PiezasPorBolsa = SIN_BOLSAS
): number {
  const sueltas = stock.sueltas.get(valor) ?? 0;
  const tubos = stock.cartuchos.get(valor) ?? 0;
  const bolsas = stock.bolsas?.get(valor) ?? 0;
  return (
    sueltas + tubos * (porCartucho.get(valor) ?? 0) + bolsas * (porBolsa.get(valor) ?? 0)
  );
}

/** Inventario equivalente con todo abierto. Es el máximo disponible. */
export function inventarioConTodoAbierto(
  stock: StockConCartuchos,
  porCartucho: PiezasPorCartucho,
  porBolsa: PiezasPorBolsa = SIN_BOLSAS
): Inventario {
  const m = new Map(stock.sueltas);
  for (const [valor, tubos] of stock.cartuchos) {
    const n = porCartucho.get(valor) ?? 0;
    if (tubos > 0 && n > 0) m.set(valor, (m.get(valor) ?? 0) + tubos * n);
  }
  for (const [valor, bolsas] of stock.bolsas ?? []) {
    const n = porBolsa.get(valor) ?? 0;
    if (bolsas > 0 && n > 0) m.set(valor, (m.get(valor) ?? 0) + bolsas * n);
  }
  return m;
}

/**
 * Qué precintos hay que romper de UNA denominación para reunir `cantidad`
 * piezas.
 *
 * Orden: **sueltas → bolsas → cartuchos**, siempre, sin mirar tamaños. Es la
 * regla del mostrador: la bolsa es lo que llega del banco y se deshace nada
 * más abrirla; el cartucho es lo que se guarda ordenado para el cajón, y se
 * respeta mientras quede otra cosa que romper.
 *
 * (Antes esto abría el cartucho primero, tomando el envase más pequeño como el
 * más barato de deshacer. En el mostrador no funciona así: un cartucho abierto
 * no se vuelve a hacer, y una bolsa abierta no era nada que conservar.)
 *
 * Devuelve `null` si con todo abierto no llega.
 */
function romperPara(
  valor: Centimos,
  cantidad: number,
  stock: StockConCartuchos,
  porCartucho: PiezasPorCartucho,
  porBolsa: PiezasPorBolsa
): AperturaCartucho | null {
  const sueltas = stock.sueltas.get(valor) ?? 0;
  let faltan = cantidad - sueltas;
  if (faltan <= 0) return null;

  const envases = [
    {
      formato: "bolsa" as const,
      porEnvase: porBolsa.get(valor) ?? 0,
      hay: stock.bolsas?.get(valor) ?? 0,
    },
    {
      formato: "cartucho" as const,
      porEnvase: porCartucho.get(valor) ?? 0,
      hay: stock.cartuchos.get(valor) ?? 0,
    },
  ].filter((e) => e.porEnvase > 0 && e.hay > 0);

  const abiertos = { cartucho: 0, bolsa: 0 };
  let piezas = 0;
  for (const e of envases) {
    if (faltan <= 0) break;
    const n = Math.min(e.hay, Math.ceil(faltan / e.porEnvase));
    abiertos[e.formato] += n;
    piezas += n * e.porEnvase;
    faltan -= n * e.porEnvase;
  }

  // No llega ni abriéndolo todo: quien llame decide qué hacer con el hueco.
  if (faltan > 0) return null;

  // `bolsas` solo aparece si de verdad se ha roto alguna: emitir un 0 en cada
  // apertura ensuciaría la API y la pantalla con un formato que no se usa.
  return {
    valor,
    cartuchos: abiertos.cartucho,
    ...(abiertos.bolsa > 0 ? { bolsas: abiertos.bolsa } : {}),
    piezas,
  };
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
  porCartucho: PiezasPorCartucho,
  porBolsa: PiezasPorBolsa = SIN_BOLSAS
): ResultadoCambioCartuchos {
  const todo = inventarioConTodoAbierto(stock, porCartucho, porBolsa);
  const conTubos = calcularCambio(importe, todo);
  if (esFallo(conTubos)) return conTubos;

  const aperturas: AperturaCartucho[] = [];
  for (const linea of conTubos.lineas) {
    const rota = romperPara(linea.valor, linea.cantidad, stock, porCartucho, porBolsa);
    /* c8 ignore next — si no llega, `calcularCambio` no habría encontrado esta
       solución: el pool sale de este mismo stock. */
    if (rota) aperturas.push(rota);
  }

  return { ok: true, lineas: conTubos.lineas, piezas: conTubos.piezas, aperturas };
}

/** Atajo para las pruebas y la API, que hablan en líneas. */
export function stockDesdeLineas(
  sueltas: readonly LineaDenominacion[],
  cartuchos: readonly LineaDenominacion[] = [],
  bolsas: readonly LineaDenominacion[] = []
): StockConCartuchos {
  return {
    sueltas: inventarioDesdeLineas(sueltas),
    cartuchos: inventarioDesdeLineas(cartuchos),
    bolsas: inventarioDesdeLineas(bolsas),
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
  porCartucho: PiezasPorCartucho,
  porBolsa: PiezasPorBolsa = SIN_BOLSAS
):
  | { ok: true; aperturas: AperturaCartucho[] }
  | { ok: false; valor: Centimos; pedido: number; disponible: number } {
  const aperturas: AperturaCartucho[] = [];

  for (const { valor, cantidad } of entrega) {
    if (cantidad <= 0) continue;
    const sueltas = stock.sueltas.get(valor) ?? 0;
    if (cantidad <= sueltas) continue;

    const rota = romperPara(valor, cantidad, stock, porCartucho, porBolsa);
    if (!rota) {
      return {
        ok: false,
        valor,
        pedido: cantidad,
        disponible: piezasTotales(stock, valor, porCartucho, porBolsa),
      };
    }
    aperturas.push(rota);
  }

  return { ok: true, aperturas };
}
