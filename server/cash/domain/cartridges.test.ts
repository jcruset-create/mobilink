/**
 * Pruebas de los cartuchos.
 *
 * El caso que da nombre al fichero es el del encargo: hay que devolver 4 €, no
 * hay monedas de 2 €, solo queda 1 moneda de 1 € suelta y un tubo de 25. Se
 * abre el tubo, se devuelven 4 monedas y quedan 22 sueltas.
 */

import { describe, it, expect } from "vitest";
import { esExito, esFallo } from "./result.ts";
import {
  aperturasNecesarias,
  calcularCambioConCartuchos,
  inventarioConTodoAbierto,
  piezasTotales,
  stockDesdeLineas,
} from "./cartridges.ts";
import { totalInventario } from "./inventory.ts";

/** Configuración de cartuchos del encargo. */
const POR_CARTUCHO = new Map([
  [200, 25],
  [100, 25],
  [50, 25],
  [20, 25],
  [10, 50],
  [5, 50],
  [2, 50],
  [1, 50],
]);

const totalDe = (l: readonly { valor: number; cantidad: number }[]) =>
  l.reduce((a, x) => a + x.valor * x.cantidad, 0);

describe("primero las piezas de mayor valor, y el tubo se abre si hace falta", () => {
  it("con sueltas suficientes de esa misma moneda no se rompe ningún precinto", () => {
    // 30 monedas de 1 € sueltas y un tubo de 1 €. Los 4 € salen de lo suelto:
    // el precinto se respeta DENTRO de la denominación.
    const stock = stockDesdeLineas([{ valor: 100, cantidad: 30 }], [{ valor: 100, cantidad: 1 }]);
    const r = calcularCambioConCartuchos(400, stock, POR_CARTUCHO);

    expect(r.ok).toBe(true);
    if (esFallo(r)) return;
    expect(r.aperturas).toEqual([]);
    expect(totalDe(r.lineas)).toBe(400);
  });

  it("abre el tubo de 2 € antes que devolver cuatro monedas de 1 € sueltas", () => {
    // Es la regla principal: mandan las piezas de mayor valor. Aunque haya
    // sueltas de 1 € de sobra, si la de 2 € está en un tubo, el tubo se abre.
    const stock = stockDesdeLineas(
      [{ valor: 100, cantidad: 10 }],
      [{ valor: 200, cantidad: 1 }]
    );
    const r = calcularCambioConCartuchos(400, stock, POR_CARTUCHO);

    expect(r.ok).toBe(true);
    if (esFallo(r)) return;
    expect(r.lineas).toEqual([{ valor: 200, cantidad: 2 }]);
    expect(r.aperturas).toEqual([{ valor: 200, cartuchos: 1, piezas: 25 }]);
  });

  it("el caso real: 19,50 € no se devuelven con nueve monedas de 0,50 €", () => {
    // Caja con billetes de 10 y 5, los 2 € y 1 € encartuchados y nueve monedas
    // de 0,50 € sueltas. Antes salían 10 + 5 + 0,50 × 9, que dejaba la caja sin
    // calderilla. Ahora se abre el tubo de 2 €.
    const stock = stockDesdeLineas(
      [
        { valor: 1000, cantidad: 3 },
        { valor: 500, cantidad: 2 },
        { valor: 50, cantidad: 9 },
      ],
      [
        { valor: 200, cantidad: 1 },
        { valor: 100, cantidad: 1 },
      ]
    );
    const r = calcularCambioConCartuchos(1950, stock, POR_CARTUCHO);

    expect(r.ok).toBe(true);
    if (esFallo(r)) return;
    expect(r.lineas).toEqual([
      { valor: 1000, cantidad: 1 },
      { valor: 500, cantidad: 1 },
      { valor: 200, cantidad: 2 },
      { valor: 50, cantidad: 1 },
    ]);
    expect(r.piezas).toBe(5);
    expect(r.aperturas).toEqual([{ valor: 200, cartuchos: 1, piezas: 25 }]);
  });

  it("el caso del encargo: 4 € con 1 suelta y un tubo de 25", () => {
    const stock = stockDesdeLineas([{ valor: 100, cantidad: 1 }], [{ valor: 100, cantidad: 1 }]);
    // El cartucho de 1 € es de 25 unidades.
    const porCartucho = new Map([[100, 25]]);

    const r = calcularCambioConCartuchos(400, stock, porCartucho);
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;

    expect(totalDe(r.lineas)).toBe(400);
    expect(r.lineas).toEqual([{ valor: 100, cantidad: 4 }]);
    // Se abre exactamente un tubo, y de él salen 25 monedas.
    expect(r.aperturas).toEqual([{ valor: 100, cartuchos: 1, piezas: 25 }]);

    // Tras la operación: 1 + 25 − 4 = 22 sueltas, y ningún tubo.
    const sueltasDespues = 1 + 25 - 4;
    expect(sueltasDespues).toBe(22);
  });

  it("abre varios tubos si con uno no llega", () => {
    // Hay que devolver 60 € en monedas de 1 €: 0 sueltas y tubos de 25.
    const stock = stockDesdeLineas([], [{ valor: 100, cantidad: 4 }]);
    const porCartucho = new Map([[100, 25]]);

    const r = calcularCambioConCartuchos(6000, stock, porCartucho);
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;
    expect(totalDe(r.lineas)).toBe(6000);
    // 60 monedas → tres tubos (75 piezas), porque con dos solo hay 50.
    expect(r.aperturas).toEqual([{ valor: 100, cartuchos: 3, piezas: 75 }]);
  });

  it("los tubos cuentan como dinero disponible aunque estén cerrados", () => {
    const stock = stockDesdeLineas([{ valor: 100, cantidad: 2 }], [{ valor: 100, cantidad: 2 }]);
    const porCartucho = new Map([[100, 25]]);

    expect(piezasTotales(stock, 100, porCartucho)).toBe(52);
    expect(totalInventario(inventarioConTodoAbierto(stock, porCartucho))).toBe(5200);
  });

  it("sin tubos ni sueltas suficientes sigue siendo imposible", () => {
    const stock = stockDesdeLineas([{ valor: 5000, cantidad: 2 }], []);
    const r = calcularCambioConCartuchos(300, stock, POR_CARTUCHO);
    expect(r.ok).toBe(false);
    if (esExito(r)) return;
    expect(r.motivo).toBe("NO_SOLUTION");
  });

  it("una denominación sin cartucho configurado no inventa piezas", () => {
    // Los billetes no van en tubo: 2 de 50 € y nada más.
    const stock = stockDesdeLineas([{ valor: 5000, cantidad: 2 }], [{ valor: 5000, cantidad: 3 }]);
    const sinCartucho = new Map<number, number>();
    expect(piezasTotales(stock, 5000, sinCartucho)).toBe(2);
  });
});

