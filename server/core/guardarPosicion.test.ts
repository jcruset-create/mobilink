import { describe, expect, it } from "vitest";
import { debeGuardarPosicion, REFRESCO_MAXIMO_MS } from "./guardarPosicion.ts";
import { MAX_EDAD_POSICION_MS } from "./posicionDoble.ts";

const T = 1_800_000_000_000;
const aqui = { lat: 41.1189, lng: 1.2445, atMs: T };

describe("¿se guarda la posición del operario?", () => {
  it("sin nada guardado, sí", () => {
    expect(debeGuardarPosicion({ lat: null, lng: null, atMs: null }, aqui)).toBe(true);
  });

  it("parado y reciente: no", () => {
    expect(debeGuardarPosicion(aqui, { lat: 41.11891, lng: 1.24451, atMs: T + 60_000 })).toBe(false);
  });

  it("parado pero lo guardado envejece: sí, antes de que el panel lo dé por viejo", () => {
    expect(debeGuardarPosicion(aqui, { ...aqui, atMs: T + REFRESCO_MAXIMO_MS })).toBe(true);
    expect(REFRESCO_MAXIMO_MS).toBeLessThan(MAX_EDAD_POSICION_MS);
  });

  it("se ha movido de verdad: sí, aunque haga un minuto", () => {
    // Unos 110 m al norte.
    expect(debeGuardarPosicion(aqui, { lat: 41.1199, lng: 1.2445, atMs: T + 60_000 })).toBe(true);
  });

  it("la misma lectura de antes, o una más vieja: no", () => {
    expect(debeGuardarPosicion(aqui, aqui)).toBe(false);
    expect(debeGuardarPosicion(aqui, { lat: 41.2, lng: 1.3, atMs: T - 1 })).toBe(false);
  });
});
