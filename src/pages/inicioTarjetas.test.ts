import { describe, expect, it } from "vitest";
import { tarjetasPropiasVisibles } from "./inicioTarjetas";

describe("tarjetasPropiasVisibles", () => {
  it("sin acceso a ninguna, no se ve ninguna", () => {
    // El caso que lo destapó: un usuario de una empresa cliente veía
    // Asistencias y Panel de taller en su hub sin tenerlas contratadas.
    expect(tarjetasPropiasVisibles(["cash", "central"], false).size).toBe(0);
  });

  it("solo se ve aquella para la que hay acceso", () => {
    expect(tarjetasPropiasVisibles(["assist"], false)).toEqual(new Set(["assist"]));
    expect(tarjetasPropiasVisibles(["taller"], false)).toEqual(new Set(["taller"]));
  });

  it("con las dos, se ven las dos", () => {
    expect(tarjetasPropiasVisibles(["assist", "taller", "cash"], false))
      .toEqual(new Set(["assist", "taller"]));
  });

  it("el superadmin las ve aunque no las tenga asignadas", () => {
    expect(tarjetasPropiasVisibles([], true)).toEqual(new Set(["assist", "taller"]));
  });

  it("la lista de entrada es la de app_mis_modulos, que ya cruza licencia", () => {
    // Si un módulo no llega en esa lista -sin licencia o caducada- aquí no hay
    // manera de colarlo.
    expect(tarjetasPropiasVisibles([], false).size).toBe(0);
  });
});
