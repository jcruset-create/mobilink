/**
 * Canje de monedas por billetes para poder ingresar en el banco.
 *
 * El banco solo admite billetes. Lo que espera para ir al banco —los cierres
 * pendientes— tiene una composición concreta, y la parte que está en monedas
 * no se puede ingresar. La forma de convertirla es cambiarla por billetes del
 * cajón: entregas monedas, te llevas un billete. La caja no gana ni pierde
 * valor, y encima se queda con calderilla, que es justo lo que necesita para
 * dar cambio.
 *
 * ## Qué se optimiza, y por qué es una sola cosa
 *
 * Un canje entrega `x` en monedas más, opcionalmente, `y` en billetes del
 * propio montón, y recibe `x + y` en billetes de la caja. Al final el montón
 * tiene sus billetes de antes, menos `y`, más `x + y`:
 *
 *     billetes finales = billetes − y + (x + y) = billetes + x
 *
 * O sea: **el ingreso sube exactamente `x`, y `y` no influye**. Meter billetes
 * propios en el canje no ingresa un euro más. Lo que hace es DESBLOQUEAR un
 * billete más grande de la caja cuando no hay uno pequeño: sin billete de 10 no
 * puedes convertir 10 € en monedas, pero entregando además dos billetes de 20
 * sí puedes llevarte uno de 50.
 *
 * Así que el objetivo principal es uno y solo uno: **maximizar `x`**, el valor
 * en monedas que se convierte.
 *
 * Como criterio de desempate, entre los canjes que consiguen el mismo `x` se
 * prefiere el que deje a la caja MÁS piezas y se lleve MENOS billetes: el cajón
 * quiere calderilla y billetes pequeños, no un billete de 50. Es lo que hace
 * que, pudiendo elegir, salga «entrega 2×20 + 10 € en monedas, llévate el 50»
 * en vez de «llévate el 10».
 */

import type { Centimos } from "./money.ts";
import {
  type Inventario,
  type LineaDenominacion,
  lineasDesdeInventario,
  totalInventario,
  totalPiezas,
} from "./inventory.ts";

export type Canje = {
  /** Monedas que salen del montón pendiente hacia la caja. */
  monedasEntregadas: LineaDenominacion[];
  /** Billetes del montón que se entregan para alcanzar una cifra canjeable. */
  billetesEntregados: LineaDenominacion[];
  /** Billetes que salen de la caja hacia el montón. */
  billetesRecibidos: LineaDenominacion[];
  /** Lo que sube el ingreso: el valor de las monedas convertidas. */
  valorMonedasCentimos: Centimos;
  /** Valor total que cambia de manos en cada sentido. Iguales por definición. */
  valorCanjeCentimos: Centimos;
};

/**
 * Sumas que se pueden formar con un inventario, y con qué piezas.
 *
 * Recorrido clásico de mochila acotada: por cada denominación se prueban todas
 * sus unidades. `origen[s]` guarda con qué denominación y cuántas piezas se
 * llegó a `s` la primera vez, que es suficiente para reconstruir el conjunto
 * andando hacia atrás.
 */
type Alcanzables = {
  posible: Uint8Array;
  origen: Int32Array;
  /** Cuántas piezas de esa denominación se usaron para llegar. */
  usadas: Int32Array;
  maximo: Centimos;
};

function alcanzables(inv: Inventario): Alcanzables {
  const maximo = totalInventario(inv);
  const posible = new Uint8Array(maximo + 1);
  const origen = new Int32Array(maximo + 1).fill(-1);
  const usadas = new Int32Array(maximo + 1);
  posible[0] = 1;

  for (const [valor, cantidad] of inv) {
    if (valor <= 0 || cantidad <= 0) continue;
    /*
     * Se recorre a la BAJA sobre una foto de lo que ya era alcanzable sin esta
     * denominación. Hacerlo al alza reutilizaría las piezas recién colocadas y
     * daría por alcanzables sumas que necesitan más monedas de las que hay.
     */
    const antes = Uint8Array.from(posible);
    for (let s = maximo; s >= 0; s--) {
      if (!antes[s]) continue;
      for (let k = 1; k <= cantidad; k++) {
        const destino = s + k * valor;
        if (destino > maximo) break;
        if (posible[destino]) continue;
        posible[destino] = 1;
        origen[destino] = valor;
        usadas[destino] = k;
      }
    }
  }

  return { posible, origen, usadas, maximo };
}

