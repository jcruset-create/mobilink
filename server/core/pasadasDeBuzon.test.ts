import { describe, expect, it } from "vitest";
import { hayQueGuardarPasada } from "./pasadasDeBuzon.ts";

const nada = { origen: "temporizador" as const, correos: 0, error: null };

describe("¿se guarda la pasada del buzón?", () => {
  it("otra vez nada, después de una buena: no", () => {
    expect(hayQueGuardarPasada(nada, { error: null })).toBe(false);
  });

  it("otra vez el MISMO fallo: no; un fallo nuevo o distinto: sí", () => {
    expect(hayQueGuardarPasada({ ...nada, error: "sin contraseña" }, { error: "sin contraseña" })).toBe(false);
    expect(hayQueGuardarPasada({ ...nada, error: "sin contraseña" }, { error: null })).toBe(true);
    expect(hayQueGuardarPasada({ ...nada, error: "carpeta no existe" }, { error: "sin contraseña" })).toBe(true);
  });

  it("vuelve a funcionar después de un fallo: sí, o la pantalla seguiría diciendo que no se lee", () => {
    expect(hayQueGuardarPasada(nada, { error: "sin contraseña" })).toBe(true);
  });

  it("con correos, la primera, o pedida por una persona: siempre", () => {
    expect(hayQueGuardarPasada({ ...nada, correos: 1 }, { error: null })).toBe(true);
    expect(hayQueGuardarPasada(nada, null)).toBe(true);
    expect(hayQueGuardarPasada({ ...nada, origen: "manual" }, { error: null })).toBe(true);
    expect(hayQueGuardarPasada({ ...nada, origen: "historico" }, { error: null })).toBe(true);
  });
});
