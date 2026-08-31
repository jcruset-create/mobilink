/**
 * Reponer el fondo de la caja con el dinero que espera para ir al banco.
 *
 * Una jornada puede cerrar con menos efectivo del que la caja necesita para
 * trabajar: se ingresó de más, o se pagó algo del cajón. Ese dinero no se ha
 * perdido —está en el montón que espera para el banco— y devolverlo al cajón
 * es un **traspaso entre dos bolsillos de la misma tienda**: el montón baja,
 * el cajón sube, y el efectivo total no se mueve.
 *
 * Por qué de ahí y no de los cobros del día siguiente: porque con los cobros,
 * parte de lo que entra por caja deja de ser venta y pasa a ser reposición de
 * cambio, y eso ensucia la conciliación con la ERP. Desde el montón, la
 * reposición no es una venta y no se cuela en el cierre por secciones.
 *
 * ## Qué se elige, y por qué en ese orden
 *
 * 1. **Lo más cerca posible del déficit, sin pasarse.** Pasarse dejaría la
 *    caja con más fondo del que tiene configurado, que es el problema al
 *    revés. Quedarse corto se admite —se repone lo que se pueda y se sigue
 *    avisando por el resto— porque el montón puede no tener las piezas justas.
 *
 * 2. **Con las menos piezas posibles.** Reponer 21,52 € con dos monedas de
 *    diez y un puñado de calderilla es correcto; hacerlo con 2.152 monedas de
 *    un céntimo también «suma», y no es lo mismo para quien tiene que contarlo.
 *
 * No se prefieren monedas ni billetes a propósito. Aquí lo que necesita el
 * cajón es VALOR, no formato: el formato ya lo arregla el canje, que existe
 * justamente para eso.
 */

import type { Centimos } from "./money.ts";
import {
  type Inventario,
  type LineaDenominacion,
  lineasDesdeInventario,
} from "./inventory.ts";

/**
 * Tope de la búsqueda, en céntimos.
 *
 * El déficit de una caja de mostrador son decenas o cientos de euros; con un
 * fondo de 350 € no puede pasar de 35.000. El límite está para que un dato
 * absurdo —un fondo mal tecleado de un millón— no monte una tabla enorme, no
 * porque se espere llegar aquí.
 */
const MAXIMO_BUSQUEDA = 200_000;

/**
 * Las piezas que se sacan del montón para reponer el fondo.
 *
 * Devuelve la lista vacía cuando no se puede reponer nada: el montón está
 * vacío, o su pieza más pequeña ya pasa del déficit.
 */
export function mejorReposicion(
  monton: Inventario,
  deficitCentimos: Centimos
): LineaDenominacion[] {
  if (deficitCentimos <= 0) return [];

  /*
   * El montón, pieza a pieza, de mayor a menor valor.
   *
   * Se desdobla en piezas sueltas para poder resolverlo como una mochila 0/1,
   * que es la única forma en que la reconstrucción de la lista es correcta por
   * construcción: con el bucle acotado y un puntero «de dónde vino» la
   * decomposición puede acabar usando más piezas de una denominación de las
   * que hay, y eso aquí sería proponer sacar del montón algo que no está.
   *
   * El tope existe porque el cajón de un mostrador tiene decenas de piezas, no
   * miles; si alguna vez hubiera más, se resuelve con las de más valor, que es
   * lo que llega antes al déficit.
   */
  const MAXIMO_PIEZAS = 512;
  const items: Centimos[] = [];
  for (const [valor, cantidad] of [...monton.entries()].sort((a, b) => b[0] - a[0])) {
    if (valor <= 0 || cantidad <= 0) continue;
    for (let i = 0; i < cantidad && items.length < MAXIMO_PIEZAS; i++) items.push(valor);
  }
  if (items.length === 0) return [];

  const tope = Math.min(deficitCentimos, MAXIMO_BUSQUEDA);

  /*
   * Para cada importe alcanzable, con cuántas piezas se llega. No basta con
   * saber si se alcanza: entre dos formas de reponer 21,52 € se quiere la de
   * dos monedas, no la de doscientas.
   */
  const INALCANZABLE = 0x7fffffff;
  const coste = new Int32Array(tope + 1).fill(INALCANZABLE);
  coste[0] = 0;

  // Un bit por (pieza, importe): si esa pieza se usó para el mejor coste de
  // ese importe. Es lo que permite rehacer la lista exacta al final.
  const anchoBits = tope + 1;
  const tomado = new Uint8Array(items.length * Math.ceil(anchoBits / 8));
  const marcar = (i: number, importe: number) => {
    const base = i * Math.ceil(anchoBits / 8);
    tomado[base + (importe >> 3)] |= 1 << (importe & 7);
  };
  const seTomo = (i: number, importe: number) => {
    const base = i * Math.ceil(anchoBits / 8);
    return (tomado[base + (importe >> 3)] & (1 << (importe & 7))) !== 0;
  };

  for (let i = 0; i < items.length; i++) {
    const valor = items[i];
    if (valor > tope) continue;
    // Descendente: cada pieza se usa como mucho una vez, que es lo que la hace
    // 0/1 y lo que respeta el stock del montón.
    for (let importe = tope; importe >= valor; importe--) {
      const previo = coste[importe - valor];
      if (previo === INALCANZABLE) continue;
      if (previo + 1 < coste[importe]) {
        coste[importe] = previo + 1;
        marcar(i, importe);
      }
    }
  }

  let mejor = 0;
  for (let importe = tope; importe > 0; importe--) {
    if (coste[importe] !== INALCANZABLE) {
      mejor = importe;
      break;
    }
  }
  if (mejor === 0) return [];

  /*
   * Se rehace hacia atrás, de la última pieza a la primera: en el momento en
   * que se marcó la pieza `i` para el importe, el resto venía de las piezas
   * anteriores, así que basta con recorrerlas en orden inverso.
   */
  const elegidas = new Map<Centimos, number>();
  let restante = mejor;
  for (let i = items.length - 1; i >= 0 && restante > 0; i--) {
    if (!seTomo(i, restante)) continue;
    const valor = items[i];
    elegidas.set(valor, (elegidas.get(valor) ?? 0) + 1);
    restante -= valor;
  }
  // Si la reconstrucción no llega a cero, algo no cuadra y es mejor no
  // proponer nada que proponer una lista que no suma lo que dice.
  if (restante !== 0) return [];

  return lineasDesdeInventario(elegidas);
}


/**
 * El déficit de fondo de una caja: lo que le falta para su fondo fijo.
 *
 * Cero cuando la caja va sobrada o justa, y cero también cuando la caja no
 * tiene fondo fijo configurado: sin objetivo no hay déficit posible, solo un
 * saldo, y llamarlo déficit sería inventarse una deuda.
 */
export function deficitDeFondo(
  fondoObjetivoCentimos: Centimos,
  efectivoEnCajaCentimos: Centimos
): Centimos {
  if (fondoObjetivoCentimos <= 0) return 0;
  return Math.max(0, fondoObjetivoCentimos - efectivoEnCajaCentimos);
}
