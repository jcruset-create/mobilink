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
 * ## El desempate: siempre el billete más grande
 *
 * Entre los canjes que convierten lo mismo se elige el que **se lleve el
 * billete más grande posible**. Teniendo 2×20 en el montón y 10 € en monedas,
 * la propuesta es «entrega los dos de 20 y las monedas, llévate el de 50», no
 * «llévate el de 10».
 *
 * Es lo mejor para el cajón, que es quien paga el canje: se queda con los dos
 * billetes de 20 y con la calderilla —que es justo lo que necesita para dar
 * cambio— y suelta el billete gordo, que en un mostrador no sirve para nada
 * salvo para acabar en el banco. Llevarse el de 10 dejaría al cajón con el de
 * 50 muerto de risa y sin los 20.
 *
 * Después del tamaño se mira que sean pocos billetes, y al final que se
 * entreguen muchas piezas.
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

/**
 * Con qué piezas se prefiere rehacer una suma.
 *
 * · `grandes` — para lo que se RECIBE: 50 € es un billete de 50, no 2×20 + 10.
 * · `pequenas` — para lo que se ENTREGA de la propia bolsa: la gracia de
 *   entregar billetes es soltar los pequeños y llevarse gordos, así que 100 €
 *   se rehacen como 3×20 + 3×10 + 2×5 y no como 2×50, que no cambiaría nada.
 */
type Preferencia = "grandes" | "pequenas";

function alcanzables(inv: Inventario, preferencia: Preferencia = "grandes"): Alcanzables {
  const maximo = totalInventario(inv);
  const posible = new Uint8Array(maximo + 1);
  const origen = new Int32Array(maximo + 1).fill(-1);
  const usadas = new Int32Array(maximo + 1);
  posible[0] = 1;

  /*
   * El recorrido marca cada suma la primera vez que la alcanza, así que el
   * orden en que se recorren las denominaciones ES la reconstrucción que sale.
   * Empezando por las grandes, 50 € se rehace como un billete de 50; empezando
   * por las pequeñas, como 2×20 + 10.
   */
  const porValorDesc = [...inv].sort((a, b) =>
    preferencia === "grandes" ? b[0] - a[0] : a[0] - b[0]
  );

  for (const [valor, cantidad] of porValorDesc) {
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
  // Los billetes propios se entregan de PEQUEÑOS a grandes: entregarlos sirve
  // para soltarlos, y rehacer 100 € como 2×50 no soltaría ninguno.
  const propios = alcanzables(billetesPendientes, "pequenas");
  const caja = alcanzables(billetesCaja);

  let mejor: Canje | null = null;

  /*
   * De mayor a menor: la primera `x` que encuentre solución es la máxima, y a
   * partir de ahí solo se siguen probando las `y` de esa misma `x`.
   *
   * `x = 0` entra en el bucle a propósito. Sin monedas que convertir puede
   * seguir habiendo un canje que merezca la pena: juntar los billetes chicos
   * de la bolsa en billetes gordos no ingresa un euro más, pero deja al banco
   * tres billetes en vez de ocho y al cajón la calderilla y los pequeños, que
   * es con lo que da cambio.
   */
  for (let x = monedas.maximo; x >= 0; x--) {
    if (!monedas.posible[x]) continue;

    // `y` crece, así que en cuanto el total se pasa de lo que la caja puede
    // dar, ninguna `y` mayor va a valer.
    for (let y = 0; y + x <= caja.maximo && y <= propios.maximo; y++) {
      if (!propios.posible[y]) continue;
      const total = x + y;
      if (total === 0 || !caja.posible[total]) continue;

      const candidato: Canje = {
        monedasEntregadas: piezasDe(monedas, x),
        billetesEntregados: piezasDe(propios, y),
        billetesRecibidos: piezasDe(caja, total),
        valorMonedasCentimos: x,
        valorCanjeCentimos: total,
      };

      /*
       * Un canje que no convierte monedas tiene que dejar MENOS billetes en la
       * bolsa; si no, es cambiar por cambiar. Es lo que descarta el «entrega un
       * billete de 50 y llévate otro de 50».
       */
      if (x === 0 && cuenta(candidato.billetesRecibidos) >= cuenta(candidato.billetesEntregados)) {
        continue;
      }

      if (mejor === null || preferible(candidato, mejor)) mejor = candidato;
    }

    // Ya se ha encontrado el `x` máximo: no hace falta bajar más.
    if (mejor !== null) break;
  }

  return mejor;
}

const cuenta = (lineas: readonly LineaDenominacion[]) =>
  lineas.reduce((n, l) => n + l.cantidad, 0);

/**
 * Desempate entre canjes que convierten lo mismo.
 *
 * Manda **cuántos billetes quedan en la bolsa**. Como la bolsa es la misma
 * para todos los candidatos, comparar `recibidos − entregados` es comparar el
 * recuento final: entregar ocho billetes y llevarse dos deja seis menos que
 * antes, y entregar tres para llevarse uno solo dos menos. Es lo que hace que
 * la propuesta junte los billetes chicos en gordos en vez de conformarse con
 * el canje más pequeño que cuadre.
 *
 * Y es lo que quiere el mostrador por los dos lados: al banco se va con menos
 * billetes que contar, y el cajón se queda con los pequeños y la calderilla,
 * que es con lo que da cambio.
 *
 * Los otros dos criterios solo entran cuando el primero empata: el billete
 * recibido más grande —que en un mostrador no sirve para nada salvo para
 * acabar en el banco— y más piezas entregadas, que es más cambio para el cajón.
 */
function preferible(a: Canje, b: Canje): boolean {
  const balance = (c: Canje) => cuenta(c.billetesRecibidos) - cuenta(c.billetesEntregados);
  if (balance(a) !== balance(b)) return balance(a) < balance(b);

  const mayor = (c: Canje) => c.billetesRecibidos.reduce((n, l) => Math.max(n, l.valor), 0);
  if (mayor(a) !== mayor(b)) return mayor(a) > mayor(b);

  const entrega = (c: Canje) =>
    totalPiezas(new Map(c.monedasEntregadas.map((l) => [l.valor, l.cantidad]))) +
    cuenta(c.billetesEntregados);
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
