import { describe, expect, it } from "vitest";

import { comparacion, fmtMin, intensidad, periodo } from "./estadisticasAsist.ts";

describe("pantalla de estadísticas", () => {
  const ahora = new Date(2026, 10, 25, 10, 30); // 25 nov 2026, 10:30

  it("el periodo de cada botón", () => {
    expect(periodo("hoy", ahora)).toEqual({ desdeMs: new Date(2026, 10, 25).getTime(), hastaMs: ahora.getTime() });
    expect(periodo("7d", ahora)!.desdeMs).toBe(new Date(2026, 10, 19).getTime());
    expect(periodo("mes", ahora)!.desdeMs).toBe(new Date(2026, 10, 1).getTime());
    expect(periodo("anio", ahora)!.desdeMs).toBe(new Date(2026, 0, 1).getTime());
  });

  it("personalizado: los dos días enteros, y nada si está al revés o a medias", () => {
    const p = periodo("personalizado", ahora, { desde: "2026-10-01", hasta: "2026-10-31" })!;
    expect(p.desdeMs).toBe(new Date(2026, 9, 1).getTime());
    expect(p.hastaMs).toBe(new Date(2026, 10, 1).getTime() - 1);
    expect(periodo("personalizado", ahora, { desde: "2026-10-31", hasta: "2026-10-01" })).toBeNull();
    expect(periodo("personalizado", ahora, { desde: "", hasta: "2026-10-01" })).toBeNull();
  });

  it("los minutos", () => {
    expect(fmtMin(41.4)).toBe("41 min");
    expect(fmtMin(167)).toBe("2 h 47");
    expect(fmtMin(null)).toBe("—");
  });

  it("si el cambio es a mejor o a peor depende de qué se mida", () => {
    expect(comparacion(35, 41, { menosEsMejor: true, unidad: "min" })).toEqual({ texto: "▼ 6 min", tono: "bien" });
    expect(comparacion(52, 48, { menosEsMejor: true, unidad: "min" })).toEqual({ texto: "▲ 4 min", tono: "mal" });
    expect(comparacion(151, 135)).toEqual({ texto: "▲ 12 %", tono: "bien" });
    expect(comparacion(82, 79, { unidad: "puntos" })).toEqual({ texto: "▲ 3 puntos", tono: "bien" });
    expect(comparacion(4.6, 4.6)).toEqual({ texto: "= igual que antes", tono: "igual" });
    expect(comparacion(null, 3)).toBeNull();
  });

  it("el mapa de calor: vacío sin color, el máximo casi lleno", () => {
    expect(intensidad(0, 8)).toBe(0);
    expect(intensidad(8, 8)).toBeCloseTo(0.9);
  });
});
