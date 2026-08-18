import { describe, expect, it } from "vitest";
import { DENOMINACIONES_SEMILLA } from "./denominations.ts";
import { inventarioDesdeLineas } from "./inventory.ts";
import { esExito, esFallo } from "./result.ts";
import { composicionSalida, proponerPedidoCambio, type PropuestaPedido } from "./restock.ts";

const DENOMINACIONES = DENOMINACIONES_SEMILLA.map((d, i) => ({ ...d, id: i + 1 }));

const total = (l: readonly { importe: number }[]) => l.reduce((a, x) => a + x.importe, 0);
const linea = (p: PropuestaPedido, valor: number) => p.lineas.find((l) => l.valor === valor);

describe("propuesta de pedido al banco", () => {
  it("pide lo que se gasta y no lo que no", () => {
    // Cinco jornadas: se gastan 200 monedas de 1 € (40/día) y ninguna de 0,01 €.
    const historial = {
      jornadas: 5,
      consumo: [
        { valor: 100, piezas: 200 },
        { valor: 50, piezas: 100 },
      ],
    };
    // En caja quedan 25 monedas de 1 €: media jornada.
    const stock = inventarioDesdeLineas([
      { valor: 100, cantidad: 25 },
      { valor: 50, cantidad: 200 },
    ]);

    const p = proponerPedidoCambio(20000, stock, historial, DENOMINACIONES);

    expect(linea(p, 100)).toBeDefined();
    // La de 1 céntimo no se ha gastado nunca: no se pide, aunque no haya.
    expect(linea(p, 1)).toBeUndefined();
    expect(p.totalCentimos).toBeLessThanOrEqual(20000);
  });

  it("las monedas se piden en tubos enteros", () => {
    const historial = { jornadas: 4, consumo: [{ valor: 100, piezas: 400 }] };
    const stock = inventarioDesdeLineas([{ valor: 100, cantidad: 0 }]);

    const p = proponerPedidoCambio(20000, stock, historial, DENOMINACIONES);
    const l = linea(p, 100)!;

    // El cartucho de 1 € es de 25 monedas.
    expect(l.cartuchos).toBeGreaterThan(0);
    expect(l.piezas).toBe(l.cartuchos * 25);
    expect(l.importe).toBe(l.piezas * 100);
  });

  it("nunca se pasa del importe que se va a cambiar", () => {
    const historial = {
      jornadas: 2,
      consumo: [
        { valor: 200, piezas: 400 },
        { valor: 100, piezas: 400 },
        { valor: 50, piezas: 400 },
      ],
    };
    const stock = inventarioDesdeLineas([]);

    for (const importe of [5000, 10000, 20000, 33350]) {
      const p = proponerPedidoCambio(importe, stock, historial, DENOMINACIONES);
      expect(total(p.lineas)).toBe(p.totalCentimos);
      expect(p.totalCentimos).toBeLessThanOrEqual(importe);
      expect(p.totalCentimos + p.sobranteCentimos).toBe(importe);
    }
  });

  it("prioriza lo que antes se va a agotar", () => {
    // De 2 € queda para medio día; de 1 €, para cuatro. Con importe justo para
    // un tubo, tiene que traer el de 2 €.
    const historial = {
      jornadas: 1,
      consumo: [
        { valor: 200, piezas: 50 },
        { valor: 100, piezas: 25 },
      ],
    };
    const stock = inventarioDesdeLineas([
      { valor: 200, cantidad: 25 },
      { valor: 100, cantidad: 100 },
    ]);

    const p = proponerPedidoCambio(5000, stock, historial, DENOMINACIONES);
    expect(p.lineas[0].valor).toBe(200);
  });

  it("no pide billetes grandes: son los que sobran", () => {
    const historial = {
      jornadas: 1,
      consumo: [
        { valor: 5000, piezas: 10 },
        { valor: 100, piezas: 10 },
      ],
    };
    const p = proponerPedidoCambio(20000, inventarioDesdeLineas([]), historial, DENOMINACIONES);

    expect(linea(p, 5000)).toBeUndefined();
    expect(linea(p, 10000)).toBeUndefined();
  });

  it("lo dice claro cuando no hace falta cambio", () => {
    const historial = { jornadas: 5, consumo: [{ valor: 100, piezas: 50 }] };
    // 500 monedas de 1 € para un consumo de 10 al día: sobra de largo.
    const stock = inventarioDesdeLineas([{ valor: 100, cantidad: 500 }]);

    const p = proponerPedidoCambio(20000, stock, historial, DENOMINACIONES);
    expect(p.lineas).toEqual([]);
    expect(p.aviso).toMatch(/sobrada/);
  });

  it("cada línea explica por qué", () => {
    const historial = { jornadas: 5, consumo: [{ valor: 100, piezas: 200 }] };
    const stock = inventarioDesdeLineas([{ valor: 100, cantidad: 20 }]);

    const p = proponerPedidoCambio(10000, stock, historial, DENOMINACIONES);
    expect(p.lineas[0].motivo).toMatch(/40 piezas de 1 € al día/);
    expect(p.lineas[0].motivo).toMatch(/quedan 20/);
  });
});

describe("composición de la salida al banco", () => {
  it("suelta los billetes más grandes que hay", () => {
    const stock = inventarioDesdeLineas([
      { valor: 5000, cantidad: 3 },
      { valor: 2000, cantidad: 5 },
      { valor: 1000, cantidad: 5 },
    ]);

    const r = composicionSalida(20000, stock);
    expect(r.ok).toBe(true);
    if (!esExito(r)) return;
    // Los tres de 50 € que hay, y el resto con los siguientes más grandes.
    expect(r.lineas).toEqual([
      { valor: 5000, cantidad: 3 },
      { valor: 2000, cantidad: 2 },
      { valor: 1000, cantidad: 1 },
    ]);
  });

  it("completa con billetes menores cuando no llega con los grandes", () => {
    const stock = inventarioDesdeLineas([
      { valor: 5000, cantidad: 1 },
      { valor: 2000, cantidad: 2 },
      { valor: 1000, cantidad: 3 },
    ]);

    const r = composicionSalida(11000, stock);
    expect(r.ok).toBe(true);
    if (!esExito(r)) return;
    expect(r.lineas).toEqual([
      { valor: 5000, cantidad: 1 },
      { valor: 2000, cantidad: 2 },
      { valor: 1000, cantidad: 2 },
    ]);
  });

  it("no compone un importe imposible con los billetes que hay", () => {
    // Solo billetes de 50 €: 30 € no se pueden componer.
    const stock = inventarioDesdeLineas([{ valor: 5000, cantidad: 2 }]);
    const r = composicionSalida(3000, stock);

    expect(r.ok).toBe(false);
    if (!esFallo(r)) return;
    expect(r.mensaje).toMatch(/No se puede componer/);
  });

  it("no toca la calderilla para pagar el pedido", () => {
    // Hay monedas de sobra, pero al banco se va con billetes: llevarse las
    // monedas sería justo lo contrario de ir a buscar cambio.
    const stock = inventarioDesdeLineas([
      { valor: 2000, cantidad: 10 },
      { valor: 100, cantidad: 500 },
    ]);

    const r = composicionSalida(20000, stock);
    expect(r.ok).toBe(true);
    if (!esExito(r)) return;
    expect(r.lineas).toEqual([{ valor: 2000, cantidad: 10 }]);
  });
});
