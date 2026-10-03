import { describe, expect, it } from "vitest";
import { areaM2, cuadraPvp, cuotaCuadraConIva, leerNumero, medidaACm, redondear2, resolverPrecio, resolverPrecioTrastero, volumenM3 } from "./pricing.ts";

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

});

describe("precio del trastero: base + cuota de IVA (euros) = PVP", () => {
  it("los tres cuadran: se guardan tal cual y el tipo es el IVA general", () => {
    expect(resolverPrecioTrastero({ base: 20.66, cuota: 4.34, pvp: 25 }, 21)).toEqual({ base: 20.66, cuota: 4.34, pvp: 25, iva: 21 });
  });
  it("no cuadran: error, sin elegir uno en silencio", () => {
    expect(() => resolverPrecioTrastero({ base: 20.66, cuota: 4.34, pvp: 26 }, 21)).toThrow(/no es el PVP/);
  });
  it("dos de tres: el tercero sale de los otros dos, sin usar ningún tipo", () => {
    expect(resolverPrecioTrastero({ base: 20.66, pvp: 25 }, 10)).toMatchObject({ cuota: 4.34, iva: 10 });
    expect(resolverPrecioTrastero({ cuota: 4.34, pvp: 25 }, 21)).toMatchObject({ base: 20.66 });
  });
  it("sólo base o sólo PVP: se completa con el IVA general configurado", () => {
    expect(resolverPrecioTrastero({ base: 100 }, 22)).toEqual({ base: 100, cuota: 22, pvp: 122, iva: 22 });
    expect(resolverPrecioTrastero({ pvp: 60 }, 21)).toEqual({ base: 49.59, cuota: 10.41, pvp: 60, iva: 21 });
  });
  it("aviso de cuota que no corresponde al IVA general", () => {
    expect(cuotaCuadraConIva(20.66, 4.34, 21)).toBe(true);
    expect(cuotaCuadraConIva(20.66, 4.34, 10)).toBe(false);
  });
});
