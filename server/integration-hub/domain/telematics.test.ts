/**
 * La regla del 0,0.
 *
 * Parece una tontería y no lo es: `0,0` es una coordenada perfectamente válida
 * —está en el Golfo de Guinea— y en telemática significa casi siempre que el
 * equipo no tenía fijación GPS. Darla por buena pone los camiones de Tarragona
 * en mitad del Atlántico, y lo hace en silencio.
 *
 * El código actual comprueba las coordenadas con `Number.isFinite()`, que deja
 * pasar el cero. De ahí que esto sea una función aparte y con pruebas.
 */

import { describe, expect, it } from "vitest";

import { esPosicionValida } from "./telematics.ts";

describe("Posiciones que hay que descartar", () => {
  it("el 0,0 no es una posición", () => {
    expect(esPosicionValida(0, 0)).toBe(false);
    expect(esPosicionValida("0", "0")).toBe(false);
    expect(esPosicionValida(0.0, -0.0)).toBe(false);
  });

  it("lo que no es un número tampoco", () => {
    expect(esPosicionValida(null, null)).toBe(false);
    expect(esPosicionValida(undefined, undefined)).toBe(false);
    expect(esPosicionValida("", "")).toBe(false);
    expect(esPosicionValida("no", "va")).toBe(false);
    expect(esPosicionValida(NaN, 2)).toBe(false);
    expect(esPosicionValida(Infinity, 2)).toBe(false);
  });

  it("fuera de rango, fuera: así llegan muchos centinelas de «sin dato»", () => {
    expect(esPosicionValida(91, 0)).toBe(false);
    expect(esPosicionValida(-91, 0)).toBe(false);
    expect(esPosicionValida(0, 181)).toBe(false);
    expect(esPosicionValida(0, -181)).toBe(false);
    expect(esPosicionValida(999, 999)).toBe(false);
  });
});

describe("Posiciones buenas", () => {
  it("Tarragona pasa", () => {
    expect(esPosicionValida(41.1189, 1.2445)).toBe(true);
  });

  it("un cero SOLO en uno de los dos ejes es legítimo", () => {
    // El meridiano de Greenwich pasa por sitios donde hay camiones.
    expect(esPosicionValida(41.1189, 0)).toBe(true);
    expect(esPosicionValida(0, 1.2445)).toBe(true);
  });

  it("los extremos del rango son válidos", () => {
    expect(esPosicionValida(90, 180)).toBe(true);
    expect(esPosicionValida(-90, -180)).toBe(true);
  });

  it("acepta números en texto, que es como llegan de muchas APIs", () => {
    expect(esPosicionValida("41.1189", "1.2445")).toBe(true);
  });
});
