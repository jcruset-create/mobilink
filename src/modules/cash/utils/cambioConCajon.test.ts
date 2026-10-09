import { describe, expect, it } from "vitest";
import { cambioParaCliente, cambioParaElCajon, cantidadesDe, componer, lineasDe, valorDe } from "./cambioConCajon";

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

describe("cambio para un cliente", () => {
  // Lo pendiente de Tarragona el 09/10: 45,13 €.
  const pendiente = [
    { valor: 2000, cantidad: 1 },
    { valor: 1000, cantidad: 1 },
    { valor: 500, cantidad: 2 },
    { valor: 200, cantidad: 2 },
    { valor: 50, cantidad: 1 },
    { valor: 20, cantidad: 2 },
    { valor: 5, cantidad: 2 },
    { valor: 2, cantidad: 5 },
    { valor: 1, cantidad: 3 },
  ];

  it("un billete de 20 €: 10 + 5 y 5 € en monedas, y quedan 13 céntimos", () => {
    const c = cambioParaCliente(pendiente, 2000, esBillete, [2000])!;
    expect(valorDe(c)).toBe(2000);
    expect(c[1000]).toBe(1);
    expect(c[500]).toBe(1);
    expect(c[2000]).toBeUndefined();
    const enMonedas = Object.entries(c)
      .filter(([v]) => !esBillete(Number(v)))
      .reduce((a, [v, n]) => a + Number(v) * n, 0);
    expect(enMonedas).toBe(500);
    // Lo que queda en monedas: 5,13 − 5,00.
    const quedan = pendiente
      .filter((l) => !esBillete(l.valor))
      .reduce((a, l) => a + l.valor * (l.cantidad - (c[l.valor] ?? 0)), 0);
    expect(quedan).toBe(13);
  });

  it("nunca da más piezas de las que hay", () => {
    const c = cambioParaCliente(pendiente, 1000, esBillete, [1000])!;
    expect(valorDe(c)).toBe(1000);
    for (const [v, n] of Object.entries(c)) {
      expect(n).toBeLessThanOrEqual(pendiente.find((l) => l.valor === Number(v))!.cantidad);
    }
  });

  it("si no hay forma exacta, null", () => {
    expect(cambioParaCliente([{ valor: 200, cantidad: 1 }], 500, esBillete)).toBeNull();
    expect(cambioParaCliente(pendiente, 0, esBillete)).toBeNull();
  });
});
