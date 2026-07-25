import { describe, it, expect } from "vitest";
import {
  addDaysToDateKey,
  calcularFechaAviso,
  getEstadoVisual,
  getEstadoColorClass,
  formatSpanishDateKey,
} from "./caducidadHelpers";

describe("calcularFechaAviso", () => {
  it("resta los días de antelación (caso del enunciado: 30/08 - 15 = 15/08)", () => {
    expect(calcularFechaAviso("2026-08-30", 15)).toBe("2026-08-15");
  });

  it("cruza meses y años correctamente", () => {
    expect(calcularFechaAviso("2026-01-05", 15)).toBe("2025-12-21");
    expect(calcularFechaAviso("2026-03-10", 15)).toBe("2026-02-23");
  });

  it("años bisiestos", () => {
    expect(calcularFechaAviso("2028-03-01", 1)).toBe("2028-02-29");
  });

  it("no le afecta el cambio horario de marzo/octubre (aritmética UTC)", () => {
    expect(calcularFechaAviso("2026-04-05", 15)).toBe("2026-03-21");
    expect(calcularFechaAviso("2026-11-05", 15)).toBe("2026-10-21");
  });

  it("fechas inválidas devuelven null", () => {
    expect(calcularFechaAviso("", 15)).toBeNull();
    expect(calcularFechaAviso("30/08/2026", 15)).toBeNull();
  });

  it("antelación negativa o no numérica se normaliza", () => {
    expect(calcularFechaAviso("2026-08-30", -5)).toBe("2026-08-30");
    expect(calcularFechaAviso("2026-08-30", NaN)).toBe("2026-08-15");
  });
});

describe("addDaysToDateKey", () => {
  it("suma días", () => {
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("getEstadoVisual", () => {
  const base = { fecha_aviso: "2026-08-15", fecha_caducidad: "2026-08-30" } as const;

  it("PENDIENTE antes de la fecha de aviso sigue pendiente", () => {
    expect(getEstadoVisual({ ...base, estado: "PENDIENTE" }, "2026-08-01")).toBe("PENDIENTE");
  });

  it("PENDIENTE con fecha de aviso alcanzada pasa a LISTO_PARA_AVISAR", () => {
    expect(getEstadoVisual({ ...base, estado: "PENDIENTE" }, "2026-08-15")).toBe(
      "LISTO_PARA_AVISAR"
    );
  });

  it("PENDIENTE ya caducado pasa a CADUCADO", () => {
    expect(getEstadoVisual({ ...base, estado: "PENDIENTE" }, "2026-09-01")).toBe("CADUCADO");
  });

  it("AVISADO caducado sin cita pasa a CADUCADO", () => {
    expect(getEstadoVisual({ ...base, estado: "AVISADO" }, "2026-09-01")).toBe("CADUCADO");
  });

  it("CONVERTIDO_EN_CITA no cambia aunque caduque", () => {
    expect(getEstadoVisual({ ...base, estado: "CONVERTIDO_EN_CITA" }, "2026-09-01")).toBe(
      "CONVERTIDO_EN_CITA"
    );
  });
});

describe("getEstadoColorClass", () => {
  it("mapa de colores por estado", () => {
    expect(getEstadoColorClass("PENDIENTE")).toContain("slate-600");
    expect(getEstadoColorClass("LISTO_PARA_AVISAR")).toContain("amber");
    expect(getEstadoColorClass("AVISADO")).toContain("emerald");
    expect(getEstadoColorClass("CONVERTIDO_EN_CITA")).toContain("blue");
    expect(getEstadoColorClass("CADUCADO")).toContain("red");
    expect(getEstadoColorClass("ERROR_ENVIO")).toContain("purple");
  });
});

describe("formatSpanishDateKey", () => {
  it("YYYY-MM-DD → DD/MM/YYYY", () => {
    expect(formatSpanishDateKey("2026-08-30")).toBe("30/08/2026");
  });
});
