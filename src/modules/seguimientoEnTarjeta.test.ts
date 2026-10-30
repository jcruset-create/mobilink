import { describe, expect, it } from "vitest";
import { avisoDeSeguimiento, pasosDeSeguimiento, tieneSeguimiento } from "./seguimientoEnTarjeta";
import type { RoadsideAssistance } from "./roadsideAssistanceTypes";

describe("avisoDeSeguimiento", () => {
  it("en camino con ETA: el mismo texto que ve el cliente", () => {
    expect(avisoDeSeguimiento({ status: "en_camino", etaMinutos: 6, etaKm: "9.5", etaActualizadoAt: 123 })).toEqual({
      titulo: "El técnico está en camino",
      detalle: "Tiempo estimado de llegada: 6 min · 9.5 km",
      actualizadoMs: 123,
      tono: "azul",
    });
  });

  it("sin ETA no se inventa una", () => {
    expect(avisoDeSeguimiento({ status: "en_camino" })?.detalle).toBe("En camino hacia el punto");
  });

  it("vuelta al taller: otro título y otro tono", () => {
    expect(avisoDeSeguimiento({ status: "en_camino_base", etaMinutos: 12, etaKm: "20" })).toMatchObject({
      titulo: "El técnico vuelve al taller",
      tono: "teal",
    });
  });

  it("en el punto, reparando o asignada: sin aviso", () => {
    for (const status of ["asignada", "en_punto", "inicio_reparacion", "finalizada"]) {
      expect(avisoDeSeguimiento({ status })).toBeNull();
    }
  });
});

describe("pasosDeSeguimiento", () => {
  const a = {
    status: "en_camino",
    createdAtMs: 1000,
    assignedAtMs: 2000,
    departedAtMs: 3000,
  } as unknown as RoadsideAssistance;

  it("hechos, actual y pendientes, con su hora", () => {
    const pasos = pasosDeSeguimiento(a);
    expect(pasos.map((p) => p.estado)).toEqual([
      "hecho", "hecho", "actual", "pendiente", "pendiente", "pendiente", "pendiente", "pendiente",
    ]);
    expect(pasos.map((p) => p.horaMs)).toEqual([1000, 2000, 3000, null, null, null, null, null]);
    expect(pasos[0].etiqueta).toBe("Gestionada");
    expect(pasos[2].etiqueta).toBe("En camino");
  });

  it("la hora de un paso sale del registro de eventos si la columna está a nulo", () => {
    const pasos = pasosDeSeguimiento({ ...a, assignedAtMs: null } as any, [
      { status: "asignada", createdAtMs: 2500 },
    ]);
    expect(pasos[1].horaMs).toBe(2500);
  });

  it("un estado fuera del flujo (redirigida) deja el primero como actual", () => {
    expect(pasosDeSeguimiento({ ...a, status: "redirigida" } as any)[0].estado).toBe("actual");
  });
});

describe("tieneSeguimiento", () => {
  it("sin token no; en manos de otro taller tampoco", () => {
    expect(tieneSeguimiento({ trackingToken: "abc" })).toBe(true);
    expect(tieneSeguimiento({ trackingToken: "" })).toBe(false);
    expect(tieneSeguimiento({ trackingToken: null })).toBe(false);
    expect(tieneSeguimiento({ trackingToken: "abc", sinSeguimiento: true })).toBe(false);
  });
});
