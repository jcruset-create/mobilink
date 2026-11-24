import { describe, expect, it } from "vitest";

import { horaCapturaValida, horaDeLaFirma } from "./horaCaptura.ts";

const ahora = Date.UTC(2026, 10, 24, 9, 30);
const H = 3600_000;

describe("hora en que se hizo la foto o la firma", () => {
  it("la que manda la tablet, si cuadra", () => {
    expect(horaCapturaValida(ahora - 2 * H, ahora)).toBe(ahora - 2 * H);
    expect(horaCapturaValida(String(ahora - 60_000), ahora)).toBe(ahora - 60_000);
  });

  it("en el futuro o de hace más de una semana, no", () => {
    expect(horaCapturaValida(ahora + H, ahora)).toBeNull();
    expect(horaCapturaValida(ahora - 8 * 24 * H, ahora)).toBeNull();
  });

  it("sin dato o basura, no", () => {
    expect(horaCapturaValida(undefined, ahora)).toBeNull();
    expect(horaCapturaValida("", ahora)).toBeNull();
    expect(horaCapturaValida("ayer", ahora)).toBeNull();
    expect(horaCapturaValida(0, ahora)).toBeNull();
  });

  it("en el informe manda la de la firma; si no la hay, la de llegada", () => {
    expect(horaDeLaFirma({ capturadaAtMs: "1000", createdAtMs: "5000" })).toBe(1000);
    expect(horaDeLaFirma({ capturadaAtMs: null, createdAtMs: "5000" })).toBe(5000);
    expect(horaDeLaFirma(null)).toBeNull();
  });
});
