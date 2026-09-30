import { describe, expect, it } from "vitest";
import { piezasDelIngreso, restarPiezas, valorDe } from "./remanente.ts";

const esBillete = (v: number) => v >= 500;

describe("qué piezas se llevan al banco", () => {
  it("el caso de Tarragona: 25 billetes de 50 y quedan 0,21 € en monedas", () => {
    const bolsa = [
      { valor: 5000, cantidad: 25 },
      { valor: 5, cantidad: 2 },
      { valor: 2, cantidad: 4 },
      { valor: 1, cantidad: 3 },
    ];
    const salen = piezasDelIngreso(bolsa, 125000, esBillete)!;
    expect(salen).toEqual([{ valor: 5000, cantidad: 25 }]);
    expect(restarPiezas(bolsa, salen)).toEqual([
      { valor: 5, cantidad: 2 },
      { valor: 2, cantidad: 4 },
      { valor: 1, cantidad: 3 },
    ]);
  });

  it("donde el voraz falla: 60 € con un billete de 50 y tres de 20", () => {
    const bolsa = [
      { valor: 5000, cantidad: 1 },
      { valor: 2000, cantidad: 3 },
    ];
    expect(piezasDelIngreso(bolsa, 6000, esBillete)).toEqual([{ valor: 2000, cantidad: 3 }]);
  });

  it("con varias soluciones, gana la de billetes grandes", () => {
    const bolsa = [
      { valor: 5000, cantidad: 2 },
      { valor: 1000, cantidad: 10 },
    ];
    expect(piezasDelIngreso(bolsa, 10000, esBillete)).toEqual([{ valor: 5000, cantidad: 2 }]);
  });

  it("no toca monedas si con billetes sale exacto", () => {
    const bolsa = [
      { valor: 1000, cantidad: 1 },
      { valor: 200, cantidad: 5 },
    ];
    expect(piezasDelIngreso(bolsa, 1000, esBillete)).toEqual([{ valor: 1000, cantidad: 1 }]);
  });

  it("si el importe lleva céntimos, usa monedas", () => {
    const bolsa = [
      { valor: 1000, cantidad: 1 },
      { valor: 50, cantidad: 3 },
    ];
    const salen = piezasDelIngreso(bolsa, 1050, esBillete)!;
    expect(valorDe(salen)).toBe(1050);
    expect(restarPiezas(bolsa, salen)).toEqual([{ valor: 50, cantidad: 2 }]);
  });

  it("sin forma exacta no se inventa nada", () => {
    expect(piezasDelIngreso([{ valor: 5000, cantidad: 1 }], 2000, esBillete)).toBeNull();
    expect(piezasDelIngreso([{ valor: 2000, cantidad: 1 }], 5000, esBillete)).toBeNull();
  });

  it("no gasta más piezas de las que hay", () => {
    expect(piezasDelIngreso([{ valor: 2000, cantidad: 2 }], 6000, esBillete)).toBeNull();
  });
});
