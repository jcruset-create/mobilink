import { describe, expect, it } from "vitest";
import { plantillasParaArea } from "./plantillasPorArea";

const P = [
  { key: "pinchazo-camion", area: "camion" },
  { key: "taco-41", area: "tacografo" },
  { key: "taco-30", area: "tacografo" },
  { key: "2-neum-turismo", area: "turismo" },
] as any[];

describe("plantillasParaArea", () => {
  it("con área, solo las suyas", () => {
    expect(plantillasParaArea(P, "tacografo").map((p) => p.key)).toEqual(["taco-41", "taco-30"]);
  });
  it("sin área, todas", () => {
    expect(plantillasParaArea(P, "")).toHaveLength(4);
    expect(plantillasParaArea(P, null)).toHaveLength(4);
  });
  it("la ya elegida se conserva aunque no sea del área", () => {
    expect(plantillasParaArea(P, "tacografo", "pinchazo-camion").map((p) => p.key)).toEqual([
      "pinchazo-camion", "taco-41", "taco-30",
    ]);
  });
});
