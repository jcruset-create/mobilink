import { describe, expect, it } from "vitest";
import { citaYaEnTaller } from "./citaYaEnTaller";

describe("citaYaEnTaller", () => {
  it("un trabajo activo con la misma matrícula la da por llegada", () => {
    expect(citaYaEnTaller({ plate: "7856LMD" }, [{ plate: "7856 LMD", status: "activo" }])).toBe(true);
  });
  it("también si está en validación, en cola o parado", () => {
    for (const s of ["validacion", "espera", "parado"]) {
      expect(citaYaEnTaller({ plate: "7856LMD" }, [{ plate: "7856LMD", status: s }])).toBe(true);
    }
  });
  it("un trabajo cerrado no cuenta", () => {
    expect(citaYaEnTaller({ plate: "7856LMD" }, [{ plate: "7856LMD", status: "cerrado" }])).toBe(false);
  });
  it("sin matrícula de verdad no se cruza nada", () => {
    expect(citaYaEnTaller({ plate: "SM" }, [{ plate: "SM", status: "activo" }])).toBe(false);
    expect(citaYaEnTaller({ plate: "" }, [{ plate: "", status: "activo" }])).toBe(false);
  });
});
