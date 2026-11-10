import { describe, expect, it } from "vitest";

import { crearCacheEta, ESTADOS_ETA_ESTIMADA } from "./etaEstimada.ts";

describe("ETA aproximada antes de salir", () => {
  it("se enseña en «Asignada» y no en otros estados", () => {
    expect(ESTADOS_ETA_ESTIMADA.has("asignada")).toBe(true);
    expect(ESTADOS_ETA_ESTIMADA.has("en_camino")).toBe(false);
    expect(ESTADOS_ETA_ESTIMADA.has("pendiente")).toBe(false);
  });

  it("mientras es reciente, no se vuelve a calcular", () => {
    const cache = crearCacheEta(60_000);
    cache.guardar(7, { minutos: 25, kilometros: "18.2", calculadaAtMs: 1_000 });
    expect(cache.leer(7, 30_000)).toMatchObject({ minutos: 25 });
    expect(cache.leer(8, 30_000)).toBeNull();
  });

  it("pasado el tiempo, caduca y hay que calcularla otra vez", () => {
    const cache = crearCacheEta(60_000);
    cache.guardar(7, { minutos: 25, kilometros: "18.2", calculadaAtMs: 1_000 });
    expect(cache.leer(7, 62_000)).toBeNull();
    expect(cache.tamano).toBe(0);
  });

  it("no crece sin fin", () => {
    const cache = crearCacheEta(60_000);
    for (let i = 0; i < 600; i++) {
      cache.guardar(i, { minutos: 1, kilometros: "1", calculadaAtMs: i < 300 ? 0 : 1_000_000 });
    }
    expect(cache.tamano).toBeLessThanOrEqual(500);
  });
});
