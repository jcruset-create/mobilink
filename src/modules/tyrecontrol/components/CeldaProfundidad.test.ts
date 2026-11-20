import { describe, expect, it } from "vitest";
import { deltaBandas, desgasteIrregular } from "./CeldaProfundidad";

// La misma regla que la APK (test/medicion_doble_test.dart): el aviso de
// desgaste irregular sale con las DOS bandas medidas y una diferencia igual o
// mayor que el umbral de la empresa; sin umbral, nunca.
describe("desgaste irregular en la ficha de la revisión", () => {
  it("Δ solo con las dos bandas", () => {
    expect(deltaBandas({ profundidad_int_mm: 7.8, profundidad_ext_mm: 4.1 })).toBeCloseTo(3.7);
    expect(deltaBandas({ profundidad_int_mm: 7.8, profundidad_ext_mm: null })).toBeNull();
    expect(deltaBandas({})).toBeNull();
  });

  it("avisa desde el umbral, incluido el propio umbral", () => {
    expect(desgasteIrregular({ profundidad_int_mm: 6, profundidad_ext_mm: 4 }, 2)).toBe(true);
    expect(desgasteIrregular({ profundidad_int_mm: 6, profundidad_ext_mm: 4.5 }, 2)).toBe(false);
  });

  it("sin umbral (aviso apagado) no avisa nunca", () => {
    expect(desgasteIrregular({ profundidad_int_mm: 9, profundidad_ext_mm: 1 }, null)).toBe(false);
    expect(desgasteIrregular({ profundidad_int_mm: 9, profundidad_ext_mm: 1 }, undefined)).toBe(false);
  });
});
