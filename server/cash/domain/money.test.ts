/**
 * Pruebas de la aritmética monetaria y del inventario.
 *
 * Poco glamurosas y muy necesarias: aquí es donde se comprueba que nunca entra
 * un float por la puerta de atrás y que un inventario jamás se queda en
 * negativo sin avisar.
 */

import { describe, it, expect } from "vitest";
import {
  aCentimos,
  exigirAcentimos,
  exigirCentimosPositivos,
  formatearEuros,
  aTextoDecimal,
  esCentimosValido,
  sumar,
} from "./money.ts";
import {
  ErrorInventario,
  inventarioDesdeLineas,
  lineasDesdeInventario,
  totalInventario,
  totalPiezas,
  restarInventarios,
  sumarInventarios,
  faltantes,
  cabeDentro,
  diferenciaPorDenominacion,
  estaVacio,
} from "./inventory.ts";

describe("conversión a céntimos", () => {
  it("lee lo que escribe una persona", () => {
    expect(aCentimos("187")).toBe(18700);
    expect(aCentimos("187,00")).toBe(18700);
    expect(aCentimos("187.00")).toBe(18700);
    expect(aCentimos("0,01")).toBe(1);
    expect(aCentimos("0,1")).toBe(10);
    expect(aCentimos(",5")).toBe(50);
    expect(aCentimos("1234,56")).toBe(123456);
    expect(aCentimos(" 12,50 € ")).toBe(1250);
    expect(aCentimos("-5,25")).toBe(-525);
  });

  it("lee lo que devuelve node-postgres como texto", () => {
    expect(aCentimos("500.00")).toBe(50000);
    expect(aCentimos("0.05")).toBe(5);
  });

  it("redondea al céntimo los números en coma flotante", () => {
    // 18.7 * 100 en coma flotante da 1869.9999999999998
    expect(aCentimos(18.7)).toBe(1870);
    expect(aCentimos(0.1 + 0.2)).toBe(30);
  });

  it("devuelve null ante lo que no es un importe", () => {
    for (const malo of ["", "  ", "abc", "1,2,3", null, undefined, NaN, Infinity, "12,345"]) {
      expect(aCentimos(malo as never), String(malo)).toBeNull();
    }
  });

  it("exigirAcentimos revienta con el nombre del campo", () => {
    expect(() => exigirAcentimos("nada", "importe")).toThrow(/importe/);
    expect(exigirAcentimos("10", "importe")).toBe(1000);
  });

  it("exigirCentimosPositivos no acepta cero", () => {
    expect(() => exigirCentimosPositivos(0, "cobro")).toThrow(/mayor que cero/);
    expect(() => exigirCentimosPositivos(-1, "cobro")).toThrow(/mayor que cero/);
    expect(exigirCentimosPositivos(1, "cobro")).toBe(1);
  });

  it("no acepta importes fuera de rango ni decimales", () => {
    expect(esCentimosValido(12.5)).toBe(false);
    expect(esCentimosValido(10_000_000_001)).toBe(false);
    expect(esCentimosValido(1870)).toBe(true);
  });
});

describe("formato", () => {
  it("presenta con separador de miles y dos decimales", () => {
    expect(formatearEuros(18700)).toBe("187,00");
    expect(formatearEuros(123456)).toBe("1.234,56");
    expect(formatearEuros(1)).toBe("0,01");
    expect(formatearEuros(0)).toBe("0,00");
    expect(formatearEuros(-4000)).toBe("-40,00");
    expect(formatearEuros(100000000)).toBe("1.000.000,00");
  });

  it("el texto decimal es el que entiende un NUMERIC o una ERP", () => {
    expect(aTextoDecimal(18700)).toBe("187.00");
    expect(aTextoDecimal(5)).toBe("0.05");
    expect(aTextoDecimal(-525)).toBe("-5.25");
  });

  it("ida y vuelta sin pérdida", () => {
    for (const c of [0, 1, 99, 100, 18700, 123456, 50000]) {
      expect(aCentimos(aTextoDecimal(c))).toBe(c);
    }
  });

  it("sumar cien líneas de un céntimo da exactamente un euro", () => {
    expect(sumar(...Array(100).fill(1))).toBe(100);
  });
});

describe("inventario", () => {
  const inv = inventarioDesdeLineas([
    { valor: 5000, cantidad: 2 },
    { valor: 200, cantidad: 3 },
  ]);

  it("suma líneas repetidas y descarta los ceros", () => {
    const i = inventarioDesdeLineas([
      { valor: 100, cantidad: 2 },
      { valor: 100, cantidad: 3 },
      { valor: 50, cantidad: 0 },
    ]);
    expect(i.get(100)).toBe(5);
    expect(i.has(50)).toBe(false);
  });

  it("calcula total e importe", () => {
    expect(totalInventario(inv)).toBe(10600);
    expect(totalPiezas(inv)).toBe(5);
    expect(estaVacio(inventarioDesdeLineas([]))).toBe(true);
    expect(estaVacio(inv)).toBe(false);
  });

  it("devuelve las líneas de mayor a menor", () => {
    expect(lineasDesdeInventario(inv)).toEqual([
      { valor: 5000, cantidad: 2 },
      { valor: 200, cantidad: 3 },
    ]);
  });

  it("rechaza cantidades que no son enteros no negativos", () => {
    for (const mala of [-1, 1.5, NaN, "2" as unknown as number]) {
      expect(() => inventarioDesdeLineas([{ valor: 100, cantidad: mala }])).toThrow(ErrorInventario);
    }
  });

  it("suma inventarios", () => {
    const otro = inventarioDesdeLineas([{ valor: 200, cantidad: 1 }, { valor: 100, cantidad: 4 }]);
    const s = sumarInventarios(inv, otro);
    expect(s.get(200)).toBe(4);
    expect(s.get(100)).toBe(4);
    expect(totalInventario(s)).toBe(11200);
  });

  it("resta exigiendo existencias, y dice qué falta", () => {
    const menos = restarInventarios(inv, inventarioDesdeLineas([{ valor: 5000, cantidad: 1 }]));
    expect(menos.get(5000)).toBe(1);

    const demasiado = inventarioDesdeLineas([{ valor: 5000, cantidad: 3 }]);
    expect(cabeDentro(inv, demasiado)).toBe(false);
    expect(faltantes(inv, demasiado)).toEqual([{ valor: 5000, pedido: 3, disponible: 2 }]);
    expect(() => restarInventarios(inv, demasiado)).toThrow(ErrorInventario);

    try {
      restarInventarios(inv, demasiado);
    } catch (e) {
      expect((e as ErrorInventario).codigo).toBe("STOCK_INSUFICIENTE");
    }
  });

  it("restar hasta cero borra la denominación en vez de dejar un cero", () => {
    const vacio = restarInventarios(inv, inventarioDesdeLineas([{ valor: 5000, cantidad: 2 }]));
    expect(vacio.has(5000)).toBe(false);
  });

  it("la diferencia recorre la unión de las dos composiciones", () => {
    const contado = inventarioDesdeLineas([
      { valor: 5000, cantidad: 1 },
      { valor: 1000, cantidad: 2 },
    ]);
    const d = diferenciaPorDenominacion(inv, contado);
    expect(d).toEqual([
      { valor: 5000, teorico: 2, contado: 1, diferencia: -1 },
      { valor: 1000, teorico: 0, contado: 2, diferencia: 2 },
      { valor: 200, teorico: 3, contado: 0, diferencia: -3 },
    ]);
  });
});
