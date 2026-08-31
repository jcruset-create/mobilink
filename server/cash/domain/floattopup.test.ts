/**
 * Pruebas de la reposición del fondo desde el montón pendiente de ingreso.
 *
 * Es una pieza que decide cuánto dinero se mueve entre dos bolsillos de la
 * tienda, así que se prueba sola y entera, sin base de datos.
 */

import { describe, expect, it } from "vitest";
import { inventarioDesdeLineas, totalInventario } from "./inventory.ts";
import { deficitDeFondo, mejorReposicion } from "./floattopup.ts";

const monton = (...lineas: [number, number][]) =>
  inventarioDesdeLineas(lineas.map(([valor, cantidad]) => ({ valor, cantidad })));

const suma = (lineas: { valor: number; cantidad: number }[]) =>
  lineas.reduce((a, l) => a + l.valor * l.cantidad, 0);

const piezas = (lineas: { valor: number; cantidad: number }[]) =>
  lineas.reduce((a, l) => a + l.cantidad, 0);

describe("cuánto falta para el fondo", () => {
  it("el caso real de Tarragona el 28/08", () => {
    // Fondo fijo 350 €, la caja cerró con 328,48 €.
    expect(deficitDeFondo(35000, 32848)).toBe(2152);
  });

  it("una caja sobrada no tiene déficit", () => {
    expect(deficitDeFondo(35000, 40000)).toBe(0);
    expect(deficitDeFondo(35000, 35000)).toBe(0);
  });

  it("sin fondo fijo configurado NO hay déficit", () => {
    /*
     * Es una decisión, no un descuido: sin objetivo lo que hay es un saldo, y
     * llamar «déficit» a que una caja tenga poco dinero sería inventarse una
     * deuda que nadie ha contraído.
     */
    expect(deficitDeFondo(0, 0)).toBe(0);
    expect(deficitDeFondo(0, 100)).toBe(0);
  });
});

describe("qué piezas se sacan del montón", () => {
  it("repone el déficit exacto cuando el montón puede", () => {
    // 21,52 € = 20 € + 1 € + 0,50 € + 2 × 0,01 €
    const lineas = mejorReposicion(
      monton([2000, 3], [100, 5], [50, 2], [20, 4], [1, 10]),
      2152
    );
    expect(suma(lineas)).toBe(2152);
  });

  it("con las menos piezas posibles", () => {
    /*
     * Reponer 21,52 € con calderilla «suma» igual, pero no es lo mismo para
     * quien tiene que contarlo y meterlo en el cajón.
     */
    const conCalderilla = monton([2000, 1], [100, 1], [50, 1], [1, 300]);
    const lineas = mejorReposicion(conCalderilla, 2152);
    expect(suma(lineas)).toBe(2152);
    // 20 + 1 + 0,50 + 2×0,01 = 5 piezas. Nada más corto es posible.
    expect(piezas(lineas)).toBe(5);
  });

  it("nunca se pasa del déficit", () => {
    // Solo hay un billete de 50 y el déficit son 21,52: no se toca.
    const lineas = mejorReposicion(monton([5000, 2]), 2152);
    expect(lineas).toEqual([]);
  });

  it("repone lo que se pueda cuando no llega, y ni un céntimo más", () => {
    // Con un billete de 20 y nada más, se reponen 20,00 de los 21,52.
    const lineas = mejorReposicion(monton([2000, 1], [5000, 3]), 2152);
    expect(suma(lineas)).toBe(2000);
    expect(suma(lineas)).toBeLessThan(2152);
  });

  it("no se rinde cuando la pieza grande no cabe pero varias pequeñas sí", () => {
    /*
     * Es el caso donde un reparto codicioso se equivoca: cogería el billete de
     * 20 y se quedaría en 20,00 con 1,52 sin reponer, cuando con las monedas
     * se llega justo.
     */
    const lineas = mejorReposicion(
      monton([2000, 1], [200, 10], [100, 2], [50, 1], [1, 2]),
      2152
    );
    expect(suma(lineas)).toBe(2152);
  });

  it("nunca propone más piezas de las que hay en el montón", () => {
    // Con un solo billete de 20, no se puede usar dos veces para llegar a 40.
    const lineas = mejorReposicion(monton([2000, 1]), 4000);
    expect(suma(lineas)).toBe(2000);
    expect(lineas.find((l) => l.valor === 2000)!.cantidad).toBe(1);
  });

  it("respeta el stock de cada denominación", () => {
    const disponible = monton([200, 3], [100, 2]);
    const lineas = mejorReposicion(disponible, 100000);
    for (const l of lineas) {
      expect(l.cantidad).toBeLessThanOrEqual(disponible.get(l.valor) ?? 0);
    }
    expect(suma(lineas)).toBe(totalInventario(disponible));
  });

  it("montón vacío: no se propone nada", () => {
    expect(mejorReposicion(monton(), 2152)).toEqual([]);
  });

  it("sin déficit no se saca nada del montón", () => {
    expect(mejorReposicion(monton([2000, 5]), 0)).toEqual([]);
    expect(mejorReposicion(monton([2000, 5]), -100)).toEqual([]);
  });

  it("un montón enorme no cuelga la pantalla", () => {
    // Un cajón de verdad tiene decenas de piezas; que haya cientos no puede
    // convertir esto en una espera.
    const grande = monton([1, 400], [2, 300], [5, 200], [2000, 50]);
    const inicio = Date.now();
    const lineas = mejorReposicion(grande, 35000);
    expect(Date.now() - inicio).toBeLessThan(2000);
    expect(suma(lineas)).toBeGreaterThan(0);
    expect(suma(lineas)).toBeLessThanOrEqual(35000);
  });
});
