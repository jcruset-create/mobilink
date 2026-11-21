import { describe, expect, it } from "vitest";
import { coincideReferencia, eanValido, indicesDe, validarValor } from "./completarFicha";

describe("validarValor", () => {
  it("profundidad dentro de lo posible", () => {
    expect(validarValor("profundidad_dibujo_mm", "14,3")).toEqual({ ok: true, valor: 14.3 });
    expect(validarValor("profundidad_dibujo_mm", 45).ok).toBe(false);
  });
  it("letras de etiqueta", () => {
    expect(validarValor("etiqueta_rr", "b")).toEqual({ ok: true, valor: "B" });
    expect(validarValor("etiqueta_rr", "H").ok).toBe(false);
    expect(validarValor("etiqueta_ruido_clase", "D").ok).toBe(false);
  });
  it("EAN-13 con dígito de control", () => {
    expect(eanValido("5452000816498")).toBe(true);
    expect(validarValor("ean", "5452000816497").ok).toBe(false);
    expect(validarValor("ean", "123").ok).toBe(false);
  });
  it("sí/no y enteros", () => {
    expect(validarValor("m_s", "sí")).toEqual({ ok: true, valor: true });
    expect(validarValor("ply", "18")).toEqual({ ok: true, valor: 18 });
    expect(validarValor("ply", "18.5").ok).toBe(false);
    expect(validarValor("etiqueta_ruido_db", 71)).toEqual({ ok: true, valor: 71 });
  });
  it("sin valor no se propone", () => {
    expect(validarValor("peso_kg", null).ok).toBe(false);
  });
});

describe("coincideReferencia", () => {
  const ref = { marca: "Goodyear", modelo: "KMAX D GEN-2", medida: "315/70R22.5", referenciaCompleta: "Goodyear KMAX D GEN-2 315/70R22.5 154/150" };
  it("la misma referencia coincide aunque cambie la forma de escribirla", () => {
    expect(coincideReferencia(ref, { marca: "GOODYEAR", modelo: "KMAX D Gen-2", medida: "315/70 R22.5", indiceCarga: "154/150L" }).ok).toBe(true);
  });
  it("otro índice de carga se descarta", () => {
    const r = coincideReferencia(ref, { marca: "Goodyear", modelo: "KMAX D GEN-2", medida: "315/70R22.5", indiceCarga: "152/148L" });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/Índice de carga/);
  });
  it("otro modelo u otra medida se descarta", () => {
    expect(coincideReferencia(ref, { marca: "Goodyear", modelo: "KMAX D", medida: "315/70R22.5" }).ok).toBe(false);
    expect(coincideReferencia(ref, { marca: "Goodyear", modelo: "KMAX D GEN-2", medida: "315/80R22.5" }).ok).toBe(false);
    expect(coincideReferencia(ref, { marca: "Michelin", modelo: "KMAX D GEN-2", medida: "315/70R22.5" }).ok).toBe(false);
  });
  it("saca los índices de carga de la referencia", () => {
    expect(indicesDe("Goodyear KMAX D GEN-2 315/70R22.5 154/150")).toEqual(["154", "150"]);
    expect(indicesDe("GOODYEAR KMAX T 385/55 R22.5 160L")).toEqual(["160"]);
  });
});
