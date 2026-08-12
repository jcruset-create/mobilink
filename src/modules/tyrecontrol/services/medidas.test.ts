import { describe, it, expect } from "vitest";
import { baseMedida, medidaCanonica, mismaMedida } from "./medidas";

describe("baseMedida", () => {
  it("normaliza la medida quitando espacios e índices", () => {
    expect(baseMedida("385/65 R22.5 158L")).toBe("385/65R22.5");
    expect(baseMedida("385/65R22.5")).toBe("385/65R22.5");
    expect(baseMedida("385/65 R22,5 164K")).toBe("385/65R22.5");
  });
});

describe("mismaMedida", () => {
  it("casa la misma medida escrita de formas distintas", () => {
    expect(mismaMedida("385/65R22.5", "385/65 R22.5 164K")).toBe(true);
    expect(mismaMedida("315/80R22.5", "315/80 R22.5 156L")).toBe(true);
  });

  it("NO casa medidas distintas — el caso que se colaba en el desplegable", () => {
    // La ficha del vehículo pedía 315/80R22.5 y se ofrecían 385/65R22.5.
    expect(mismaMedida("315/80R22.5", "385/65R22.5")).toBe(false);
    expect(mismaMedida("315/80R22.5", "385/65 R22.5 164K")).toBe(false);
  });

  it("distingue también por diámetro de llanta", () => {
    expect(mismaMedida("215/75R17.5", "215/75R22.5")).toBe(false);
  });

  it("sin dato no afirma que coincidan", () => {
    expect(mismaMedida(null, "385/65R22.5")).toBe(false);
    expect(mismaMedida("385/65R22.5", "")).toBe(false);
  });
});

describe("medidaCanonica", () => {
  // El caso real: en el informe ejecutivo de Plana la misma goma salía dos
  // veces, "295/80R22,5" y "295/80R22.5", partiendo la media y el recuento.
  it("la coma decimal y el punto son la misma medida", () => {
    expect(medidaCanonica("295/80R22,5")).toBe("295/80R22.5");
    expect(medidaCanonica("295/80R22.5")).toBe("295/80R22.5");
  });

  it("da igual cómo se repartan los espacios y las mayúsculas", () => {
    for (const s of ["295/80 R 22,5", "  295/80r22.5 ", "295 / 80 R 22.5"]) {
      expect(medidaCanonica(s)).toBe("295/80R22.5");
    }
  });

  it("el guion del import viejo también cuenta", () => {
    expect(medidaCanonica("295/80R22-5")).toBe("295/80R22.5");
  });

  it("pero el guion de una diagonal no se toca", () => {
    // 7.50-16 es una medida de verdad, no un punto mal escrito.
    expect(medidaCanonica("7.50-16")).toBe("7.50-16");
  });

  it("no se come el índice de carga ni el código de velocidad", () => {
    // Aquí se separa de baseMedida(): esto normaliza, no resume.
    expect(medidaCanonica("315/80 R 22,5  156/150 L")).toBe("315/80R22.5 156/150 L");
    expect(baseMedida("315/80 R 22,5  156/150 L")).toBe("315/80R22.5");
  });

  it("vacío y nulo dan cadena vacía, no 'UNDEFINED'", () => {
    expect(medidaCanonica("")).toBe("");
    expect(medidaCanonica("   ")).toBe("");
    expect(medidaCanonica(null)).toBe("");
    expect(medidaCanonica(undefined)).toBe("");
  });

  it("es idempotente: normalizar lo ya normalizado no lo cambia", () => {
    for (const s of ["295/80R22,5", "315/80 R 22,5 156/150 L", "7.50-16", "12R22.5"]) {
      expect(medidaCanonica(medidaCanonica(s))).toBe(medidaCanonica(s));
    }
  });
});
