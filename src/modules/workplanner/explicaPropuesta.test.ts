import { describe, it, expect } from "vitest";
import { explicaPropuesta } from "./PartesTrabajoPage";
import type { TechLoadStat } from "../workshopTypes";

const TRABAJO = {
  area: "camion" as const,
  template: null,
  quickEntryLabel: "Montaje camión mayor 19.5",
};

const CLAVE = "quick:Montaje camión mayor 19.5";

const STATS = [
  { operation: CLAVE, fastestTech: "Ramón", bestTime: 18.4, averageMinutes: 25 },
];

const CARGA: TechLoadStat[] = [
  { techName: "Ramón", activeCount: 0, totalOpenMinutes: 0 },
  { techName: "José", activeCount: 2, totalOpenMinutes: 95.6 },
];

describe("explicaPropuesta", () => {
  it("dice que es el más rápido y que está libre", () => {
    const texto = explicaPropuesta(["Ramón"], TRABAJO, STATS, CARGA);

    expect(texto).toContain("Ramón");
    expect(texto).toContain("más rápido");
    expect(texto).toContain("18 min");
    expect(texto).toContain("no tiene ningún trabajo abierto");
  });

  it("cuando no es el más rápido, explica solo la carga", () => {
    const texto = explicaPropuesta(["José"], TRABAJO, STATS, CARGA);

    expect(texto).not.toContain("más rápido");
    expect(texto).toContain("2 trabajo(s)");
    expect(texto).toContain("96 min");
  });

  it("sin estadísticas, dice que va por competencias y orden del área", () => {
    const texto = explicaPropuesta(["Anthoni"], TRABAJO, [], []);

    expect(texto).toContain("competencias y orden del área");
  });

  it("nombra el apoyo cuando lo hay", () => {
    const texto = explicaPropuesta(["Ramón", "David"], TRABAJO, STATS, CARGA);

    expect(texto).toContain("Apoyo: David");
  });

  it("sin nadie asignado lo dice, no se inventa un motivo", () => {
    expect(explicaPropuesta([], TRABAJO, STATS, CARGA)).toBe(
      "Sin técnico libre para proponer."
    );
  });

  it("ignora el récord de otra operación distinta", () => {
    const otra = { ...TRABAJO, quickEntryLabel: "Alineación" };

    expect(explicaPropuesta(["Ramón"], otra, STATS, CARGA)).not.toContain("más rápido");
  });

  it("un récord a 0 minutos no se presume: no hay dato real", () => {
    const sinTiempo = [{ operation: CLAVE, fastestTech: "Ramón", bestTime: 0, averageMinutes: 0 }];

    expect(explicaPropuesta(["Ramón"], TRABAJO, sinTiempo, CARGA)).not.toContain("más rápido");
  });
});
