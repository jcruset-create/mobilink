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
  it("la «C» de comercial no hace otra medida: 205/75 R 16 C es 205/75R16", () => {
    const furgo = { marca: "Continental", modelo: "ContiVanContact 100", medida: "205/75R16", referenciaCompleta: "Continental ContiVanContact 100 205/75 R16 113/111R" };
    expect(coincideReferencia(furgo, { marca: "Continental", modelo: "ContiVanContact 100", medida: "205/75 R 16 C", indiceCarga: "113/111R" }).ok).toBe(true);
    // Lo que separa una C de una de turismo es el índice: ése sí se descarta.
    expect(coincideReferencia(furgo, { marca: "Continental", modelo: "ContiVanContact 100", medida: "205/75 R16", indiceCarga: "104H" }).causa).toBe("indice");
  });
  it("saca los índices de carga de la referencia", () => {
    expect(indicesDe("Goodyear KMAX D GEN-2 315/70R22.5 154/150")).toEqual(["154", "150"]);
    expect(indicesDe("GOODYEAR KMAX T 385/55 R22.5 160L")).toEqual(["160"]);
  });
});

describe("alias de modelo", () => {
  const ref = { marca: "Barum", modelo: "BT200", medida: "385/55R22.5", referenciaCompleta: "BARUM BT200 385/55 R22.5 160L" };
  it("sin alias, otro nombre comercial se descarta por MODELO (rescatable)", () => {
    const r = coincideReferencia(ref, { marca: "Barum", modelo: "BT 200 R", medida: "385/55 R22.5", indiceCarga: "160K" });
    expect(r.ok).toBe(false);
    expect(r.causa).toBe("modelo");
  });
  it("con el alias confirmado, coincide", () => {
    expect(coincideReferencia({ ...ref, alias: ["BT 200 R"] }, { marca: "Barum", modelo: "BT 200 R", medida: "385/55R22.5", indiceCarga: "160K" }).ok).toBe(true);
  });
  it("sin marca o sin modelo leídos: no hay ficha (no rescatable)", () => {
    const r = coincideReferencia(ref, { marca: null, modelo: null, medida: null });
    expect(r.causa).toBe("sin_ficha");
    expect(r.motivo).toBe("No se ha encontrado ninguna ficha de esta referencia");
    expect(coincideReferencia(ref, { marca: "Barum", modelo: "", medida: "385/55R22.5" }).causa).toBe("sin_ficha");
  });
  it("el alias no salta el índice de carga", () => {
    const r = coincideReferencia({ ...ref, alias: ["BT 200 R"] }, { marca: "Barum", modelo: "BT 200 R", medida: "385/55R22.5", indiceCarga: "158L" });
    expect(r.causa).toBe("indice");
  });
});
