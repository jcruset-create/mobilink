import { describe, it, expect } from "vitest";
import { ejesDeConfiguracion } from "./ejes.ts";

describe("los ejes de una configuración", () => {
  it("el caso del autobús: 2x4x2 son tres ejes con 2, 4 y 2 ruedas", () => {
    expect(ejesDeConfiguracion("2x4x2")).toEqual([
      { eje: 1, ruedas: 2 }, { eje: 2, ruedas: 4 }, { eje: 3, ruedas: 2 },
    ]);
  });

  it("un camión rígido de dos ejes", () => {
    expect(ejesDeConfiguracion("2x4")).toEqual([{ eje: 1, ruedas: 2 }, { eje: 2, ruedas: 4 }]);
  });

  it("da igual cómo venga escrito", () => {
    expect(ejesDeConfiguracion(" 2X4X2 ")).toEqual(ejesDeConfiguracion("2x4x2"));
  });

  it("un texto que no se entiende NO da ejes a medias", () => {
    // Crear ejes inventados descuadra el plano del vehículo y nadie los
    // revisa después: mejor ninguno.
    for (const malo of ["tridem", "3 ejes", "2-4-2", "", "   ", "x", "2x"]) {
      expect(ejesDeConfiguracion(malo)).toBeNull();
    }
  });

  it("un número de ruedas que Mobilink no dibuja se rechaza entero", () => {
    // 6 ruedas en un eje no lo pinta el plano: si se aceptara, el vehículo
    // quedaría con un eje que no se puede representar.
    expect(ejesDeConfiguracion("2x6x2")).toBeNull();
    expect(ejesDeConfiguracion("2x0")).toBeNull();
  });

  it("un solo eje no es un vehículo de esta flota", () => {
    expect(ejesDeConfiguracion("2")).toBeNull();
  });

  it("nulo o indefinido no revienta", () => {
    expect(ejesDeConfiguracion(null)).toBeNull();
    expect(ejesDeConfiguracion(undefined)).toBeNull();
  });
});
