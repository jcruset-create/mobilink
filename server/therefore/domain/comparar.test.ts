import { describe, expect, it } from "vitest";
import { claveReferencia, compararConErp } from "./comparar.ts";

const papel = (ref: string | null, cantidad: number | null, importe: number | null) => ({
  referencia: ref,
  descripcion: null,
  cantidad,
  importeCentimos: importe,
});
const erp = (ref: string | null, cantidad: number | null, importe: number | null) => ({
  referencia: ref,
  descripcion: null,
  cantidad,
  precioUnitarioCentimos: null,
  importeCentimos: importe,
});

describe("comparar el papel con el ERP", () => {
  it("dos albaranes iguales coinciden, y la diferencia total es cero", () => {
    const c = compararConErp([papel("990001", 1, 1000), papel("990002", 2, 2000)], [erp("990001", 1, 1000), erp("990002", 2, 2000)]);
    expect(c.coincide).toBe(true);
    expect(c.diferenciaTotalCentimos).toBe(0);
    expect(c.resumen).toEqual({ iguales: 2, difieren: 0, faltanEnErp: 0, sobranEnErp: 0, sinReferencia: 0 });
  });

  it("una cantidad distinta se dice por su nombre, con los dos valores al lado", () => {
    const c = compararConErp([papel("990001", 2, 2000)], [erp("990001", 1, 2000)]);
    expect(c.coincide).toBe(false);
    const l = c.lineas[0];
    expect(l.tipo).toBe("DIFIERE");
    if (l.tipo === "DIFIERE") {
      expect(l.campos).toEqual(["cantidad"]);
      expect(l.papel.cantidad).toBe(2);
      expect(l.erp.cantidad).toBe(1);
    }
  });

  it("un céntimo de diferencia es un redondeo, no una diferencia", () => {
    const c = compararConErp([papel("990001", 1, 1000)], [erp("990001", 1, 1001)]);
    expect(c.lineas[0].tipo).toBe("IGUAL");
  });

  it("lo que falta en un lado y sobra en el otro se lista, sin emparejar por parecido", () => {
    // Misma cantidad y mismo importe, referencias distintas: dos artículos, no uno.
    const c = compararConErp([papel("990001", 1, 1000)], [erp("990009", 1, 1000)]);
    expect(c.lineas.map((l) => l.tipo).sort()).toEqual(["FALTA_EN_ERP", "SOBRA_EN_ERP"]);
    expect(c.coincide).toBe(false);
  });

  it("la referencia se empareja sin espacios, guiones ni mayúsculas", () => {
    expect(claveReferencia(" ab-10.01 / x ")).toBe("AB1001X");
    const c = compararConErp([papel("AB-1001", 1, 100)], [erp("ab1001", 1, 100)]);
    expect(c.lineas[0].tipo).toBe("IGUAL");
  });

  it("una línea del papel sin referencia no se compara: se marca", () => {
    const c = compararConErp([papel(null, 1, 100)], []);
    expect(c.lineas[0].tipo).toBe("SIN_REFERENCIA");
    expect(c.coincide).toBe(false);
  });

  it("dos líneas con la misma referencia se comparan en orden", () => {
    const c = compararConErp([papel("A", 1, 100), papel("A", 2, 200)], [erp("A", 1, 100), erp("A", 3, 300)]);
    expect(c.lineas.map((l) => l.tipo)).toEqual(["IGUAL", "DIFIERE"]);
  });

  it("sin líneas en el papel no hay nada que coincida", () => {
    expect(compararConErp([], []).coincide).toBe(false);
  });

  it("si falta un importe, la diferencia total es null y no cero", () => {
    expect(compararConErp([papel("A", 1, null)], [erp("A", 1, 100)]).diferenciaTotalCentimos).toBeNull();
  });
});
