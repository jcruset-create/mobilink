import { describe, expect, it } from "vitest";
import {
  CODIGO_MAX,
  codigoValido,
  normalizarCodigo,
  proponerCodigo,
} from "./registercode.ts";

describe("código de caja", () => {
  it("normaliza lo que se teclea de verdad", () => {
    expect(normalizarCodigo("tar 1")).toBe("TAR1");
    expect(normalizarCodigo("Tarragona")).toBe("TARRAG");
    // Las tildes se van: el código acaba escrito a mano en un resguardo.
    expect(normalizarCodigo("Alcañiz")).toBe("ALCANI");
    expect(normalizarCodigo("tar-1")).toBe("TAR1");
    expect(normalizarCodigo("  ")).toBe("");
  });

  it("no deja pasar un guion, que es el separador del número", () => {
    // «TAR-1» partiría TAR-1-IB-26-001 por un sitio que no toca.
    expect(codigoValido("TAR-1")).toBe(false);
    expect(codigoValido("TAR 1")).toBe(false);
    expect(codigoValido("tar1")).toBe(false); // minúsculas: normaliza antes
    expect(codigoValido("T")).toBe(false); // demasiado corto para distinguir
    expect(codigoValido("A".repeat(CODIGO_MAX + 1))).toBe(false);
    expect(codigoValido("TAR1")).toBe(true);
    expect(codigoValido("T1")).toBe(true);
  });

  it("propone a partir del centro, no del nombre de la caja", () => {
    // «Caja Mostrador» se repite en todos los talleres: daría CAJ1, CAJ2, CAJ3
    // sin decir dónde está ninguna.
    expect(proponerCodigo("Tarragona", "Caja Mostrador", new Set())).toBe("TAR1");
    expect(proponerCodigo("Reus", "Caja Taller", new Set())).toBe("REU1");
  });

  it("salta por encima de los códigos que ya existen", () => {
    const ocupados = new Set(["TAR1", "TAR2"]);
    expect(proponerCodigo("Tarragona", "Caja 3", ocupados)).toBe("TAR3");
  });

  it("cae al nombre si la caja no tiene centro, y nunca sale vacío", () => {
    expect(proponerCodigo("", "Mostrador", new Set())).toBe("MOS1");
    expect(proponerCodigo("", "", new Set())).toBe("CAJ1");
    // Un centro que al limpiarlo no deja ni una letra tampoco puede colgarlo.
    expect(proponerCodigo("123", "456", new Set())).toBe("CAJ1");
  });

  it("el propuesto siempre es válido", () => {
    for (const centro of ["Tarragona", "Reus", "Alcañiz", "", "1", "L'Hospitalet"]) {
      expect(codigoValido(proponerCodigo(centro, "Caja", new Set()))).toBe(true);
    }
  });
});
