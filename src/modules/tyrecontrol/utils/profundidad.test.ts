import { describe, it, expect } from "vitest";
import { profundidadVigente } from "./profundidad";

// Mismos casos que la prueba de la APK (profundidad_vigente_test.dart): las
// dos implementaciones tienen que decidir igual, o el técnico y el panel verán
// milímetros distintos de la misma rueda.
describe("profundidadVigente", () => {
  const ayer = "2026-08-03T09:00:00Z";
  const hoy = "2026-08-04T09:00:00Z";

  it("reescultura DESPUÉS de la revisión: mandan los mm nuevos", () => {
    expect(profundidadVigente(
      { profundidad_mm: 4.7, medido_en: ayer },
      { profundidad_actual_mm: 8, profundidad_actualizada_en: hoy },
    )).toBe(8);
  });

  it("revisión DESPUÉS del montaje: manda la medición", () => {
    expect(profundidadVigente(
      { profundidad_mm: 7.2, medido_en: hoy },
      { profundidad_actual_mm: 8, profundidad_actualizada_en: ayer },
    )).toBe(7.2);
  });

  it("sin medición: manda la del neumático", () => {
    expect(profundidadVigente(null, { profundidad_actual_mm: 16.5 })).toBe(16.5);
    expect(profundidadVigente({ profundidad_mm: null }, { profundidad_actual_mm: 16.5 })).toBe(16.5);
  });

  it("sin profundidad propia: manda la medición", () => {
    expect(profundidadVigente({ profundidad_mm: 4.7, medido_en: ayer }, {})).toBe(4.7);
  });

  it("sin ninguna de las dos: no hay dato", () => {
    expect(profundidadVigente(null, null)).toBeNull();
    expect(profundidadVigente(undefined, undefined)).toBeNull();
  });

  it("si falta alguna fecha manda la MEDICIÓN, que es el dato de sonda", () => {
    expect(profundidadVigente(
      { profundidad_mm: 4.7 },
      { profundidad_actual_mm: 8, profundidad_actualizada_en: hoy },
    )).toBe(4.7);
    expect(profundidadVigente(
      { profundidad_mm: 4.7, medido_en: ayer },
      { profundidad_actual_mm: 8 },
    )).toBe(4.7);
  });

  it("una fecha ilegible se trata como ausente", () => {
    expect(profundidadVigente(
      { profundidad_mm: 4.7, medido_en: "no-es-una-fecha" },
      { profundidad_actual_mm: 8, profundidad_actualizada_en: hoy },
    )).toBe(4.7);
  });

  it("empate exacto: manda la medición", () => {
    expect(profundidadVigente(
      { profundidad_mm: 4.7, medido_en: hoy },
      { profundidad_actual_mm: 8, profundidad_actualizada_en: hoy },
    )).toBe(4.7);
  });

  it("un 0 real no se confunde con 'sin dato'", () => {
    expect(profundidadVigente(
      { profundidad_mm: 0, medido_en: hoy },
      { profundidad_actual_mm: 8, profundidad_actualizada_en: ayer },
    )).toBe(0);
  });
});
