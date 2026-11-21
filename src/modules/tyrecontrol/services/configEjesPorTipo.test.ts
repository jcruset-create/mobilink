import { describe, expect, it } from "vitest";
import { configFijaDeTipo, idConfigFija } from "./configEjesPorTipo";

const configs = [
  { id: "a", nombre: "2X4 BUS" },
  { id: "b", nombre: "2x4x2 Bus" },
  { id: "c", nombre: "2x4x2" },
];

describe("configuración de ejes fija por tipo", () => {
  it("un autocar es siempre 2x4x2 Bus, no el 2x4x2 de camión", () => {
    expect(configFijaDeTipo("autocar")).toBe("2x4x2 Bus");
    expect(idConfigFija("autocar", configs)).toBe("b");
  });

  it("los demás tipos se eligen libremente", () => {
    expect(configFijaDeTipo("autobus")).toBeNull();
    expect(configFijaDeTipo("autocar_2x4x4")).toBeNull();
    expect(idConfigFija(null, configs)).toBeNull();
  });
});
