import { describe, expect, it } from "vitest";
import { filasDeCambio, aLinea } from "./cambio";

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
    expect(filas.find((f) => f.valor === 1000)).toMatchObject({ cantidad: 2, porTubo: 0 });
    expect(filas.find((f) => f.valor === 200)).toMatchObject({ cantidad: 1, porTubo: 25 });

    // …y las demás salen a cero, listas para escribir a mano.
    expect(filas.find((f) => f.valor === 1)).toMatchObject({ cantidad: 0, motivo: null });
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
    expect(filas.every((f) => f.cantidad === 0)).toBe(true);
  });
});

describe("cantidad tecleada a línea de pedido", () => {
  const tuboDe25 = { valor: 100, porTubo: 25, cantidad: 0, motivo: null };
  const billete = { valor: 1000, porTubo: 0, cantidad: 0, motivo: null };

  it("los tubos se convierten a piezas sin perder que son tubos", () => {
    // 2 tubos de 1 € son 50 monedas: las dos cifras tienen que viajar.
    expect(aLinea(tuboDe25, "2")).toMatchObject({ valor: 100, cantidad: 50, cartuchos: 2 });
  });

  it("un billete va en piezas y sin cartuchos", () => {
    expect(aLinea(billete, "3")).toMatchObject({ valor: 1000, cantidad: 3, cartuchos: 0 });
  });

  it("cero, vacío o basura no generan línea", () => {
    expect(aLinea(billete, "0")).toBeNull();
    expect(aLinea(billete, "")).toBeNull();
    expect(aLinea(billete, undefined)).toBeNull();
    expect(aLinea(billete, "-2")).toBeNull();
    expect(aLinea(billete, "hola")).toBeNull();
  });
});
