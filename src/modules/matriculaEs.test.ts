import { describe, expect, it } from "vitest";

import { dibujoMatricula, FUERA_UE, paisMatriculaValido } from "./matriculaEs";

// Estas mismas comprobaciones están en la tablet
// (flutter_app/test/matricula_contacto_test.dart): la regla es una sola.

describe("matrículas españolas", () => {
  it("actual: cuatro cifras y tres letras, con la E", () => {
    expect(dibujoMatricula(" 6084 frg ")).toMatchObject({ tipo: "actual", partes: ["6084", "FRG"], pais: "E", banda: true, fondo: "blanco" });
    expect(dibujoMatricula("6084-FRG").tipo).toBe("actual");
  });

  it("remolque: la R delante, en rojo", () => {
    expect(dibujoMatricula("R8535BBY")).toMatchObject({ tipo: "remolque", partes: ["R", "8535", "BBY"], fondo: "rojo", pais: "E" });
  });

  it("vehículo especial: la E delante, letras rojas", () => {
    expect(dibujoMatricula("E4843BJJ")).toMatchObject({ tipo: "especial", partes: ["E", "4843", "BJJ"], letrasRojas: true, banda: true });
  });

  it("antigua de provincia: sin banda", () => {
    expect(dibujoMatricula("T1234AB")).toMatchObject({ tipo: "antigua", partes: ["T", "1234", "AB"], banda: false });
    expect(dibujoMatricula("GI-0001-B").tipo).toBe("antigua");
  });
});

describe("otros países, cuando la forma no deja dudas", () => {
  it("Portugal: tres parejas", () => {
    expect(dibujoMatricula("45-TX-89")).toMatchObject({ tipo: "ue", pais: "P", partes: ["45", "TX", "89"], separador: "·" });
    expect(dibujoMatricula("AB12CD").pais).toBe("P");
  });

  it("Rumanía: Bucarest o una provincia rumana", () => {
    expect(dibujoMatricula("B123ABC")).toMatchObject({ pais: "RO", partes: ["B", "123", "ABC"] });
    expect(dibujoMatricula("CJ 12 ABC")).toMatchObject({ pais: "RO", partes: ["CJ", "12", "ABC"] });
  });

  it("Polonia", () => {
    expect(dibujoMatricula("WX 1234A")).toMatchObject({ pais: "PL", partes: ["WX", "1234A"] });
  });
});

describe("cuando la forma no basta, no se adivina el país", () => {
  it("Francia e Italia comparten patrón: placa UE sin letra", () => {
    expect(dibujoMatricula("AB-123-CD")).toMatchObject({ tipo: "ue", pais: "", banda: true, partes: ["AB 123 CD"] });
    expect(dibujoMatricula("GG419EZ").pais).toBe("");
  });

  it("una británica no sale como rumana", () => {
    // Misma forma que la rumana, pero «XY» no es una provincia de Rumanía.
    expect(dibujoMatricula("XY12CDE").pais).toBe("");
  });

  it("con vocales no es española actual; con forma de antigua pero sin provincia, tampoco", () => {
    expect(dibujoMatricula("1234ABC").tipo).toBe("ue");
    expect(dibujoMatricula("XY1234Z").tipo).not.toBe("antigua");
  });

  it("lo que no parece una placa, liso y tal cual", () => {
    expect(dibujoMatricula("P109470123456")).toMatchObject({ tipo: "otra", fondo: "liso", banda: false });
    expect(dibujoMatricula("SIN PLACA").tipo).toBe("otra");
    expect(dibujoMatricula(null)).toMatchObject({ tipo: "otra", partes: [""] });
  });
});

describe("con el país indicado", () => {
  it("Francia con guiones, Italia con espacios", () => {
    expect(dibujoMatricula("AB123CD", "F")).toMatchObject({ pais: "F", partes: ["AB", "123", "CD"], separador: "-" });
    expect(dibujoMatricula("AB123CD", "I")).toMatchObject({ pais: "I", separador: " " });
  });

  it("Países Bajos en amarillo; Alemania tal cual se escribió", () => {
    expect(dibujoMatricula("12-ABC-3", "NL")).toMatchObject({ pais: "NL", fondo: "amarillo", partes: ["12 ABC 3"] });
    expect(dibujoMatricula("M AB 1234", "D")).toMatchObject({ pais: "D", partes: ["M AB 1234"], fondo: "blanco" });
  });

  it("fuera de la UE: liso, aunque tenga forma de española", () => {
    expect(dibujoMatricula("6084FRG", FUERA_UE)).toMatchObject({ tipo: "otra", banda: false, fondo: "liso" });
  });

  it("un país que no existe es como no indicarlo", () => {
    expect(dibujoMatricula("6084FRG", "ZZ").tipo).toBe("actual");
    expect(paisMatriculaValido(" f ")).toBe("F");
    expect(paisMatriculaValido("")).toBeNull();
    expect(paisMatriculaValido("ZZ")).toBeNull();
  });
});
