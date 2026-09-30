import { describe, expect, it } from "vitest";
import { cambioParaElCajon, cantidadesDe, componer, lineasDe, valorDe } from "./cambioConCajon";

const esBillete = (v: number) => v >= 500;

describe("componer un importe con piezas limitadas", () => {
  it("donde el voraz falla: 60 € con un billete de 50 y tres de 20", () => {
    expect(
      componer(
        [
          { valor: 5000, cantidad: 1 },
          { valor: 2000, cantidad: 3 },
        ],
        6000
      )
    ).toEqual({ 2000: 3 });
  });

  it("5 € con las monedas de la maqueta, sin gastar más de las que hay", () => {
    const monedas = [
      { valor: 200, cantidad: 1 },
      { valor: 100, cantidad: 2 },
      { valor: 50, cantidad: 1 },
      { valor: 20, cantidad: 2 },
      { valor: 10, cantidad: 2 },
      { valor: 5, cantidad: 1 },
      { valor: 2, cantidad: 1 },
      { valor: 1, cantidad: 1 },
    ];
    const c = componer(monedas, 500)!;
    expect(valorDe(c)).toBe(500);
    for (const [v, n] of Object.entries(c)) {
      expect(n).toBeLessThanOrEqual(monedas.find((m) => m.valor === Number(v))!.cantidad);
    }
  });

  it("sin forma exacta, null", () => {
    expect(componer([{ valor: 200, cantidad: 2 }], 500)).toBeNull();
    expect(componer([], 100)).toBeNull();
  });

  it("de ida y vuelta entre cantidades y líneas", () => {
    const l = [
      { valor: 500, cantidad: 1 },
      { valor: 1, cantidad: 3 },
    ];
    expect(lineasDe(cantidadesDe(l))).toEqual(l);
  });
});

describe("cambio para el cajón", () => {
  it("el cajón da su billete más grande que se pueda pagar con lo pendiente, billetes antes que monedas", () => {
    const r = cambioParaElCajon(
      [
        { valor: 2000, cantidad: 2 },
        { valor: 1000, cantidad: 1 },
        { valor: 200, cantidad: 10 },
      ],
      [
        { valor: 10000, cantidad: 1 },
        { valor: 5000, cantidad: 2 },
      ],
      esBillete
    )!;
    // 100 € no se puede pagar (hay 70 €); 50 € sí: 20 + 20 + 10, sin tocar las monedas.
    expect(r.deCajon).toEqual({ 5000: 1 });
    expect(r.dePendiente).toEqual({ 2000: 2, 1000: 1 });
  });

  it("si no hay nada que cambiar, null", () => {
    expect(cambioParaElCajon([{ valor: 200, cantidad: 1 }], [{ valor: 5000, cantidad: 1 }], esBillete)).toBeNull();
  });
});
