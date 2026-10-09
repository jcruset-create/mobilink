import { describe, expect, it } from "vitest";
import { camposDeNumeroDeParte, camposDeParte, indiceSugerido } from "./parteParaTrabajo";

const material = [{ descripcion: "Sensor", unidades: 1 }] as any;
const tareas = [{ id: "t1", label: "Calibrar", standardMinutes: 30 }] as any;

describe("camposDeParte", () => {
  it("engancha número, hora de entrada, material y tareas", () => {
    expect(
      camposDeParte({ ptNumero: "PT-1234", arrivedAtMs: 1_700_000_000_000, materiales: material, tareasIncluidas: tareas })
    ).toEqual({
      ptNumero: "PT-1234",
      ptEntradaMs: 1_700_000_000_000,
      materiales: material,
      includedTasks: tareas,
    });
  });

  it("si el parte no trae hora, no se inventa una", () => {
    const r = camposDeParte({ ptNumero: "PT-1", arrivedAtMs: null, materiales: [], tareasIncluidas: [] });
    expect("ptEntradaMs" in r).toBe(false);
  });

  it("no toca la operación, el área, la matrícula ni el técnico", () => {
    const claves = Object.keys(
      camposDeParte({ ptNumero: "PT-1", arrivedAtMs: 1, materiales: material, tareasIncluidas: tareas })
    );
    for (const prohibida of ["area", "template", "quickEntryLabel", "quickEntryMode", "plate", "assignedNames", "status"]) {
      expect(claves).not.toContain(prohibida);
    }
  });

  it("sin material, se guarda null y no una lista vacía que nadie sabe leer", () => {
    expect(camposDeParte({ ptNumero: "PT-1", arrivedAtMs: null, materiales: [], tareasIncluidas: [] }).materiales).toBeNull();
  });
});

describe("camposDeNumeroDeParte", () => {
  it("normaliza a mayúsculas y recorta", () => {
    expect(camposDeNumeroDeParte("  pt-9 ")).toEqual({ ptNumero: "PT-9" });
  });
  it("vacío desengancha el parte", () => {
    expect(camposDeNumeroDeParte("   ")).toEqual({ ptNumero: null });
  });
});

describe("indiceSugerido", () => {
  const trabajos = [{ plate: "1234ABC" }, { plate: "0659GWZ" }];

  it("propone el de la misma matrícula", () => {
    expect(indiceSugerido(trabajos, "0659GWZ")).toBe(1);
    expect(indiceSugerido(trabajos, "0659 gwz")).toBe(1);
  });

  it("con varios y ninguno que coincida, no adivina", () => {
    expect(indiceSugerido(trabajos, "9999ZZZ")).toBe(-1);
  });

  it("si el parte trae un solo trabajo, ése es", () => {
    expect(indiceSugerido([{ plate: "9999ZZZ" }], "0659GWZ")).toBe(0);
    expect(indiceSugerido([{ plate: "9999ZZZ" }], "S/M")).toBe(0);
  });

  it("una matrícula que no lo es (S/M) no se cruza con nada", () => {
    expect(indiceSugerido(trabajos, "S/M")).toBe(-1);
  });
});
