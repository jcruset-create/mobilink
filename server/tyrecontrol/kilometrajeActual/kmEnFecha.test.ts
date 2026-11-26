import { describe, expect, it } from "vitest";

import { kmEnFecha, lecturasDeMeses, ultimoConocido, type LecturaKm, type MesTelematica } from "./kmEnFecha.ts";

const rev = (fecha: string, km: number): LecturaKm => ({ km, fecha, fuente: "revision", detalle: `revisión del ${fecha}` });
const sept: MesTelematica = { year: 2026, month: 9, inicial: 143_709, final: 151_988, distancia: 8_279, cerrado: true };
const nov: MesTelematica = { year: 2026, month: 11, inicial: 161_069, final: 164_000, distancia: 3_143, cerrado: false };

describe("ultimoConocido", () => {
  it("el mayor de todos, venga de donde venga", () => {
    const u = ultimoConocido([rev("2026-11-24", 163_904), rev("2026-10-01", 152_000), ...lecturasDeMeses([sept])]);
    expect(u?.km).toBe(163_904);
    expect(u?.fecha).toBe("2026-11-24");
  });
  it("sin lecturas válidas (un 0 de la importación no lo es), nada", () => {
    expect(ultimoConocido([{ km: 0, fecha: "2026-01-01", fuente: "vehiculo", detalle: "ficha" }])).toBeNull();
  });
});

describe("lecturasDeMeses", () => {
  it("del mes cerrado, inicio y cierre; del mes en curso, solo el inicio", () => {
    const l = lecturasDeMeses([sept, nov]);
    expect(l.map((x) => [x.fecha, x.km])).toEqual([
      ["2026-09-01", 143_709], ["2026-09-30", 151_988], ["2026-11-01", 161_069],
    ]);
  });
});

describe("kmEnFecha", () => {
  it("una lectura de ese día manda", () => {
    const r = kmEnFecha("2026-09-24", [rev("2026-09-24", 149_760)], [sept]);
    expect(r).toMatchObject({ tipo: "lectura", km: 149_760 });
  });

  it("entre dos lecturas cercanas, en línea recta por días", () => {
    const r = kmEnFecha("2026-09-24", [rev("2026-09-20", 148_950), rev("2026-09-28", 151_050)], []);
    expect(r.tipo).toBe("interpolado");
    expect((r as { km: number }).km).toBe(150_000);
  });

  it("con solo la telemática del mes cerrado, interpola entre el día 1 y el 30", () => {
    const r = kmEnFecha("2026-09-24", [], [sept]);
    expect(r.tipo).toBe("interpolado");
    // 143.709 + 8.279 × 23/29
    expect((r as { km: number }).km).toBe(150_275);
  });

  it("del mes en curso (sin cierre), estimado con lo que lleva rodado", () => {
    const r = kmEnFecha("2026-11-15", [], [nov]);
    expect(r).toMatchObject({ tipo: "estimado", km: Math.round(161_069 + 3_143 * 15 / 30) });
  });

  it("lecturas demasiado lejos no se usan para interpolar", () => {
    const r = kmEnFecha("2026-06-15", [rev("2026-01-10", 100_000), rev("2026-12-10", 170_000)], []);
    expect(r.tipo).toBe("sin_datos");
  });

  it("si la de después es menor (cambio de equipo, dedazo), no se inventa una recta", () => {
    const r = kmEnFecha("2026-09-24", [rev("2026-09-20", 150_000), rev("2026-09-28", 140_000)], []);
    expect(r.tipo).toBe("sin_datos");
  });
});
