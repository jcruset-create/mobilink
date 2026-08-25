import { describe, expect, it } from "vitest";
import { aCentimos, aDecimal } from "./amount.ts";

describe("importes de la ERP a céntimos", () => {
  it("convierte lo normal", () => {
    expect(aCentimos("1234.56")).toBe(123456);
    expect(aCentimos("0.01")).toBe(1);
    expect(aCentimos("100")).toBe(10000);
    expect(aCentimos("-45.30")).toBe(-4530);
  });

  /*
   * El caso que motiva todo el fichero: `Math.round(1.005 * 100)` da 100,
   * porque en binario 1.005 es 1.00499999999999989. Un céntimo perdido que
   * nadie sabría de dónde salió.
   */
  it("no se equivoca donde la coma flotante sí", () => {
    expect(aCentimos("1.005")).toBe(101);
    expect(Math.round(1.005 * 100)).toBe(100); // lo que NO se hace

    expect(aCentimos("8.165")).toBe(817);
    expect(Math.round(8.165 * 100)).toBe(816); // ídem
  });

  it("redondea al céntimo por el tercer decimal", () => {
    expect(aCentimos("1.004")).toBe(100);
    expect(aCentimos("1.006")).toBe(101);
    expect(aCentimos("1.0049")).toBe(100);
  });

  it("admite coma decimal, que algunas ERP entregan según la región", () => {
    expect(aCentimos("1234,56")).toBe(123456);
  });

  it("rellena los decimales que falten", () => {
    expect(aCentimos("7.5")).toBe(750);
    expect(aCentimos("7.")).toBe(700);
    expect(aCentimos(".5")).toBe(50);
  });

  it("devuelve null en lugar de inventarse un importe", () => {
    expect(aCentimos(null)).toBeNull();
    expect(aCentimos("")).toBeNull();
    expect(aCentimos("no es un número")).toBeNull();
    expect(aCentimos("12.34.56")).toBeNull();
  });

  it("ida y vuelta sin perder nada", () => {
    for (const c of [0, 1, 99, 100, 123456, -4530]) {
      expect(aCentimos(aDecimal(c))).toBe(c);
    }
    expect(aDecimal(5)).toBe("0.05");
    expect(aDecimal(-4530)).toBe("-45.30");
  });
});
