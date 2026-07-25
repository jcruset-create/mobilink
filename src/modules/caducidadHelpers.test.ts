import { describe, it, expect } from "vitest";
import {
  addDaysToDateKey,
  addYearsToDateKey,
  ajustarADiaLaborable,
  getFechaCaducidadPorDefecto,
  calcularFechaAviso,
  getEstadoVisual,
  getEstadoColorClass,
  formatSpanishDateKey,
} from "./caducidadHelpers";

describe("ajustarADiaLaborable", () => {
  it("sábado retrocede al viernes", () => {
    // 2026-08-15 es sábado
    expect(ajustarADiaLaborable("2026-08-15")).toBe("2026-08-14");
  });

  it("domingo retrocede al viernes", () => {
    // 2026-08-16 es domingo
    expect(ajustarADiaLaborable("2026-08-16")).toBe("2026-08-14");
  });

  it("día laborable no cambia", () => {
    // 2026-08-17 es lunes
    expect(ajustarADiaLaborable("2026-08-17")).toBe("2026-08-17");
  });
});

describe("calcularFechaAviso", () => {
  it("resta los días y ajusta a laborable: 30/08/2026 - 15 = sábado 15/08 → viernes 14/08 (16 días)", () => {
    expect(calcularFechaAviso("2026-08-30", 15)).toBe("2026-08-14");
  });

  it("si el aviso cae en laborable no se toca: 28/08/2026 - 15 = jueves 13/08", () => {
    expect(calcularFechaAviso("2026-08-28", 15)).toBe("2026-08-13");
  });

  it("segundo aviso de 7 días también se ajusta: 30/08/2026 - 7 = domingo 23/08 → viernes 21/08", () => {
    expect(calcularFechaAviso("2026-08-30", 7)).toBe("2026-08-21");
  });

  it("cruza meses y años correctamente (21/12/2025 es domingo → viernes 19/12)", () => {
    expect(calcularFechaAviso("2026-01-05", 15)).toBe("2025-12-19");
    expect(calcularFechaAviso("2026-03-10", 15)).toBe("2026-02-23");
  });

  it("años bisiestos", () => {
    expect(calcularFechaAviso("2028-03-01", 1)).toBe("2028-02-29");
  });

  it("no le afecta el cambio horario de marzo/octubre (aritmética UTC)", () => {
    // 21/03/2026 es sábado → viernes 20/03
    expect(calcularFechaAviso("2026-04-05", 15)).toBe("2026-03-20");
    expect(calcularFechaAviso("2026-11-05", 15)).toBe("2026-10-21");
  });

  it("fechas inválidas devuelven null", () => {
    expect(calcularFechaAviso("", 15)).toBeNull();
    expect(calcularFechaAviso("30/08/2026", 15)).toBeNull();
  });

  it("antelación negativa o no numérica se normaliza (30/08/2026 es domingo → viernes)", () => {
    expect(calcularFechaAviso("2026-08-30", -5)).toBe("2026-08-28");
    expect(calcularFechaAviso("2026-08-30", NaN)).toBe("2026-08-14");
  });
});

describe("addDaysToDateKey", () => {
  it("suma días", () => {
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("getFechaCaducidadPorDefecto (caducidad a los 2 años)", () => {
  it("caso del enunciado: creado el 25/07/2026 caduca el 25/07/2028", () => {
    expect(getFechaCaducidadPorDefecto("2026-07-25")).toBe("2028-07-25");
  });

  it("29 de febrero → 28 si el año destino no es bisiesto", () => {
    expect(addYearsToDateKey("2028-02-29", 2)).toBe("2030-02-28");
  });

  it("fecha inválida devuelve el propio valor de entrada", () => {
    expect(getFechaCaducidadPorDefecto("invalida")).toBe("invalida");
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
