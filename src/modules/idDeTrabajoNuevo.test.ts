import { describe, expect, it } from "vitest";
import { idDeTrabajoNuevo } from "./idDeTrabajoNuevo";

describe("idDeTrabajoNuevo", () => {
  it("usa la hora, no el mayor id cargado + 1 (que se repetía al salir de la lista viva)", () => {
    expect(idDeTrabajoNuevo([{ id: 100 }, { id: 250 }], 1_763_900_000_000)).toBe(1_763_900_000_000);
  });
  it("si hay un id cargado por encima de la hora, va por encima de él", () => {
    expect(idDeTrabajoNuevo([{ id: 1_763_900_000_005 }], 1_763_900_000_000)).toBe(1_763_900_000_006);
  });
  it("sin trabajos cargados, la hora", () => {
    expect(idDeTrabajoNuevo([], 42)).toBe(42);
  });
});
