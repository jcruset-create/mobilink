import { describe, expect, it } from "vitest";

import { dibujoMatricula } from "./matriculaEs";

describe("cómo se dibuja una matrícula", () => {
  it("española actual: cuatro cifras y tres letras, separadas", () => {
    expect(dibujoMatricula("6084FRG")).toEqual({ tipo: "actual", partes: ["6084", "FRG"] });
    expect(dibujoMatricula(" 6084 frg ")).toEqual({ tipo: "actual", partes: ["6084", "FRG"] });
    expect(dibujoMatricula("6084-FRG").tipo).toBe("actual");
  });

  it("remolque: la R delante, en rojo", () => {
    expect(dibujoMatricula("R8535BBY")).toEqual({ tipo: "remolque", partes: ["R", "8535", "BBY"] });
  });

  it("antigua de provincia", () => {
    expect(dibujoMatricula("T1234AB")).toEqual({ tipo: "antigua", partes: ["T", "1234", "AB"] });
    expect(dibujoMatricula("GI-0001-B").tipo).toBe("antigua");
  });

  it("lo que no encaja se queda como está escrito", () => {
    // Con vocales no es española actual.
    expect(dibujoMatricula("1234ABC").tipo).toBe("otra");
    // Con forma de antigua pero sin ser una provincia.
    expect(dibujoMatricula("XY1234Z").tipo).toBe("otra");
    expect(dibujoMatricula("AB123CD")).toEqual({ tipo: "otra", partes: ["AB123CD"] });
    expect(dibujoMatricula("ab 123 cd").partes).toEqual(["AB 123 CD"]);
    expect(dibujoMatricula(null)).toEqual({ tipo: "otra", partes: [""] });
  });
});
