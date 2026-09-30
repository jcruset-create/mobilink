/**
 * Qué piezas de la bolsa se llevan al banco, y por tanto cuáles se quedan.
 *
 * El ingreso guarda un importe, pero en la bolsa hay piezas. Para saber en qué
 * monedas se queda lo que no se ingresa —y poder enseñarlo desglosado en la
 * posición global y en la bolsa siguiente— hay que decidir qué piezas forman
 * el importe ingresado.
 *
 * El banco solo admite billetes, así que se busca el importe primero SOLO con
 * billetes. Solo si no sale exacto (alguien ha puesto céntimos, o no hay los
 * billetes justos) se admiten monedas. Si ni así sale, `null`: no se inventa
 * un desglose.
 *
 * Es un problema de monedas con cantidades limitadas. El voraz —el billete
 * más grande que quepa— falla con cantidades limitadas (60 € con 50+20+20+20:
 * coge el de 50 y ya no llega), así que se resuelve con programación dinámica,
 * recorriendo las piezas de mayor a menor para que gane la solución con
 * billetes grandes cuando hay varias.
 */

import type { Centimos } from "./money.ts";
import type { LineaDenominacion } from "./inventory.ts";

/** Límite de la tabla: 100.000 € en céntimos. Por encima no se intenta. */
const MAX_OBJETIVO = 10_000_000;

function componer(
  lineas: readonly LineaDenominacion[],
  objetivo: Centimos
): LineaDenominacion[] | null {
  if (objetivo === 0) return [];
  if (objetivo < 0 || objetivo > MAX_OBJETIVO) return null;

  const piezas = [...lineas]
    .filter((l) => l.cantidad > 0 && l.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  if (piezas.length === 0) return null;

  // Todas las piezas y el objetivo se dividen por su máximo común divisor:
  // con solo billetes la tabla es 500 veces más pequeña.
  const mcd = (a: number, b: number): number => (b === 0 ? a : mcd(b, a % b));
  const paso = piezas.reduce((g, l) => mcd(g, l.valor), objetivo);
  const meta = objetivo / paso;

  // `via[s]` = índice de la pieza con la que se llegó a `s` (−1 = inalcanzable).
  const via = new Int32Array(meta + 1).fill(-1);
  via[0] = -2;
  for (let i = 0; i < piezas.length; i++) {
    const v = piezas[i].valor / paso;
    const usadas = new Int32Array(meta + 1);
    for (let s = v; s <= meta; s++) {
      if (via[s] !== -1) continue;
      const antes = s - v;
      if (via[antes] === -1) continue;
      const n = via[antes] === i ? usadas[antes] + 1 : 1;
      if (n > piezas[i].cantidad) continue;
      via[s] = i;
      usadas[s] = n;
    }
  }
  if (via[meta] === -1) return null;

  const cuenta = new Map<Centimos, number>();
  for (let s = meta; s > 0; ) {
    const i = via[s];
    cuenta.set(piezas[i].valor, (cuenta.get(piezas[i].valor) ?? 0) + 1);
    s -= piezas[i].valor / paso;
  }
  return [...cuenta.entries()]
    .map(([valor, cantidad]) => ({ valor, cantidad }))
    .sort((a, b) => b.valor - a.valor);
}

/**
 * Las piezas con las que se forma `importe`: primero solo billetes, y si no
 * sale, con todo. `null` si no hay forma exacta.
 */
export function piezasDelIngreso(
  bolsa: readonly LineaDenominacion[],
  importe: Centimos,
  esBillete: (valor: Centimos) => boolean
): LineaDenominacion[] | null {
  return componer(bolsa.filter((l) => esBillete(l.valor)), importe) ?? componer(bolsa, importe);
}

/** La bolsa menos lo que se lleva el ingreso. Lo que queda, pieza a pieza. */
export function restarPiezas(
  bolsa: readonly LineaDenominacion[],
  salen: readonly LineaDenominacion[]
): LineaDenominacion[] {
  const quedan = new Map<Centimos, number>();
  for (const l of bolsa) quedan.set(l.valor, (quedan.get(l.valor) ?? 0) + l.cantidad);
  for (const l of salen) quedan.set(l.valor, (quedan.get(l.valor) ?? 0) - l.cantidad);
  return [...quedan.entries()]
    .filter(([, n]) => n > 0)
    .map(([valor, cantidad]) => ({ valor, cantidad }))
    .sort((a, b) => b.valor - a.valor);
}

export const valorDe = (lineas: readonly LineaDenominacion[]): Centimos =>
  lineas.reduce((a, l) => a + l.valor * l.cantidad, 0);
