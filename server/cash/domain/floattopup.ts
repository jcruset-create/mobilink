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
 * ## Con vuelta, para que cuadre siempre
 *
 * La bolsa no suele tener las piezas justas. Con un déficit de 21,52 € y un
 * montón de `50 + 10 + 10 + 2 + 0,50 + 0,10`, no hay forma de sumar 21,52
 * exactos: lo más que se puede sacar sin pasarse son 20,60 € y la caja se
 * queda 92 céntimos coja, con el problema aplazado a mañana.
 *
 * Así que la reposición tiene DOS SENTIDOS, como el canje: sale del montón lo
 * que haga falta y el cajón devuelve la vuelta.
 *
 *     del montón al cajón:   X
 *     del cajón al montón:   Y      (la vuelta)
 *                          ─────
 *          efecto neto:    X − Y  =  el déficit, exacto
 *
 * Con el ejemplo: salen 22,00 € del montón (10 + 10 + 2), vuelven 0,48 € en
 * monedas del cajón, y el fondo queda repuesto al céntimo. Es el canje de
 * siempre con `X − Y = déficit` en vez de `X − Y = 0`.
 *
 * ## Qué se elige, y por qué en ese orden
 *
 * 1. **Sin vuelta, si se puede.** Menos manos en el cajón, menos errores.
 * 2. **La vuelta más pequeña posible.** Se prueban los importes del montón de
 *    menor a mayor a partir del déficit: el primero que el cajón sepa devolver
 *    es el que menos calderilla le saca.
 * 3. **Con las menos piezas posibles**, a ambos lados.
 */

import type { Centimos } from "./money.ts";
import {
  type Inventario,
  type LineaDenominacion,
  lineasDesdeInventario,
} from "./inventory.ts";
import { calcularCambio } from "./change.ts";

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
 * La mochila del montón, resuelta una vez y consultable para cualquier importe.
 *
 * Se desdobla el montón en piezas sueltas y se resuelve como una mochila 0/1:
 * es la única forma en que la reconstrucción de la lista es correcta por
 * construcción. Con el bucle acotado y un puntero «de dónde vino», la
 * descomposición puede acabar usando más piezas de una denominación de las que
 * hay, y eso aquí sería proponer sacar del montón algo que no está.
 */
function mochilaDelMonton(monton: Inventario, tope: number) {
  const MAXIMO_PIEZAS = 512;
  const items: Centimos[] = [];
  for (const [valor, cantidad] of [...monton.entries()].sort((a, b) => b[0] - a[0])) {
    if (valor <= 0 || cantidad <= 0) continue;
    for (let i = 0; i < cantidad && items.length < MAXIMO_PIEZAS; i++) items.push(valor);
  }

  const INALCANZABLE = 0x7fffffff;
  const coste = new Int32Array(tope + 1).fill(INALCANZABLE);
  coste[0] = 0;

  // Un bit por (pieza, importe): si esa pieza se usó para el mejor coste de
  // ese importe. Es lo que permite rehacer la lista exacta al final.
  const bytesPorPieza = Math.ceil((tope + 1) / 8);
  const tomado = new Uint8Array(items.length * bytesPorPieza);
  const seTomo = (i: number, importe: number) =>
    (tomado[i * bytesPorPieza + (importe >> 3)] & (1 << (importe & 7))) !== 0;

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
        tomado[i * bytesPorPieza + (importe >> 3)] |= 1 << (importe & 7);
      }
    }
  }

  return {
    alcanzable: (importe: number) => importe >= 0 && importe <= tope && coste[importe] !== INALCANZABLE,
    /** Las piezas que suman ese importe, o `null` si no se alcanza. */
    piezasPara(importe: number): LineaDenominacion[] | null {
      if (importe === 0) return [];
      if (!this.alcanzable(importe)) return null;
      const elegidas = new Map<Centimos, number>();
      let restante = importe;
      /*
       * Se rehace hacia atrás, de la última pieza a la primera: en el momento
       * en que se marcó la pieza `i` para el importe, el resto venía de las
       * piezas anteriores, así que basta con recorrerlas en orden inverso.
       */
      for (let i = items.length - 1; i >= 0 && restante > 0; i--) {
        if (!seTomo(i, restante)) continue;
        elegidas.set(items[i], (elegidas.get(items[i]) ?? 0) + 1);
        restante -= items[i];
      }
      // Si no llega a cero, algo no cuadra: mejor no proponer nada que
      // proponer una lista que no suma lo que dice.
      return restante === 0 ? lineasDesdeInventario(elegidas) : null;
    },
  };
}

/** Lo que sale del montón, lo que vuelve del cajón, y el neto que repone. */
export type Reposicion = {
  /** Piezas que salen del montón pendiente hacia el cajón. */
  sacar: LineaDenominacion[];
  /** Piezas que el cajón devuelve al montón. Vacío = sin vuelta. */
  devolver: LineaDenominacion[];
  /** `sacar − devolver`. Es lo que sube el fondo de la caja. */
  netoCentimos: Centimos;
};

/**
 * Cómo reponer el fondo, con vuelta si hace falta.
 *
 * Devuelve `null` cuando no se puede reponer nada. Si no se llega al déficit
 * exacto ni con vuelta, se devuelve lo más cerca que se pueda por debajo: la
 * caja se queda algo mejor y el resto se avisa.
 */
export function mejorReposicion(
  monton: Inventario,
  caja: Inventario,
  deficitCentimos: Centimos
): Reposicion | null {
  if (deficitCentimos <= 0) return null;

  /*
   * Hasta dónde merece la pena pasarse al sacar del montón.
   *
   * Nunca hace falta pasarse más que la pieza más grande de la bolsa: si el
   * exceso llegara a valer tanto como esa pieza, se podría quitar la pieza y
   * seguir cubriendo el déficit. Con ese tope la búsqueda es completa sin
   * explorar importes que jamás serían la respuesta.
   */
  let mayor = 0;
  for (const [valor, cantidad] of monton) if (cantidad > 0 && valor > mayor) mayor = valor;
  if (mayor === 0) return null;

  const tope = Math.min(deficitCentimos + mayor, MAXIMO_BUSQUEDA);
  const mochila = mochilaDelMonton(monton, tope);

  /*
   * Se prueban los importes de menor a mayor a partir del déficit: el primero
   * que cuadre es, por construcción, el de menos vuelta. El déficit exacto se
   * prueba el primero, así que «sin vuelta» siempre gana cuando es posible.
   */
  for (let sale = deficitCentimos; sale <= tope; sale++) {
    if (!mochila.alcanzable(sale)) continue;
    const sacar = mochila.piezasPara(sale);
    if (!sacar) continue;

    const vuelta = sale - deficitCentimos;
    if (vuelta === 0) return { sacar, devolver: [], netoCentimos: deficitCentimos };

    // La vuelta la resuelve el motor de cambio de siempre: combinación exacta
    // con el stock que hay de verdad en el cajón, o no hay vuelta posible.
    const cambio = calcularCambio(vuelta, caja, "menos_piezas");
    if (cambio.ok) return { sacar, devolver: cambio.lineas, netoCentimos: deficitCentimos };
  }

  /*
   * Ni con vuelta se llega al déficit exacto. Se repone lo que se pueda sin
   * pasarse, que deja la caja mejor que estaba, y quien mire la pantalla verá
   * cuánto queda pendiente.
   */
  for (let sale = deficitCentimos - 1; sale > 0; sale--) {
    if (!mochila.alcanzable(sale)) continue;
    const sacar = mochila.piezasPara(sale);
    if (sacar) return { sacar, devolver: [], netoCentimos: sale };
  }

  return null;
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
