/**
 * Inventario de efectivo por denominación.
 *
 * Un inventario es "cuántas piezas hay de cada valor". Se indexa por VALOR en
 * céntimos y no por id de denominación a propósito: el valor es la clave
 * natural (no puede haber dos denominaciones de 20 €) y es lo que necesita el
 * algoritmo de cambio. La traducción valor ↔ id la hace el repositorio al
 * guardar, que es su trabajo.
 *
 * Todas las funciones son puras: devuelven un inventario nuevo y no tocan el
 * que reciben. Un inventario compartido que alguien muta por el camino es
 * exactamente la clase de error que este módulo no se puede permitir.
 */

import { type Centimos, sumar } from "./money.ts";

/** Línea de denominación tal y como viaja por la API y por la interfaz. */
export type LineaDenominacion = {
  /** Valor unitario en céntimos. */
  valor: Centimos;
  /** Número de piezas. Siempre entero y no negativo. */
  cantidad: number;
};

/** Piezas disponibles por valor. */
export type Inventario = ReadonlyMap<Centimos, number>;

export const INVENTARIO_VACIO: Inventario = new Map();

export class ErrorInventario extends Error {
  constructor(
    message: string,
    /** Código estable para que la interfaz reaccione sin leer el texto. */
    readonly codigo: "CANTIDAD_NO_VALIDA" | "STOCK_INSUFICIENTE" | "DENOMINACION_DESCONOCIDA",
    readonly detalle?: { valor: Centimos; pedido: number; disponible: number }
  ) {
    super(message);
    this.name = "ErrorInventario";
  }
}

function exigirCantidad(cantidad: unknown, valor: Centimos): number {
  if (typeof cantidad !== "number" || !Number.isSafeInteger(cantidad) || cantidad < 0) {
    throw new ErrorInventario(
      `Cantidad no válida para la denominación de ${valor} céntimos: ${String(cantidad)}`,
      "CANTIDAD_NO_VALIDA"
    );
  }
  return cantidad;
}

/**
 * Construye un inventario a partir de líneas sueltas, sumando las repetidas y
 * descartando las de cantidad cero (un cero no es información: es ausencia).
 */
export function inventarioDesdeLineas(lineas: readonly LineaDenominacion[]): Inventario {
  const m = new Map<Centimos, number>();
  for (const l of lineas) {
    const cantidad = exigirCantidad(l.cantidad, l.valor);
    if (cantidad === 0) continue;
    m.set(l.valor, (m.get(l.valor) ?? 0) + cantidad);
  }
  return m;
}

/** Vuelta a líneas, de mayor a menor valor: el orden en que se cuenta una caja. */
export function lineasDesdeInventario(inv: Inventario): LineaDenominacion[] {
  return [...inv.entries()]
    .filter(([, cantidad]) => cantidad !== 0)
    .map(([valor, cantidad]) => ({ valor, cantidad }))
    .sort((a, b) => b.valor - a.valor);
}

/** Importe total del inventario. */
export function totalInventario(inv: Inventario): Centimos {
  return sumar(...[...inv.entries()].map(([valor, cantidad]) => valor * cantidad));
}

/** Número total de piezas. Lo que distingue 100 € en un billete de 100 € en monedas. */
export function totalPiezas(inv: Inventario): number {
  let n = 0;
  for (const cantidad of inv.values()) n += cantidad;
  return n;
}

export function cantidadDe(inv: Inventario, valor: Centimos): number {
  return inv.get(valor) ?? 0;
}

export function estaVacio(inv: Inventario): boolean {
  for (const cantidad of inv.values()) if (cantidad !== 0) return false;
  return true;
}

/** Suma dos inventarios pieza a pieza. */
export function sumarInventarios(a: Inventario, b: Inventario): Inventario {
  const m = new Map(a);
  for (const [valor, cantidad] of b) {
    const total = (m.get(valor) ?? 0) + cantidad;
    if (total === 0) m.delete(valor);
    else m.set(valor, total);
  }
  return m;
}

/**
 * Comprueba si `b` cabe dentro de `a`. Devuelve la lista de faltantes en vez de
 * un booleano porque la interfaz tiene que poder decir QUÉ falta, no solo que
 * algo falla: "no hay suficientes billetes de 50 €" es accionable, "stock
 * insuficiente" no.
 */
export function faltantes(
  a: Inventario,
  b: Inventario
): { valor: Centimos; pedido: number; disponible: number }[] {
  const falta: { valor: Centimos; pedido: number; disponible: number }[] = [];
  for (const [valor, pedido] of b) {
    const disponible = a.get(valor) ?? 0;
    if (pedido > disponible) falta.push({ valor, pedido, disponible });
  }
  return falta.sort((x, y) => y.valor - x.valor);
}

export function cabeDentro(a: Inventario, b: Inventario): boolean {
  return faltantes(a, b).length === 0;
}

/**
 * Resta `b` de `a` exigiendo que haya existencias. Nunca deja cantidades
 * negativas en silencio: si no hay piezas, es un error, no un saldo en rojo.
 */
export function restarInventarios(a: Inventario, b: Inventario): Inventario {
  const falta = faltantes(a, b);
  if (falta.length > 0) {
    const primero = falta[0];
    throw new ErrorInventario(
      `No hay suficientes piezas de ${primero.valor} céntimos: se piden ${primero.pedido} y hay ${primero.disponible}`,
      "STOCK_INSUFICIENTE",
      primero
    );
  }
  const m = new Map(a);
  for (const [valor, cantidad] of b) {
    const resto = (m.get(valor) ?? 0) - cantidad;
    if (resto === 0) m.delete(valor);
    else m.set(valor, resto);
  }
  return m;
}

/**
 * Diferencia por denominación entre lo contado y lo teórico. Positivo = sobra.
 *
 * Recorre la unión de los dos inventarios: una denominación que aparece contada
 * pero no en el teórico (o al revés) es justo la que interesa ver en un arqueo.
 */
export function diferenciaPorDenominacion(
  teorico: Inventario,
  contado: Inventario
): { valor: Centimos; teorico: number; contado: number; diferencia: number }[] {
  const valores = new Set<Centimos>([...teorico.keys(), ...contado.keys()]);
  return [...valores]
    .map((valor) => {
      const t = teorico.get(valor) ?? 0;
      const c = contado.get(valor) ?? 0;
      return { valor, teorico: t, contado: c, diferencia: c - t };
    })
    .sort((a, b) => b.valor - a.valor);
}
