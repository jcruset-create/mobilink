import { describe, expect, it } from "vitest";

import { paisLeidoValido, paisParaGuardar } from "./matriculaPais.ts";

const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

describe("país leído de la foto de la matrícula", () => {
  it("solo letras de país de la UE", () => {
    expect(paisLeidoValido("F")).toBe("F");
    expect(paisLeidoValido(" nl ")).toBe("NL");
    expect(paisLeidoValido("(E)")).toBe("E");
    expect(paisLeidoValido("GB")).toBeNull(); // fuera de la UE
    expect(paisLeidoValido("FRANCIA")).toBeNull();
    expect(paisLeidoValido(null)).toBeNull();
    expect(paisLeidoValido("")).toBeNull();
  });

  it("se guarda solo si la matrícula leída es la del vehículo", () => {
    expect(paisParaGuardar("F", "AB123CD", "AB-123-CD", norm)).toBe("F");
    // La foto era de otro vehículo: su país no es el de este.
    expect(paisParaGuardar("F", "AB123CD", "XY987ZW", norm)).toBeNull();
    // Sin matrícula leída o sin la del vehículo, no se puede saber.
    expect(paisParaGuardar("F", null, "AB123CD", norm)).toBeNull();
    expect(paisParaGuardar("F", "AB123CD", null, norm)).toBeNull();
    // Lo leído no es un país.
    expect(paisParaGuardar("ZZ", "AB123CD", "AB123CD", norm)).toBeNull();
  });
});
