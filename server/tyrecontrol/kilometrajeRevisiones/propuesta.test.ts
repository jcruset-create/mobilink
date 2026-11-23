import { describe, expect, it } from "vitest";
import { proponer, validarManual, type LecturaHub } from "./propuesta.ts";

const leida = (km: number, corroboracion: "dos_ventanas" | "una_ventana" = "dos_ventanas"): LecturaHub =>
  ({ estado: "encontrado", odometro: { odometerKm: km, corroboracion, instante: new Date("2026-11-20T23:00:00Z") } });

describe("proponer (km de una revisión o un montaje a demanda)", () => {
  it("dos consultas que coinciden y cuadra con las vecinas: ok", () => {
    const p = proponer(leida(33861.4), { siguiente: { km: 34157, fecha: "2026-11-23" } });
    expect(p).toMatchObject({ estado: "ok", km: 33861, corroboracion: "dos_ventanas" });
  });
  it("por encima de la revisión siguiente: no", () => {
    const p = proponer(leida(35000), { siguiente: { km: 34157, fecha: "2026-11-23" } });
    expect(p.estado).toBe("no");
  });
  it("una sola consulta y nada con qué comprobarla: no", () => {
    expect(proponer(leida(30000, "una_ventana"), {}).estado).toBe("no");
    expect(proponer(leida(30000, "una_ventana"), { hoy: { km: 34200 } }).estado).toBe("ok");
  });
  it("hoy, sin telemática o sin lectura: no, con el motivo", () => {
    expect(proponer({ estado: "dia_abierto", motivo: "x" }, {})).toMatchObject({ estado: "no", motivo: expect.stringContaining("mañana") });
    expect(proponer({ estado: "sin_telematica" }, {})).toMatchObject({ estado: "no", motivo: expect.stringContaining("enlazado") });
    expect(proponer({ estado: "sin_lectura" }, {}).estado).toBe("no");
  });
});

describe("validarManual", () => {
  const cotas = { anterior: { km: 30000, fecha: "2025-10-08" }, siguiente: { km: 34157, fecha: "2026-11-23" } };
  it("acepta con puntos de miles y comas", () => {
    expect(validarManual("33.861", cotas)).toEqual({ estado: "ok", km: 33861 });
    expect(validarManual("33861,6", cotas)).toEqual({ estado: "ok", km: 33862 });
  });
  it("rechaza lo que no cuadra o no es un número", () => {
    expect(validarManual("40000", cotas).estado).toBe("no");
    expect(validarManual("29000", cotas).estado).toBe("no");
    expect(validarManual("abc", cotas).estado).toBe("no");
    expect(validarManual("0", cotas).estado).toBe("no");
  });
});