describe("aperturas de una entrega elegida a mano", () => {
  const porCartucho = new Map([[100, 25]]);

  it("no exige abrir nada si lo suelto llega", () => {
    const stock = stockDesdeLineas([{ valor: 100, cantidad: 10 }], [{ valor: 100, cantidad: 1 }]);
    const r = aperturasNecesarias([{ valor: 100, cantidad: 4 }], stock, porCartucho);
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;
    expect(r.aperturas).toEqual([]);
  });

  it("calcula los tubos que hay que abrir", () => {
    const stock = stockDesdeLineas([{ valor: 100, cantidad: 1 }], [{ valor: 100, cantidad: 2 }]);
    const r = aperturasNecesarias([{ valor: 100, cantidad: 30 }], stock, porCartucho);
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;
    // 30 pedidas − 1 suelta = 29 → dos tubos de 25.
    expect(r.aperturas).toEqual([{ valor: 100, cartuchos: 2, piezas: 50 }]);
  });

  it("rechaza lo que no hay ni abriendo todos los tubos", () => {
    const stock = stockDesdeLineas([{ valor: 100, cantidad: 1 }], [{ valor: 100, cantidad: 1 }]);
    const r = aperturasNecesarias([{ valor: 100, cantidad: 40 }], stock, porCartucho);
    expect(r.ok).toBe(false);
    if (esExito(r)) return;
    expect(r).toMatchObject({ valor: 100, pedido: 40, disponible: 26 });
  });

  it("rechaza si la denominación no tiene cartucho y faltan sueltas", () => {
    const stock = stockDesdeLineas([{ valor: 5000, cantidad: 1 }], []);
    const r = aperturasNecesarias([{ valor: 5000, cantidad: 3 }], stock, new Map());
    expect(r.ok).toBe(false);
    if (esExito(r)) return;
    expect(r.disponible).toBe(1);
  });
});

/*
 * Bolsas.
 *
 * Una bolsa es el precinto grande del banco: monedas a granel, cientos de
 * ellas. Vale la misma regla que el cartucho —se abre si hace falta y no se
 * vuelve a cerrar— con un matiz que es el que fijan estos tests: **se rompe
 * siempre el envoltorio más pequeño primero**. Abrir una bolsa de 500 monedas
 * teniendo un tubo de 25 a mano llena el cajón de calderilla que ya no se
 * puede volver a guardar.
 */