/** Rehace las piezas con las que se llegó a `suma`. */
function piezasDe(a: Alcanzables, suma: Centimos): LineaDenominacion[] {
  const lineas: LineaDenominacion[] = [];
  let s = suma;
  while (s > 0) {
    const valor = a.origen[s];
    // No debería pasar: solo se pregunta por sumas marcadas como alcanzables.
    if (valor <= 0) return [];
    lineas.push({ valor, cantidad: a.usadas[s] });
    s -= valor * a.usadas[s];
  }
  return lineas.sort((x, y) => y.valor - x.valor);
}

/**
 * El mejor canje posible, o `null` si no hay ninguno.
 *
 * `null` significa que con los billetes que hay en la caja no se puede
 * convertir ni una moneda: el ingreso va solo con los billetes que ya están en
 * el montón y el resto se queda esperando a que la caja tenga cambio.
 */
export function mejorCanje(
  monedasPendientes: Inventario,
  billetesPendientes: Inventario,
  billetesCaja: Inventario
): Canje | null {
  const monedas = alcanzables(monedasPendientes);
  const propios = alcanzables(billetesPendientes);
  const caja = alcanzables(billetesCaja);

  let mejor: Canje | null = null;

  // De mayor a menor: la primera `x` que encuentre solución es la máxima, y a
  // partir de ahí solo se siguen probando las `y` de esa misma `x`.
  for (let x = monedas.maximo; x >= 1; x--) {
    if (!monedas.posible[x]) continue;

    for (let y = 0; y <= propios.maximo; y++) {
      if (!propios.posible[y]) continue;
      const total = x + y;
      if (total > caja.maximo || !caja.posible[total]) continue;

      const candidato: Canje = {
        monedasEntregadas: piezasDe(monedas, x),
        billetesEntregados: piezasDe(propios, y),
        billetesRecibidos: piezasDe(caja, total),
        valorMonedasCentimos: x,
        valorCanjeCentimos: total,
      };

      if (mejor === null || preferible(candidato, mejor)) mejor = candidato;
    }

    // Ya se ha encontrado el `x` máximo: no hace falta bajar más.
    if (mejor !== null) break;
  }

  return mejor;
}

/**
 * Desempate entre canjes que convierten lo mismo.
 *
 * Gana el que deje a la caja más piezas de las que sirven para dar cambio: se
 * mira primero cuántos billetes se lleva —cuantos menos, más grandes son— y
 * después cuántas piezas se le dejan.
 */
function preferible(a: Canje, b: Canje): boolean {
  const recibe = (c: Canje) => c.billetesRecibidos.reduce((n, l) => n + l.cantidad, 0);
  if (recibe(a) !== recibe(b)) return recibe(a) < recibe(b);

  const entrega = (c: Canje) =>
    totalPiezas(new Map(c.monedasEntregadas.map((l) => [l.valor, l.cantidad]))) +
    c.billetesEntregados.reduce((n, l) => n + l.cantidad, 0);
  return entrega(a) > entrega(b);
}

/**
 * Cómo queda el montón pendiente tras aplicar un canje.
 *
 * Se usa para enseñar el «después» antes de confirmar, y para comprobar en las
 * pruebas que el valor total no se mueve: un canje no crea ni destruye dinero.
 */
export function montonTrasCanje(
  monedas: Inventario,
  billetes: Inventario,
  canje: Canje
): { monedas: LineaDenominacion[]; billetes: LineaDenominacion[] } {
  const quitar = (inv: Inventario, lineas: readonly LineaDenominacion[]) => {
    const m = new Map(inv);
    for (const l of lineas) {
      const queda = (m.get(l.valor) ?? 0) - l.cantidad;
      if (queda > 0) m.set(l.valor, queda);
      else m.delete(l.valor);
    }
    return m;
  };

  const billetesFinales = quitar(billetes, canje.billetesEntregados);
  for (const l of canje.billetesRecibidos) {
    billetesFinales.set(l.valor, (billetesFinales.get(l.valor) ?? 0) + l.cantidad);
  }

  return {
    monedas: lineasDesdeInventario(quitar(monedas, canje.monedasEntregadas)),
    billetes: lineasDesdeInventario(billetesFinales),
  };
}
