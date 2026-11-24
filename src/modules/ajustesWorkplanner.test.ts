import { describe, expect, it } from "vitest";
import { AJUSTES_POR_DEFECTO, normalizarAjustes, validarAjustes } from "./ajustesWorkplanner";

describe("normalizarAjustes", () => {
  it("sin nada guardado, los valores que tenía el código", () => {
    expect(normalizarAjustes(undefined)).toEqual(AJUSTES_POR_DEFECTO);
    expect(normalizarAjustes({})).toEqual({ duracionCitaMin: 45, bloqueoTabletMin: 5, radioLlegadaM: 300, radioSalidaTallerM: 500 });
  });
  it("lo guardado manda; lo roto o fuera de tope se corrige", () => {
    expect(normalizarAjustes({ duracionCitaMin: "30", bloqueoTabletMin: 10, radioLlegadaM: 250, radioSalidaTallerM: 800 })).toEqual({
      duracionCitaMin: 30, bloqueoTabletMin: 10, radioLlegadaM: 250, radioSalidaTallerM: 800,
    });
    expect(normalizarAjustes({ duracionCitaMin: "x", bloqueoTabletMin: 0, radioLlegadaM: 99999 })).toEqual({
      duracionCitaMin: 45, bloqueoTabletMin: 1, radioLlegadaM: 5000, radioSalidaTallerM: 500,
    });
  });
});

describe("validarAjustes", () => {
  it("acepta lo razonable y explica lo demás", () => {
    expect(validarAjustes({ duracionCitaMin: "30", bloqueoTabletMin: "5", radioLlegadaM: "300", radioSalidaTallerM: "500" })).toEqual([]);
    const e = validarAjustes({ duracionCitaMin: "", bloqueoTabletMin: "500", radioLlegadaM: "600", radioSalidaTallerM: "500" });
    expect(e).toContain("La duración por defecto de una cita tiene que ser un número.");
    expect(e).toContain("El bloqueo por inactividad tiene que estar entre 1 y 120.");
    expect(e).toContain("El radio de salida del taller tiene que ser mayor que el radio de llegada.");
  });
});
