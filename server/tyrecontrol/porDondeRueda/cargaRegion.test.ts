import { describe, expect, it } from "vitest";
import { buscar, unicos } from "./indiceNodos.ts";

describe("índice de nodos de la carga de región", () => {
  it("ordena y quita repetidos, con ids de más de 32 bits", () => {
    expect([...unicos([5, 10_000_000_001, 5, 1, 3])]).toEqual([1, 3, 5, 10_000_000_001]);
  });
  it("búsqueda binaria: encuentra y dice -1 si no está", () => {
    const ids = unicos([7, 3, 9, 10_000_000_001]);
    expect(buscar(ids, 9)).toBe(2);
    expect(buscar(ids, 10_000_000_001)).toBe(3);
    expect(buscar(ids, 4)).toBe(-1);
  });
  it("aguanta el tamaño de Cataluña (millones de puntos) en poco tiempo", () => {
    const n = 3_000_000;
    const t = Date.now();
    const ids = unicos(Array.from({ length: n }, (_, i) => (i * 7919) % n + 1e10));
    for (let i = 0; i < 100_000; i++) buscar(ids, 1e10 + i);
    expect(ids.length).toBe(n);
    expect(Date.now() - t).toBeLessThan(5_000);
  });
});
