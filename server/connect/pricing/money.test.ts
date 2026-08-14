import { describe, it, expect } from "vitest";
import {
  aDinero, aCantidad, aNumero, formatear, multiplicar, porcentaje, porcentajeDe,
  redondearCentimos, restar, sumar, CERO,
} from "./money.ts";

describe("aritmética decimal del motor de tarifas", () => {
  it("lo que en coma flotante no cuadra, aquí sí", () => {
    // El motivo entero de que este módulo exista: 0.1 + 0.2 !== 0.3 en binario
    expect(0.1 + 0.2).not.toBe(0.3);
    const suma = sumar(aDinero("0.1")!, aDinero("0.2")!);
    expect(formatear(suma)).toBe("0.30");
  });

  it("cien líneas de un céntimo suman un euro exacto", () => {
    let total = CERO;
    for (let i = 0; i < 100; i++) total = sumar(total, aDinero("0.01")!);
    expect(formatear(total)).toBe("1.00");
  });

  it("acepta el texto que devuelve PostgreSQL para NUMERIC", () => {
    expect(formatear(aDinero("331.2000")!)).toBe("331.20");
    expect(formatear(aDinero("0.0000")!)).toBe("0.00");
    expect(formatear(aDinero(198)!)).toBe("198.00");
    expect(formatear(aDinero("1,25")!)).toBe("1.25");
  });

  it("un importe desconocido es null, y no se confunde con cero", () => {
    expect(aDinero(null)).toBeNull();
    expect(aDinero("")).toBeNull();
    expect(aDinero("no es un número")).toBeNull();
    // Cero sí es un importe: gratis no es lo mismo que no saberlo
    expect(aDinero("0")).toBe(CERO);
  });

  it("guarda cuatro decimales: un precio por kilómetro los necesita", () => {
    const porKm = aDinero("1.2345")!;
    expect(formatear(porKm, 4)).toBe("1.2345");
  });

  it("kilómetros adicionales: 25 km a 1,25 €", () => {
    const total = multiplicar(aDinero("1.25")!, aCantidad(25));
    expect(formatear(total)).toBe("31.25");
  });

  it("una cantidad con decimales no arrastra error", () => {
    // 76,4 km a 1,25 € = 95,50 €
    const total = multiplicar(aDinero("1.25")!, aCantidad(76.4));
    expect(formatear(total)).toBe("95.50");
  });

  it("la anulación es un porcentaje del forfait", () => {
    expect(formatear(porcentaje(aDinero("331")!, aDinero("50")!))).toBe("165.50");
  });

  it("el descuento sobre baremo es el baremo menos su porcentaje", () => {
    // Baremo de 1.000 € con 39 % de descuento = 610 €. El porcentaje es el
    // descuento, no el precio: confundirlo cuesta 220 € por neumático.
    const baremo = aDinero("1000")!;
    const precio = restar(baremo, porcentaje(baremo, aDinero("39")!));
    expect(formatear(precio)).toBe("610.00");
  });

  it("el margen porcentual sale con decimales", () => {
    const margen = restar(aDinero("331")!, aDinero("275")!);
    expect(formatear(margen)).toBe("56.00");
    const pct = porcentajeDe(margen, aDinero("331")!)!;
    expect(formatear(pct)).toBe("16.92");
  });

  it("el margen sobre un total de cero es indeterminado, no cero por ciento", () => {
    expect(porcentajeDe(aDinero("10")!, CERO)).toBeNull();
  });

  it("el redondeo a céntimos se aleja del cero en el medio punto", () => {
    expect(formatear(redondearCentimos(aDinero("1.005")!))).toBe("1.01");
    expect(formatear(redondearCentimos(aDinero("1.015")!))).toBe("1.02");
    expect(formatear(redondearCentimos(aDinero("-1.005")!))).toBe("-1.01");
  });

  it("los negativos se manejan igual: hay abonos y correcciones", () => {
    expect(formatear(aDinero("-45.50")!)).toBe("-45.50");
    expect(formatear(sumar(aDinero("100")!, aDinero("-45.50")!))).toBe("54.50");
  });

  it("importes grandes no pierden precisión", () => {
    // Un número así en coma flotante ya no distingue céntimos
    const grande = aDinero("99999999.99")!;
    expect(formatear(sumar(grande, aDinero("0.01")!))).toBe("100000000.00");
  });

  it("vuelve a número solo para presentar", () => {
    expect(aNumero(aDinero("331.25")!)).toBe(331.25);
  });
});
