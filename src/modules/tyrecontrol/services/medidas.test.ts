import { describe, it, expect } from "vitest";
import { baseMedida, mismaMedida } from "./medidas";

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
