/**
 * Lo que se fija aquí es que la procedencia NO se invente nada.
 *
 * Un parte es un documento que firma un cliente: si dice que el kilometraje
 * viene de telemática y de una fecha, tiene que ser verdad. Cuando no consta,
 * se calla, que es distinto de decir «desconocido».
 */

import { describe, expect, it } from "vitest";

import { procedenciaKm } from "./procedenciaKm.ts";

describe("procedenciaKm", () => {
  it("dice el origen en cristiano, no el código interno", () => {
    expect(procedenciaKm({ km: 482315, origen: "telematica" }))
      .toBe("Kilómetros: 482315 km. Origen: telemática.");
    expect(procedenciaKm({ km: 1000, origen: "manual" }))
      .toBe("Kilómetros: 1000 km. Origen: introducido a mano.");
  });

  it("con lectura de telemática, la fecha va en el documento", () => {
    expect(procedenciaKm({
      km: 482315, origen: "telematica",
      capturadoAt: new Date(2026, 8, 16, 10, 42),
    })).toBe("Kilómetros: 482315 km. Origen: telemática — lectura del 16/09/2026 10:42.");
  });

  it("sin origen se calla: «desconocido» no añade nada y siembra dudas", () => {
    expect(procedenciaKm({ km: 100, origen: null })).toBeNull();
    expect(procedenciaKm({ km: 100, origen: "  " })).toBeNull();
  });

  it("sin kilometraje no hay nada que trazar", () => {
    expect(procedenciaKm({ km: null, origen: "telematica" })).toBeNull();
    expect(procedenciaKm({ km: undefined, origen: "telematica" })).toBeNull();
    expect(procedenciaKm({ km: Number.NaN, origen: "telematica" })).toBeNull();
  });

  it("un origen fuera del catálogo se imprime tal cual, no se calla", () => {
    // Es un dato real aunque el catálogo se haya quedado corto.
    expect(procedenciaKm({ km: 5, origen: "sonda_nueva" })).toContain("Origen: sonda_nueva");
  });

  it("los kilómetros se redondean: un parte no lleva decimales de odómetro", () => {
    expect(procedenciaKm({ km: 482315.47, origen: "telematica" })).toContain("482315 km");
  });

  it("webfleet conserva su nombre, que es el que conoce el cliente", () => {
    expect(procedenciaKm({ km: 10, origen: "webfleet" })).toContain("telemática Webfleet");
  });
});
