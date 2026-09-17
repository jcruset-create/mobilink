/**
 * El panel y el parte tienen que contar lo mismo del mismo dato. Estas
 * pruebas fijan que la ficha no invente una procedencia que no consta.
 */

import { describe, expect, it } from "vitest";

import { explicarKm, hace } from "./procedenciaKm";

const AHORA = new Date("2026-09-17T10:00:00.000Z");
const haceMin = (m: number) => new Date(AHORA.getTime() - m * 60_000).toISOString();

describe("explicarKm", () => {
  it("traduce el origen con las etiquetas del panel", () => {
    expect(explicarKm({ origen: "telematica" })).toBe("Telemática");
    expect(explicarKm({ origen: "manual" })).toBe("Manual");
    expect(explicarKm({ origen: "webfleet" })).toBe("Webfleet");
  });

  it("con fecha de lectura, dice cuánto hace", () => {
    expect(explicarKm({ origen: "telematica", capturadoAt: haceMin(42), ahora: AHORA }))
      .toBe("Telemática · lectura de hace 42 min");
    expect(explicarKm({ origen: "telematica", capturadoAt: haceMin(300), ahora: AHORA }))
      .toBe("Telemática · lectura de hace 5 horas");
  });

  it("sin origen se calla: «desconocido» siembra dudas sobre un dato que puede ser bueno", () => {
    expect(explicarKm({ origen: null })).toBeNull();
    expect(explicarKm({ origen: "   " })).toBeNull();
  });

  it("una fecha corrupta no rompe la ficha: se queda con el origen", () => {
    expect(explicarKm({ origen: "telematica", capturadoAt: "no es una fecha" })).toBe("Telemática");
  });

  it("un origen fuera del catálogo se enseña tal cual", () => {
    expect(explicarKm({ origen: "sonda_nueva" })).toBe("sonda_nueva");
  });
});

describe("hace", () => {
  it("se lee como lo diría una persona", () => {
    expect(hace(new Date(AHORA.getTime() - 30_000), AHORA)).toBe("hace menos de un minuto");
    expect(hace(new Date(AHORA.getTime() - 60 * 60_000), AHORA)).toBe("hace 1 hora");
    expect(hace(new Date(AHORA.getTime() - 25 * 60 * 60_000), AHORA)).toBe("hace 1 día");
  });

  it("una lectura del futuro no dice barbaridades", () => {
    expect(hace(new Date(AHORA.getTime() + 60_000), AHORA)).toBe("hace menos de un minuto");
  });
});
