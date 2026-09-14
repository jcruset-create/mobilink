import { describe, expect, it } from "vitest";
import { usuarioSugerido } from "./usuarioSugerido";

describe("usuarioSugerido", () => {
  it("junta nombre y primer apellido en minúsculas", () => {
    expect(usuarioSugerido("Jordi", "Cruset Gomez")).toBe("jordicruset");
  });

  it("quita acentos y espacios", () => {
    expect(usuarioSugerido("José María", "Ñíguez")).toBe("joseniguez");
  });

  it("funciona sin apellidos", () => {
    expect(usuarioSugerido("Albert", null)).toBe("albert");
  });
});
