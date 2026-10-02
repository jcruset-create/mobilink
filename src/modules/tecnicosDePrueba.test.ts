import { describe, expect, it } from "vitest";
import { esTecnicoDePrueba } from "./tecnicosDePrueba";

describe("esTecnicoDePrueba", () => {
  it("caza los dos que salían en Ausencias", () => {
    expect(esTecnicoDePrueba("PROVA")).toBe(true);
    expect(esTecnicoDePrueba("Prova Taller Tarragona")).toBe(true);
  });

  it("y los de siempre", () => {
    expect(esTecnicoDePrueba("Técnico prueba")).toBe(true);
    expect(esTecnicoDePrueba("Test")).toBe(true);
  });

  it("no se lleva a un técnico real por delante", () => {
    for (const n of ["Ramón", "José", "Iván", "Alejandro", "Anthoni", "David", "Albert", "Andrés", "Jesús", "Ernest"]) {
      expect(esTecnicoDePrueba(n), n).toBe(false);
    }
  });
});
