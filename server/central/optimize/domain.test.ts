/**
 * Reparto de efectivo entre cajas. Funciones puras.
 *
 * Lo que se fija son los tres criterios que hacen que una propuesta se siga o
 * se ignore: no vaciar a quien cede, no mandar a nadie por cuatro monedas, y
 * decir claramente qué no se puede resolver moviendo.
 */

import { describe, expect, it } from "vitest";
import { repartir, MINIMO_PIEZAS_POR_TRASLADO, type PosicionCaja } from "./domain.ts";

const caja = (
  registerId: number,
  stock: [number, number][],
  necesita: [number, number][]
): PosicionCaja => ({
  registerId,
  centroId: null,
  stock: stock.map(([valor, cantidad]) => ({ valor, cantidad })),
  necesita: necesita.map(([valor, cantidad]) => ({ valor, cantidad })),
});

describe("reparto entre cajas", () => {
  it("cruza lo que sobra en una con lo que falta en otra", () => {
    const r = repartir([
      caja(1, [[100, 200]], [[100, 20]]), // le sobran monedas de 1 €
      caja(2, [[100, 5]], [[100, 60]]), // le faltan
    ]);

    expect(r.traslados).toHaveLength(1);
    const t = r.traslados[0];
    expect(t.desdeRegisterId).toBe(1);
    expect(t.haciaRegisterId).toBe(2);
    expect(t.piezas).toEqual([{ valor: 100, cantidad: 55 }]);
    expect(t.importeCentimos).toBe(5500);
    expect(r.alBanco).toEqual([]);
  });

  /*
   * Dejar a una caja sin margen para socorrer a otra es cambiar el problema de
   * sitio: la semana que viene la que cedió es la que llama.
   */
  it("no vacía a quien cede: le deja su colchón", () => {
    // Tiene 30 y necesita 25: con el margen del 25% no le sobra nada.
    const r = repartir([caja(1, [[100, 30]], [[100, 25]]), caja(2, [[100, 0]], [[100, 50]])]);

    expect(r.traslados).toHaveLength(0);
    expect(r.alBanco[0].registerId).toBe(2);
    expect(r.alBanco[0].piezas).toEqual([{ valor: 100, cantidad: 50 }]);
  });

  /*
   * Mandar a alguien a conducir veinte minutos por diez monedas es una
   * propuesta que nadie sigue, y una propuesta que no se sigue hace que se
   * dejen de mirar todas las demás.
   */
  it("no manda a nadie por cuatro monedas: eso va al banco", () => {
    const r = repartir([
      caja(1, [[20, 100]], [[20, 10]]),
      caja(2, [[20, 0]], [[20, MINIMO_PIEZAS_POR_TRASLADO - 5]]),
    ]);

    expect(r.traslados).toHaveLength(0);
    expect(r.alBanco[0].piezas[0].cantidad).toBe(MINIMO_PIEZAS_POR_TRASLADO - 5);
  });

  it("lo que no se puede cubrir moviendo se dice, no se calla", () => {
    const r = repartir([
      caja(1, [[100, 100]], [[100, 10]]), // puede ceder ~87
      caja(2, [[100, 0]], [[100, 300]]), // necesita 300
    ]);

    expect(r.traslados).toHaveLength(1);
    const cubierto = r.traslados[0].piezas[0].cantidad;
    const pendiente = r.alBanco[0].piezas[0].cantidad;
    expect(cubierto + pendiente).toBe(300);
    expect(pendiente).toBeGreaterThan(0);
  });

  /*
   * Es mejor un traslado que cubre el 80% que cuatro que cubren el 100%:
   * alguien tiene que conducir.
   */
  it("empieza por quien más tiene, para hacer menos viajes", () => {
    const r = repartir([
      caja(1, [[100, 40]], [[100, 5]]), // puede ceder ~34
      caja(2, [[100, 300]], [[100, 5]]), // puede ceder ~294
      caja(3, [[100, 0]], [[100, 100]]),
    ]);

    // Un solo traslado, y del que más tenía.
    expect(r.traslados).toHaveLength(1);
    expect(r.traslados[0].desdeRegisterId).toBe(2);
    expect(r.traslados[0].piezas[0].cantidad).toBe(100);
  });

  /*
   * Mezclar los dos papeles produciría traslados cruzados —A manda a B y B
   * manda a A— que nadie va a hacer.
   */
  it("una caja no se manda piezas a sí misma", () => {
    const r = repartir([caja(1, [[100, 500]], [[100, 10]]), caja(1, [[50, 0]], [[50, 100]])]);
    expect(r.traslados.every((t) => t.desdeRegisterId !== t.haciaRegisterId)).toBe(true);
  });

  it("agrupa varias piezas en un mismo viaje", () => {
    const r = repartir([
      caja(1, [[100, 300], [50, 300]], [[100, 10], [50, 10]]),
      caja(2, [[100, 0], [50, 0]], [[100, 60], [50, 60]]),
    ]);

    expect(r.traslados).toHaveLength(1);
    expect(r.traslados[0].piezas).toHaveLength(2);
    // Ordenadas de mayor a menor valor, como se cuenta el dinero.
    expect(r.traslados[0].piezas[0].valor).toBe(100);
  });

  it("sin cajas o sin necesidades, no propone nada", () => {
    expect(repartir([]).traslados).toEqual([]);
    expect(repartir([caja(1, [[100, 50]], [[100, 10]])]).traslados).toEqual([]);
  });
});
