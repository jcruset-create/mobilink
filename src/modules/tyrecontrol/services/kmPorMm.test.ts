import { describe, expect, it } from "vitest";
import { agruparPorModelo, claveDe, nombreDeEje, ordenar } from "./kmPorMm";
import type { KmPorMmFila } from "../types/informes";

/** Una fila de la RPC, con lo justo; el resto se rellena. */
function fila(p: Partial<KmPorMmFila>): KmPorMmFila {
  return {
    marca: "Hankook", modelo: "AH51", eje: 1,
    tramos: 1, neumaticos: 1,
    km_totales: 10000, mm_totales: 1, km_por_mm: 10000,
    p25: 9000, mediana: 10000, p75: 11000,
    mm_nuevo: 15, mm_retirada: 3,
    neumaticos_modelo: 1,
    ...p,
  };
}

describe("agruparPorModelo", () => {
  it("junta los ejes de un modelo en una sola fila", () => {
    const r = agruparPorModelo([
      fila({ eje: 1, tramos: 249 }),
      fila({ eje: 2, tramos: 316 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].clave).toBe("Hankook · AH51");
    expect(r[0].tramos).toBe(565);
    expect(r[0].ejes.map((e) => e.eje)).toEqual([1, 2]);
  });

  /**
   * La prueba que justifica el módulo. Los números son los reales del AH51 de
   * Plana: tres ejes a 6.838, 10.326 y 9.587 km/mm.
   *
   * Promediarlos da 8.917. Lo correcto es Σkm/Σmm = 8.682, porque el eje 3
   * tiene 27 tramos y el eje 2 tiene 316: no pueden pesar igual.
   */
  it("el km/mm del modelo es la razón de las sumas, no la media de las razones", () => {
    const r = agruparPorModelo([
      fila({ eje: 1, tramos: 249, km_totales: 7674473, mm_totales: 1122.3, km_por_mm: 6838 }),
      fila({ eje: 2, tramos: 316, km_totales: 12380601, mm_totales: 1199.0, km_por_mm: 10326 }),
      fila({ eje: 3, tramos: 27, km_totales: 1037354, mm_totales: 108.2, km_por_mm: 9587 }),
    ]);
    expect(r[0].kmPorMm).toBe(8682);
    expect(r[0].kmPorMm).not.toBe(8917);
  });

  it("no suma los neumáticos de cada eje: usa el recuento del modelo", () => {
    // Las mismas 570 gomas aparecen en las tres filas; sumarlas daría 1.710.
    const r = agruparPorModelo([
      fila({ eje: 1, neumaticos: 240, neumaticos_modelo: 570 }),
      fila({ eje: 2, neumaticos: 304, neumaticos_modelo: 570 }),
      fila({ eje: 3, neumaticos: 26, neumaticos_modelo: 570 }),
    ]);
    expect(r[0].neumaticos).toBe(570);
  });

  it("estima la vida completa de nuevo a retirada", () => {
    const r = agruparPorModelo([
      fila({ km_totales: 86820, mm_totales: 10, km_por_mm: 8682, mm_nuevo: 15, mm_retirada: 3 }),
    ]);
    // 12 mm útiles × 8.682 km/mm
    expect(r[0].vidaKm).toBe(104184);
  });

  it("no inventa la vida si falta un extremo o no tiene sentido", () => {
    const sinNuevo = agruparPorModelo([fila({ mm_nuevo: null })]);
    expect(sinNuevo[0].vidaKm).toBeNull();
    const alReves = agruparPorModelo([fila({ mm_nuevo: 3, mm_retirada: 15 })]);
    expect(alReves[0].vidaKm).toBeNull();
  });

  it("se traga los numeric que lleguen como cadena", () => {
    const r = agruparPorModelo([
      { ...fila({}), km_totales: "20000" as unknown as number, mm_totales: "2" as unknown as number },
    ]);
    expect(r[0].kmPorMm).toBe(10000);
  });

  it("separa marcas distintas aunque el modelo se llame igual", () => {
    const r = agruparPorModelo([
      fila({ marca: "Hankook", modelo: "AH51" }),
      fila({ marca: "Uniroyal", modelo: "AH51" }),
    ]);
    expect(r).toHaveLength(2);
  });

  it("deja los ejes sin posición al final y no los pierde", () => {
    const r = agruparPorModelo([fila({ eje: null }), fila({ eje: 2 })]);
    expect(r[0].ejes.map((e) => e.eje)).toEqual([2, null]);
  });

  it("sin filas, lista vacía", () => {
    expect(agruparPorModelo([])).toEqual([]);
  });
});

describe("ordenar", () => {
  const modelos = agruparPorModelo([
    fila({ marca: "A", modelo: "mucho", km_totales: 1000000, mm_totales: 200, mm_nuevo: 15, mm_retirada: 3 }),
    fila({ marca: "B", modelo: "poco", km_totales: 50000, mm_totales: 2, mm_nuevo: 15, mm_retirada: 3 }),
  ]);

  it("por defecto manda la evidencia, no el récord", () => {
    // «poco» va a 25.000 km/mm y «mucho» a 5.000, pero «poco» tiene 2 mm medidos.
    expect(ordenar(modelos, "evidencia").map((m) => m.modelo)).toEqual(["mucho", "poco"]);
  });

  it("por km/mm manda el ritmo", () => {
    expect(ordenar(modelos, "km_por_mm").map((m) => m.modelo)).toEqual(["poco", "mucho"]);
  });

  it("por vida manda la vida estimada", () => {
    expect(ordenar(modelos, "vida").map((m) => m.modelo)).toEqual(["poco", "mucho"]);
  });

  it("no toca la lista que recibe", () => {
    const antes = modelos.map((m) => m.modelo);
    ordenar(modelos, "km_por_mm");
    expect(modelos.map((m) => m.modelo)).toEqual(antes);
  });
});

describe("nombreDeEje y claveDe", () => {
  it("el eje se nombra por número, sin adivinar si es directriz", () => {
    expect(nombreDeEje(1)).toBe("Eje 1");
    expect(nombreDeEje(null)).toBe("Sin posición");
  });
  it("la clave junta marca y modelo", () => {
    expect(claveDe(" Hankook ", " AH51 ")).toBe("Hankook · AH51");
  });
});
