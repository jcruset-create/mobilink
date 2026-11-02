import { describe, expect, it } from "vitest";
import { detalleDeMeses, listaDeMeses, mesCorto, nombreDeMes } from "./mesesEtiqueta";

/**
 * «1 con error» no se puede arreglar: hay que saber de QUÉ mes se trata. Lo
 * que se fija aquí es que la celda lo diga sin convertirse en un párrafo, y
 * que el año aparezca exactamente cuando hace falta.
 */

describe("nombreDeMes y mesCorto", () => {
  it("el mes se nombra por su número de persona, no por el de JavaScript", () => {
    // Enero es 1. Con el índice de JavaScript saldría febrero.
    expect(nombreDeMes(2026, 1)).toContain("2026");
    expect(mesCorto(2026, 1)).toBe(mesCorto(2026, 1));
    expect(mesCorto(2026, 1)).not.toBe(mesCorto(2026, 2));
  });

  it("diciembre no se desborda al año siguiente", () => {
    expect(nombreDeMes(2025, 12)).toContain("2025");
  });
});

describe("listaDeMeses", () => {
  it("sin meses no escribe nada: una celda vacía es mejor que un «ninguno»", () => {
    expect(listaDeMeses([])).toBe("");
  });

  it("un solo mes lleva su año", () => {
    expect(listaDeMeses([{ year: 2026, month: 3 }])).toMatch(/2026$/);
  });

  it("varios del mismo año: el año se dice una vez, al final", () => {
    const t = listaDeMeses([{ year: 2026, month: 3 }, { year: 2026, month: 7 }]);
    expect(t).toMatch(/2026$/);
    // Una sola vez: decirlo en cada mes hace la celda ilegible.
    expect(t.match(/2026/g)).toHaveLength(1);
  });

  it("cuando cruza de año, cada mes lleva el suyo: «dic, ene» sería una adivinanza", () => {
    const t = listaDeMeses([{ year: 2025, month: 12 }, { year: 2026, month: 1 }]);
    expect(t).toContain("2025");
    expect(t).toContain("2026");
  });

  it("con muchos se corta y se dice cuántos quedan, en vez de romper la tabla", () => {
    const meses = [1, 2, 3, 4, 5].map((month) => ({ year: 2026, month }));
    expect(listaDeMeses(meses)).toMatch(/y 2 más$/);
  });

  it("al cortar NO se escribe el año al final: ese año solo vale para los que se ven", () => {
    const meses = [1, 2, 3, 4].map((month) => ({ year: 2026, month }));
    expect(listaDeMeses(meses)).not.toMatch(/2026 y/);
  });

  it("el tope se puede subir cuando hay sitio", () => {
    const meses = [1, 2, 3, 4].map((month) => ({ year: 2026, month }));
    expect(listaDeMeses(meses, 4)).not.toContain("más");
  });
});

describe("detalleDeMeses", () => {
  it("un mes por línea, con lo que contestó el proveedor", () => {
    expect(detalleDeMeses([
      { year: 2026, month: 3, error: "vehículo no encontrado" },
      { year: 2026, month: 7, error: "timeout del proveedor" },
    ]).split("\n")).toHaveLength(2);
  });

  it("sin mensaje no se inventa uno: solo el mes", () => {
    const t = detalleDeMeses([{ year: 2026, month: 3, error: null }]);
    expect(t).toBe(nombreDeMes(2026, 3));
  });

  it("un mensaje en blanco cuenta como no tenerlo", () => {
    expect(detalleDeMeses([{ year: 2026, month: 3, error: "   " }])).toBe(nombreDeMes(2026, 3));
  });

  it("sirve igual para los huecos, que no traen mensaje", () => {
    expect(detalleDeMeses([{ year: 2026, month: 2 }])).toBe(nombreDeMes(2026, 2));
  });
});
