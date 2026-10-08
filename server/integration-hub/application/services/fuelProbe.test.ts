import { describe, it, expect } from "vitest";
import { inventarioCombustible, veredictoCombustible } from "./fuelProbe.ts";

describe("inventarioCombustible", () => {
  it("el cero de Webfleet sin CAN no cuenta como dato", () => {
    const c = inventarioCombustible([{ fuel_usage: 0, co2: 0 }, { fuel_usage: "0" }]);
    expect(c).toEqual([expect.objectContaining({ campo: "fuel_usage", apariciones: 2, conValor: 0 })]);
    expect(veredictoCombustible(c, 2)).toContain("no hay sensor detrás");
  });

  it("encuentra el contador de combustible de Movertis dentro de counters", () => {
    const c = inventarioCombustible([
      { counters: { odometer: 800000, fuel_used: 412345.5 } },
      { counters: { odometer: 800100, fuel_used: 412380 } },
    ]);
    expect(c[0]).toMatchObject({ campo: "counters.fuel_used", conValor: 2, min: 412345.5, max: 412380 });
    expect(veredictoCombustible(c, 2)).toContain("counters.fuel_used (2/2)");
  });

  it("un sensor se reconoce por su NOMBRE, no por su clave", () => {
    const c = inventarioCombustible([{ sensors: [
      { name: "Nivel depósito", value: 43 },
      { name: "Temperatura", value: 21 },
    ] }]);
    expect(c.map((x) => x.campo)).toEqual(["sensors[]{Nivel depósito}.value"]);
  });

  it("«sin dato» cuenta como presente pero no numérico", () => {
    const c = inventarioCombustible([{ sensors: [{ name: "Fuel level", value: "sin dato" }] }]);
    expect(c[0]).toMatchObject({ conValor: 0, noNumericas: 1, ejemplos: ["sin dato"] });
  });

  it("no devuelve nada que no sea combustible: ni matrícula ni posición", () => {
    const c = inventarioCombustible([{ plate: "1234ABC", lat: 41.1, lng: 1.2, odometer: 5 }]);
    expect(c).toEqual([]);
    expect(veredictoCombustible(c, 1)).toContain("Ninguna de las 1 lecturas");
  });
});
