import { describe, expect, it } from "vitest";
import { filasDeCambio, lineasDeFila, importeDeFila } from "./cambio";

/** Catálogo real: billetes hasta 500 € y monedas con sus tubos. */
const DENOMINACIONES = [
  { valor: 50000, activa: true, piezasPorCartucho: null },
  { valor: 5000, activa: true, piezasPorCartucho: null },
  { valor: 2000, activa: true, piezasPorCartucho: null },
  { valor: 1000, activa: true, piezasPorCartucho: null },
  { valor: 500, activa: true, piezasPorCartucho: null },
  { valor: 200, activa: true, piezasPorCartucho: 25 },
  { valor: 100, activa: true, piezasPorCartucho: 25 },
  { valor: 50, activa: true, piezasPorCartucho: 25 },
  { valor: 20, activa: true, piezasPorCartucho: 25 },
  { valor: 10, activa: true, piezasPorCartucho: 50 },
  { valor: 5, activa: true, piezasPorCartucho: 50 },
  { valor: 2, activa: true, piezasPorCartucho: 50 },
  { valor: 1, activa: true, piezasPorCartucho: 50 },
];

describe("filas de la pantalla de cambio", () => {
  it("salen todas las denominaciones del 10 € al céntimo, propuestas o no", () => {
    // El cálculo solo propone dos: las demás tienen que aparecer igualmente.
    const filas = filasDeCambio(DENOMINACIONES, [
      { valor: 1000, cantidad: 2, cartuchos: 0, motivo: "Se gastan 1 al día" },
      { valor: 200, cantidad: 25, cartuchos: 1, motivo: "Se gastan 2 al día" },
    ]);

    expect(filas.map((f) => f.valor)).toEqual([1000, 500, 200, 100, 50, 20, 10, 5, 2, 1]);

    // Las propuestas traen su cantidad y su porqué…
    expect(filas.find((f) => f.valor === 1000)).toMatchObject({
      cantidades: { sueltas: 2, cartuchos: 0, bolsas: 0 },
      porTubo: 0,
    });
    // 25 piezas que son un cartucho: van a la casilla de cartuchos, no a la de
    // sueltas, o la pantalla pediría 25 monedas Y un tubo.
    expect(filas.find((f) => f.valor === 200)).toMatchObject({
      cantidades: { sueltas: 0, cartuchos: 1, bolsas: 0 },
      porTubo: 25,
    });

    // …y las demás salen a cero, listas para escribir a mano.
    expect(filas.find((f) => f.valor === 1)).toMatchObject({
      cantidades: { sueltas: 0, cartuchos: 0, bolsas: 0 },
      motivo: null,
    });
  });

  it("no ofrece billetes grandes: eso es lo que se lleva al banco, no lo que se pide", () => {
    const filas = filasDeCambio(DENOMINACIONES, []);
    expect(filas.some((f) => f.valor > 1000)).toBe(false);
  });

  it("una denominación desactivada no aparece", () => {
    const filas = filasDeCambio(
      DENOMINACIONES.map((d) => (d.valor === 1 ? { ...d, activa: false } : d)),
      []
    );
    expect(filas.some((f) => f.valor === 1)).toBe(false);
  });

  it("sin propuesta salen todas a cero, que es el pedido enteramente manual", () => {
    const filas = filasDeCambio(DENOMINACIONES, []);
    expect(filas).toHaveLength(10);
    expect(filas.every((f) => importeDeFila(f, {}) === 0)).toBe(true);
  });
});

describe("cantidades tecleadas a líneas de pedido", () => {
  const CERO = { sueltas: 0, cartuchos: 0, bolsas: 0 };
  const moneda = { valor: 100, porTubo: 25, porBolsa: 500, cantidades: CERO, motivo: null };
  const billete = { valor: 1000, porTubo: 0, porBolsa: 0, cantidades: CERO, motivo: null };

  it("los tubos se convierten a piezas sin perder que son tubos", () => {
    // 2 tubos de 1 € son 50 monedas: las dos cifras tienen que viajar.
    expect(lineasDeFila(moneda, { cartuchos: "2" })).toEqual([
      { valor: 100, cantidad: 50, cartuchos: 2, bolsas: 0, motivo: undefined },
    ]);
  });

  it("una bolsa usa sus propias piezas", () => {
    expect(lineasDeFila(moneda, { bolsas: "1" })).toEqual([
      { valor: 100, cantidad: 500, cartuchos: 0, bolsas: 1, motivo: undefined },
    ]);
  });

  it("los tres formatos a la vez salen en tres líneas, no fundidos", () => {
    // Un asiento del libro mayor es de un solo formato: fundirlos perdería qué
    // precinto hay que romper.
    const lineas = lineasDeFila(moneda, { sueltas: "8", cartuchos: "2", bolsas: "1" });
    expect(lineas).toHaveLength(3);
    expect(lineas.map((l) => l.cantidad)).toEqual([8, 50, 500]);
    expect(importeDeFila(moneda, { sueltas: "8", cartuchos: "2", bolsas: "1" })).toBe(
      (8 + 50 + 500) * 100
    );
  });

  it("un billete solo admite sueltas: no tiene cartucho ni bolsa", () => {
    expect(lineasDeFila(billete, { sueltas: "3" })).toEqual([
      { valor: 1000, cantidad: 3, cartuchos: 0, bolsas: 0, motivo: undefined },
    ]);
    expect(lineasDeFila(billete, { cartuchos: "3", bolsas: "2" })).toEqual([]);
  });

  it("cero, vacío o basura no generan línea", () => {
    expect(lineasDeFila(billete, { sueltas: "0" })).toEqual([]);
    expect(lineasDeFila(billete, { sueltas: "" })).toEqual([]);
    expect(lineasDeFila(billete, {})).toEqual([]);
    expect(lineasDeFila(billete, { sueltas: "-2" })).toEqual([]);
    expect(lineasDeFila(billete, { sueltas: "hola" })).toEqual([]);
  });
});
