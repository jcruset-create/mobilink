import { describe, expect, it } from "vitest";
import { areaM2, cuadraPvp, leerIva, leerNumero, medidaACm, redondear2, resolverPrecio, volumenM3 } from "./pricing.ts";

describe("precio del alquiler", () => {
  it("con sólo la base calcula el PVP", () => {
    expect(resolverPrecio({ base: 49.59, iva: 21 })).toEqual({ base: 49.59, iva: 21, pvp: 60.0 });
  });

  it("con sólo el PVP calcula una base que vuelve a dar el PVP publicado", () => {
    const p = resolverPrecio({ pvp: 60, iva: 21 });
    expect(p.pvp).toBe(60);
    expect(p.base).toBe(49.59);
    expect(cuadraPvp(p.base, 21, p.pvp)).toBe(true);
  });

  it("base y PVP que cuadran (redondeo de un céntimo) se aceptan tal cual", () => {
    expect(resolverPrecio({ base: 49.58, iva: 21, pvp: 60 })).toEqual({ base: 49.58, iva: 21, pvp: 60 });
  });

  it("base y PVP que no cuadran es un error, no se elige uno en silencio", () => {
    expect(() => resolverPrecio({ base: 40, iva: 21, pvp: 60 })).toThrow(/PVP/);
  });

  it("IVA 0 es válido (no se presupone el tratamiento fiscal)", () => {
    expect(resolverPrecio({ base: 50, iva: 0 })).toEqual({ base: 50, iva: 0, pvp: 50 });
  });

  it("rechaza IVA fuera de rango y precios negativos o ausentes", () => {
    expect(() => resolverPrecio({ base: 10, iva: 120 })).toThrow();
    expect(() => resolverPrecio({ base: -1, iva: 21 })).toThrow();
    expect(() => resolverPrecio({ iva: 21 })).toThrow();
  });

  it("redondeo de calculadora", () => {
    expect(redondear2(1.005)).toBe(1.01);
    expect(redondear2(2.675)).toBe(2.68);
    expect(redondear2(-1.005)).toBe(-1.01);
  });
});

describe("medidas", () => {
  it("m² y m³ desde cm", () => {
    expect(areaM2(150, 200)).toBe(3);
    expect(volumenM3(150, 200, 250)).toBe(7.5);
  });

  it("metros o centímetros", () => {
    expect(medidaACm(1.5)).toBe(150);
    expect(medidaACm(150)).toBe(150);
    expect(medidaACm(2.5, "cm")).toBe(3);
    expect(medidaACm(25, "m")).toBe(2500);
  });
});

describe("lectura de números", () => {
  it("formatos español e internacional", () => {
    expect(leerNumero("1.234,56")).toBe(1234.56);
    expect(leerNumero("1,234.56")).toBe(1234.56);
    expect(leerNumero("49,59 €")).toBe(49.59);
    expect(leerNumero("2.5")).toBe(2.5);
    expect(leerNumero("")).toBeNull();
    expect(Number.isNaN(leerNumero("abc"))).toBe(true);
  });

  it("IVA como porcentaje o fracción", () => {
    expect(leerIva("21")).toBe(21);
    expect(leerIva("21 %")).toBe(21);
    expect(leerIva("0,21")).toBe(21);
    expect(leerIva("0")).toBe(0);
  });
});
