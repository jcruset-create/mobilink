import { describe, expect, it } from "vitest";
import { claveDePin, clavesPosibles, LONGITUD_MINIMA_AUTH } from "./pinApk.ts";

describe("el PIN de la tablet como contraseña de Auth", () => {
  it("un PIN de cuatro dígitos llega a la longitud que pide Auth", () => {
    expect(claveDePin("1234").length).toBeGreaterThanOrEqual(LONGITUD_MINIMA_AUTH);
    expect(claveDePin("1234").startsWith("1234")).toBe(true);
  });

  it("el de seis o más se guarda como viene", () => {
    expect(claveDePin("123456")).toBe("123456");
    expect(claveDePin("una-contraseña-larga")).toBe("una-contraseña-larga");
  });

  it("el sufijo es el que es: cambiarlo deja fuera a quien tenga PIN corto", () => {
    expect(claveDePin("1234")).toBe("1234#TC");
  });

  it("al entrar se prueba primero tal cual, por los operarios de antes", () => {
    expect(clavesPosibles("1234")).toEqual(["1234", "1234#TC"]);
  });

  it("y uno largo solo tiene una forma", () => {
    expect(clavesPosibles("123456")).toEqual(["123456"]);
  });
});