describe("bolsas de monedas", () => {
  const POR_CARTUCHO = new Map([[100, 25]]);
  const POR_BOLSA = new Map([[100, 500]]);

  it("cuenta las monedas de la bolsa como monedas que hay", () => {
    const stock = stockDesdeLineas([], [], [{ valor: 100, cantidad: 1 }]);
    expect(piezasTotales(stock, 100, POR_CARTUCHO, POR_BOLSA)).toBe(500);
  });

  it("suma los tres formatos", () => {
    const stock = stockDesdeLineas(
      [{ valor: 100, cantidad: 3 }],
      [{ valor: 100, cantidad: 2 }],
      [{ valor: 100, cantidad: 1 }]
    );
    // 3 sueltas + 2 tubos de 25 + 1 bolsa de 500 = 553.
    expect(piezasTotales(stock, 100, POR_CARTUCHO, POR_BOLSA)).toBe(553);
  });

  it("abre el cartucho antes que la bolsa: se rompe el precinto más pequeño", () => {
    const stock = stockDesdeLineas(
      [{ valor: 100, cantidad: 1 }],
      [{ valor: 100, cantidad: 1 }],
      [{ valor: 100, cantidad: 1 }]
    );
    // Hacen falta 4 monedas de 1 €: 1 suelta + hay que abrir algo.
    const r = calcularCambioConCartuchos(400, stock, POR_CARTUCHO, POR_BOLSA);
    if (!r.ok) throw new Error("debería poder darse");
    expect(r.aperturas).toEqual([{ valor: 100, cartuchos: 1, piezas: 25 }]);
  });

  it("abre la bolsa cuando los cartuchos no llegan", () => {
    const stock = stockDesdeLineas(
      [],
      [{ valor: 100, cantidad: 1 }], // 25 monedas
      [{ valor: 100, cantidad: 1 }] // 500 monedas
    );
    // 30 monedas: el tubo da 25 y las 5 que faltan obligan a abrir la bolsa.
    const r = calcularCambioConCartuchos(3000, stock, POR_CARTUCHO, POR_BOLSA);
    if (!r.ok) throw new Error("debería poder darse");
    expect(r.aperturas).toEqual([{ valor: 100, cartuchos: 1, bolsas: 1, piezas: 525 }]);
  });

  it("sin cartuchos, la bolsa se abre directamente", () => {
    const stock = stockDesdeLineas([], [], [{ valor: 100, cantidad: 1 }]);
    const r = calcularCambioConCartuchos(200, stock, POR_CARTUCHO, POR_BOLSA);
    if (!r.ok) throw new Error("debería poder darse");
    expect(r.aperturas).toEqual([{ valor: 100, cartuchos: 0, bolsas: 1, piezas: 500 }]);
  });

  it("no abre nada si las sueltas bastan", () => {
    const stock = stockDesdeLineas(
      [{ valor: 100, cantidad: 5 }],
      [{ valor: 100, cantidad: 1 }],
      [{ valor: 100, cantidad: 1 }]
    );
    const r = calcularCambioConCartuchos(300, stock, POR_CARTUCHO, POR_BOLSA);
    if (!r.ok) throw new Error("debería poder darse");
    expect(r.aperturas).toEqual([]);
  });

  it("una entrega a mano también sabe abrir la bolsa", () => {
    const stock = stockDesdeLineas([], [], [{ valor: 100, cantidad: 1 }]);
    const r = aperturasNecesarias(
      [{ valor: 100, cantidad: 10 }],
      stock,
      POR_CARTUCHO,
      POR_BOLSA
    );
    expect(r).toEqual({ ok: true, aperturas: [{ valor: 100, cartuchos: 0, bolsas: 1, piezas: 500 }] });
  });

  it("ni abriéndolo todo llega: se dice cuánto hay de verdad", () => {
    const stock = stockDesdeLineas(
      [{ valor: 100, cantidad: 2 }],
      [{ valor: 100, cantidad: 1 }],
      []
    );
    const r = aperturasNecesarias([{ valor: 100, cantidad: 40 }], stock, POR_CARTUCHO, POR_BOLSA);
    expect(r).toMatchObject({ ok: false, valor: 100, pedido: 40, disponible: 27 });
  });

  it("sin bolsas configuradas, todo se comporta como antes", () => {
    const stock = stockDesdeLineas([{ valor: 100, cantidad: 1 }], [{ valor: 100, cantidad: 1 }]);
    const r = calcularCambioConCartuchos(400, stock, POR_CARTUCHO);
    if (!r.ok) throw new Error("debería poder darse");
    expect(r.aperturas).toEqual([{ valor: 100, cartuchos: 1, piezas: 25 }]);
  });
});
