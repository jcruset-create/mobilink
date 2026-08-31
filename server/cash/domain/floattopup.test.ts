/**
 * Pruebas de la reposición del fondo desde el montón pendiente de ingreso.
 *
 * Es una pieza que decide cuánto dinero se mueve entre dos bolsillos de la
 * tienda, así que se prueba sola y entera, sin base de datos.
 */

import { describe, expect, it } from "vitest";
import { inventarioDesdeLineas, totalInventario } from "./inventory.ts";
import { deficitDeFondo, mejorReposicion } from "./floattopup.ts";

const inv = (...lineas: [number, number][]) =>
  inventarioDesdeLineas(lineas.map(([valor, cantidad]) => ({ valor, cantidad })));

const suma = (lineas: readonly { valor: number; cantidad: number }[]) =>
  lineas.reduce((a, l) => a + l.valor * l.cantidad, 0);

const piezas = (lineas: readonly { valor: number; cantidad: number }[]) =>
  lineas.reduce((a, l) => a + l.cantidad, 0);

/** Un cajón de mostrador normal, con calderilla de sobra para dar vuelta. */
const CAJON = inv([5000, 2], [2000, 3], [1000, 4], [500, 4], [200, 10], [100, 15], [50, 10], [20, 10], [10, 10], [5, 10], [2, 10], [1, 10]);

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

describe("sin vuelta, cuando el montón tiene las piezas justas", () => {
  it("repone el déficit exacto", () => {
    // 21,52 € = 20 € + 1 € + 0,50 € + 2 × 0,01 €
    const r = mejorReposicion(inv([2000, 3], [100, 5], [50, 2], [20, 4], [1, 10]), CAJON, 2152)!;
    expect(r.netoCentimos).toBe(2152);
    expect(suma(r.sacar)).toBe(2152);
    expect(r.devolver).toEqual([]);
  });

  it("prefiere no dar vuelta aunque pudiera", () => {
    /*
     * Con un montón que puede hacer los 21,52 € justos, sacar un billete de 50
     * y devolver 28,48 € en monedas también «cuadraría», pero mete la mano en
     * el cajón sin necesidad.
     */
    const r = mejorReposicion(inv([5000, 1], [2000, 1], [100, 1], [50, 1], [1, 2]), CAJON, 2152)!;
    expect(r.devolver).toEqual([]);
    expect(suma(r.sacar)).toBe(2152);
  });

  it("con las menos piezas posibles", () => {
    const r = mejorReposicion(inv([2000, 1], [100, 1], [50, 1], [1, 300]), CAJON, 2152)!;
    // 20 + 1 + 0,50 + 2×0,01 = 5 piezas. Nada más corto es posible.
    expect(piezas(r.sacar)).toBe(5);
  });
});

describe("con vuelta, que es lo que hace que cuadre siempre", () => {
  /**
   * El montón real de Tarragona el 31/08: 72,60 € en la bolsa.
   *
   * Con esas piezas NO hay forma de sumar 21,52 € exactos. Sin vuelta, lo más
   * que se puede sacar sin pasarse son 20,60 € y la caja se queda 92 céntimos
   * coja: el déficit no desaparece, solo encoge.
   */
  const MONTON_REAL = inv([5000, 1], [1000, 2], [200, 1], [50, 1], [10, 1]);

  it("el caso real: saca de más y devuelve la vuelta", () => {
    const r = mejorReposicion(MONTON_REAL, CAJON, 2152)!;
    expect(r.netoCentimos).toBe(2152);
    expect(suma(r.sacar) - suma(r.devolver)).toBe(2152);
    expect(r.devolver.length).toBeGreaterThan(0);
  });

  it("y la vuelta es la más pequeña que cuadra", () => {
    /*
     * El primer importe que el montón sabe formar por encima de 21,52 € son
     * 22,00 € (10+10+2), así que la vuelta son 48 céntimos. Sacar el billete
     * de 50 también cuadraría, devolviendo 28,48 €, pero vacía el cajón de
     * calderilla sin ninguna necesidad.
     */
    const r = mejorReposicion(MONTON_REAL, CAJON, 2152)!;
    expect(suma(r.sacar)).toBe(2200);
    expect(suma(r.devolver)).toBe(48);
  });

  it("el neto es SIEMPRE el déficit, ni un céntimo más", () => {
    for (const deficit of [1, 7, 99, 1234, 2152, 5000]) {
      const r = mejorReposicion(MONTON_REAL, CAJON, deficit);
      if (r) expect(r.netoCentimos).toBe(deficit);
    }
  });

  it("si el cajón no tiene con qué dar la vuelta, repone lo que puede", () => {
    // Un cajón con solo billetes de 50 no sabe devolver 48 céntimos.
    const sinCalderilla = inv([5000, 3]);
    const r = mejorReposicion(MONTON_REAL, sinCalderilla, 2152)!;
    expect(r.devolver).toEqual([]);
    // 20,60 € = 10 + 10 + 0,50 + 0,10, lo máximo sin pasarse.
    expect(r.netoCentimos).toBe(2060);
    expect(r.netoCentimos).toBeLessThan(2152);
  });
});

describe("lo que no se puede hacer", () => {
  it("nunca se sacan más piezas de las que hay en el montón", () => {
    const monton = inv([2000, 1]);
    const r = mejorReposicion(monton, CAJON, 4000)!;
    for (const l of r.sacar) {
      expect(l.cantidad).toBeLessThanOrEqual(monton.get(l.valor) ?? 0);
    }
  });

  it("nunca se devuelven más piezas de las que hay en el cajón", () => {
    const cajonJusto = inv([100, 1], [5, 1], [1, 3]);
    const r = mejorReposicion(inv([1000, 1]), cajonJusto, 892);
    if (r) {
      for (const l of r.devolver) {
        expect(l.cantidad).toBeLessThanOrEqual(cajonJusto.get(l.valor) ?? 0);
      }
    }
  });

  it("montón vacío: no se propone nada", () => {
    expect(mejorReposicion(inv(), CAJON, 2152)).toBe(null);
  });

  it("sin déficit no se toca nada", () => {
    expect(mejorReposicion(inv([2000, 5]), CAJON, 0)).toBe(null);
    expect(mejorReposicion(inv([2000, 5]), CAJON, -100)).toBe(null);
  });

  it("el montón entero, si el déficit lo supera", () => {
    const monton = inv([200, 3], [100, 2]);
    const r = mejorReposicion(monton, CAJON, 100000)!;
    expect(suma(r.sacar)).toBe(totalInventario(monton));
    expect(r.devolver).toEqual([]);
  });

  it("un montón enorme no cuelga la pantalla", () => {
    const grande = inv([1, 400], [2, 300], [5, 200], [2000, 50]);
    const inicio = Date.now();
    const r = mejorReposicion(grande, CAJON, 35000);
    expect(Date.now() - inicio).toBeLessThan(3000);
    expect(r).not.toBe(null);
  });
});
