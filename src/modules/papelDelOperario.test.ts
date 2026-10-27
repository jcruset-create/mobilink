import { describe, expect, it } from "vitest";
import { nombreConPapel, papelDelOperario } from "./papelDelOperario";

describe("papelDelOperario", () => {
  it("el primero es responsable y los demás apoyo", () => {
    expect(papelDelOperario("José", ["José", "Alejandro"])).toBe("responsable");
    expect(papelDelOperario("Alejandro", ["José", "Alejandro"])).toBe("apoyo");
  });
  it("quien va solo es responsable", () => {
    expect(papelDelOperario("David", ["David"])).toBe("responsable");
  });
  it("quien no está en el trabajo no tiene papel", () => {
    expect(papelDelOperario("Iván", ["José"])).toBeNull();
    expect(papelDelOperario("Iván", undefined)).toBeNull();
  });
  it("se escribe pegado al nombre", () => {
    expect(nombreConPapel("José", "responsable")).toBe("José - Responsable");
    expect(nombreConPapel("Alejandro", "apoyo")).toBe("Alejandro - Apoyo");
    expect(nombreConPapel("Albert", null)).toBe("Albert");
  });
});
