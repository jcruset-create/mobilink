import { describe, expect, it } from "vitest";
import { normalizarDocumento, normalizarTelefono, validarDocumento } from "./identidad.ts";

describe("NIF / NIE / CIF", () => {
  it("normaliza separadores y mayúsculas", () => {
    expect(normalizarDocumento(" 12345678-z ")).toBe("12345678Z");
  });

  it("DNI con letra correcta e incorrecta", () => {
    expect(validarDocumento("12345678Z")).toEqual({ valor: "12345678Z", tipo: "DNI" });
    expect(() => validarDocumento("12345678A")).toThrow(/letra de control/);
  });

  it("NIE", () => {
    expect(validarDocumento("X1234567L").tipo).toBe("NIE");
    expect(() => validarDocumento("X1234567A")).toThrow();
  });

  it("CIF", () => {
    expect(validarDocumento("B12345674").tipo).toBe("CIF");
    expect(validarDocumento("Q2826000H").tipo).toBe("CIF");
    expect(() => validarDocumento("B12345670")).toThrow();
  });

  it("extranjero: sólo forma", () => {
    expect(validarDocumento("p-1234567", "FR")).toEqual({ valor: "P1234567", tipo: "EXTRANJERO" });
    expect(() => validarDocumento("ab", "FR")).toThrow();
  });
});

describe("teléfonos", () => {
  it("español sin prefijo → +34", () => {
    expect(normalizarTelefono("600 11 22 33")).toBe("+34600112233");
    expect(normalizarTelefono("0034 977 123 456")).toBe("+34977123456");
  });

  it("internacional tal cual", () => {
    expect(normalizarTelefono("+33 6 12 34 56 78")).toBe("+33612345678");
  });

  it("rechaza lo que no es un teléfono", () => {
    expect(() => normalizarTelefono("12345")).toThrow();
    expect(() => normalizarTelefono("+34 123")).toThrow();
  });
});
