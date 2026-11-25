import { describe, expect, it, vi } from "vitest";

vi.mock("../../supabase.ts", () => ({ supabase: {} }));

import { resumenFlota, resumenVehiculo, type FilaGuardada } from "./resumen.ts";
const { filasDeOverpass } = await import("./mapa.ts");

const f = (vehiculo_id: string, fecha: string, tipo: FilaGuardada["tipo"], ref: string, km: number, segundos = 600): FilaGuardada =>
  ({ vehiculo_id, fecha, tipo, ref, km, segundos });

describe("resumenVehiculo", () => {
  it("por mes, total y carreteras", () => {
    const r = resumenVehiculo([
      f("a", "2026-10-30", "autovia", "A-2", 100),
      f("a", "2026-11-01", "autovia", "A-2", "50.5" as unknown as number),
      f("a", "2026-11-01", "urbana", "", 12),
      f("a", "2026-11-02", "nacional", "N-340", 30),
    ]);
    expect(r.meses.map((m) => m.mes)).toEqual(["2026-10", "2026-11"]);
    expect(r.meses[1].porTipo.autovia.km).toBe(50.5);
    expect(r.total.autovia.km).toBe(150.5);
    expect(r.carreteras.map((c) => c.ref)).toEqual(["A-2", "N-340"]);
  });
});

describe("resumenFlota", () => {
  it("% urbano sobre los km con vía", () => {
    const [v] = resumenFlota([
      f("a", "2026-11-01", "urbana", "", 20),
      f("a", "2026-11-01", "autovia", "A-2", 60),
      f("a", "2026-11-02", "sin_via", "", 20),
    ]);
    expect(v.km).toBe(100);
    expect(v.dias).toBe(2);
    expect(v.pctUrbana).toBe(25);
  });
});

describe("filasDeOverpass", () => {
  it("vías con geometría a EWKT; lo demás fuera", () => {
    const filas = filasDeOverpass({
      elements: [
        { type: "way", id: 7, tags: { highway: "motorway", ref: "AP-7;E-15", toll: "yes", maxspeed: "120", name: "Autopista" },
          geometry: [{ lat: 41.1, lon: 1.2 }, { lat: 41.11, lon: 1.21 }] },
        { type: "way", id: 8, tags: { highway: "residential" }, geometry: [{ lat: 41.1, lon: 1.2 }] },
        { type: "node", id: 9 },
      ],
    });
    expect(filas).toEqual([{
      osm_id: 7, highway: "motorway", ref: "AP-7", nombre: "Autopista", maxspeed: 120, peaje: true,
      geom: "SRID=4326;LINESTRING(1.2 41.1,1.21 41.11)",
    }]);
  });
});
