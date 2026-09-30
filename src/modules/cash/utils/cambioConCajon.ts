/**
 * Cambio entre lo pendiente de ingresar y el cajón: la aritmética, sin React.
 *
 * Las piezas son limitadas (hay tres monedas de 1 €, no infinitas), así que
 * componer un importe no se puede hacer a lo voraz: con 50 + 20 + 20 + 20 y
 * un objetivo de 60, el voraz coge el 50 y ya no llega. Se resuelve con
 * programación dinámica, recorriendo de mayor a menor para que, si hay varias
 * formas, gane la de piezas grandes.
 */

import type { LineaDenominacion } from "../types";

export type Cantidades = Record<number, number>;

export const valorDe = (c: Cantidades): number =>
  Object.entries(c).reduce((a, [v, n]) => a + Number(v) * n, 0);

export const lineasDe = (c: Cantidades): LineaDenominacion[] =>
  Object.entries(c)
    .map(([v, n]) => ({ valor: Number(v), cantidad: n }))
    .filter((l) => l.cantidad > 0)
    .sort((a, b) => b.valor - a.valor);

export const cantidadesDe = (lineas: readonly LineaDenominacion[]): Cantidades => {
  const c: Cantidades = {};
  for (const l of lineas) if (l.cantidad > 0) c[l.valor] = (c[l.valor] ?? 0) + l.cantidad;
  return c;
};

/** Las piezas con las que se forma `objetivo`, o `null` si no hay forma exacta. */
export function componer(disponibles: readonly LineaDenominacion[], objetivo: number): Cantidades | null {
  if (objetivo <= 0 || objetivo > 10_000_000) return null;
  const piezas = disponibles.filter((l) => l.cantidad > 0 && l.valor > 0).sort((a, b) => b.valor - a.valor);
  if (piezas.length === 0) return null;

  const via = new Int32Array(objetivo + 1).fill(-1);
  via[0] = -2;
  for (let i = 0; i < piezas.length; i++) {
    const v = piezas[i].valor;
    const usadas = new Int32Array(objetivo + 1);
    for (let s = v; s <= objetivo; s++) {
      if (via[s] !== -1 || via[s - v] === -1) continue;
      const n = via[s - v] === i ? usadas[s - v] + 1 : 1;
      if (n > piezas[i].cantidad) continue;
      via[s] = i;
      usadas[s] = n;
    }
  }
  if (via[objetivo] === -1) return null;

  const c: Cantidades = {};
  for (let s = objetivo; s > 0; ) {
    const v = piezas[via[s]].valor;
    c[v] = (c[v] ?? 0) + 1;
    s -= v;
  }
  return c;
}

/**
 * «Cambio para el cajón»: el cajón da su billete más grande y recibe el mismo
 * importe en piezas más pequeñas de lo pendiente. Es para cuando al cajón le
 * falta cambio y en la bolsa hay billetes pequeños o monedas.
 *
 * Se prueba del billete más grande al más pequeño y se queda con el primero
 * que se pueda pagar entero con piezas menores de lo pendiente, billetes antes
 * que monedas.
 */
export function cambioParaElCajon(
  pendiente: readonly LineaDenominacion[],
  cajon: readonly LineaDenominacion[],
  esBillete: (valor: number) => boolean
): { dePendiente: Cantidades; deCajon: Cantidades } | null {
  const billetesCajon = cajon
    .filter((l) => l.cantidad > 0 && esBillete(l.valor))
    .sort((a, b) => b.valor - a.valor);
  for (const b of billetesCajon) {
    const menores = pendiente.filter((l) => l.valor < b.valor);
    const soloBilletes = componer(
      menores.filter((l) => esBillete(l.valor)),
      b.valor
    );
    const piezas = soloBilletes ?? componer(menores, b.valor);
    if (piezas) return { dePendiente: piezas, deCajon: { [b.valor]: 1 } };
  }
  return null;
}
