import { describe, expect, it } from "vitest";
import { camposDeOperacion, propuestosQueSiguenValiendo } from "./cambiarOperacion";
import type { QuickTemplate } from "./workshopTypes";

const taco: QuickTemplate = {
  key: "taco_30", label: "Revisión Tacógrafo 3.0", area: "tacografo", mode: "single",
  allowedTechs: [], priorityOrder: [], standardMinutes: 90, unitPrice: 120,
} as any;

const porCantidad: QuickTemplate = {
  key: "neum_turismo", label: "Cambiar neumáticos turismo", area: "turismo", mode: "single",
  allowedTechs: [], priorityOrder: [], usesQuantity: true, unitMinutes: 15, unitPrice: 10,
} as any;

const pinchazo: QuickTemplate = {
  key: "pinchazo_camion", label: "Pinchazo de camión", area: "camion", mode: "team",
  allowedTechs: [], priorityOrder: [], standardMinutes: 60,
} as any;

describe("camposDeOperacion", () => {
  it("cambia el área, el rótulo, el modo y los minutos, no solo el texto", () => {
    expect(camposDeOperacion(taco, 1)).toMatchObject({
      area: "tacografo",
      quickEntryLabel: "Revisión Tacógrafo 3.0",
      quickEntryMode: "single",
      standardMinutes: 90,
      unitPrice: 120,
      quantity: 1,
    });
  });

  it("una plantilla que no es de las de serie no deja `template` colgando", () => {
    expect(camposDeOperacion(taco, 1).template).toBeNull();
    expect(camposDeOperacion(pinchazo, 1).template).toBe("pinchazo_camion");
  });

  it("si la nueva operación va por cantidad, los minutos la multiplican", () => {
    expect(camposDeOperacion(porCantidad, 4)).toMatchObject({
      quantity: 4, unitMinutes: 15, standardMinutes: 60, totalPrice: 40,
    });
  });

  it("y si no va por cantidad, la cantidad vuelve a uno", () => {
    expect(camposDeOperacion(taco, 4).quantity).toBe(1);
  });

  it("una cantidad rota no rompe el cálculo", () => {
    expect(camposDeOperacion(porCantidad, null).quantity).toBe(1);
    expect(camposDeOperacion(porCantidad, "3").quantity).toBe(3);
  });
});

describe("propuestosQueSiguenValiendo", () => {
  it("se queda solo con quien tiene competencia para la operación nueva", () => {
    expect(propuestosQueSiguenValiendo(["Ramón", "José"], (n) => n === "Ramón")).toEqual(["Ramón"]);
  });

  it("sin nadie válido, la propuesta se queda vacía y no a medias", () => {
    expect(propuestosQueSiguenValiendo(["Ramón"], () => false)).toEqual([]);
  });
});
