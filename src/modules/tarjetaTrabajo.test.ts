import { describe, it, expect } from "vitest";
import { resumenTarjeta } from "./tarjetaTrabajo";
import type { IncludedTask } from "./quickTaskSelector";

function tarea(parcial: Partial<IncludedTask>): IncludedTask {
  return {
    id: parcial.id ?? "t1",
    label: parcial.label ?? "Tarea",
    area: parcial.area ?? "camion",
    source: parcial.source ?? "quickTemplate",
    templateKey: parcial.templateKey,
    standardMinutes: parcial.standardMinutes,
    quantity: parcial.quantity,
    unitMinutes: parcial.unitMinutes,
  };
}

// El parte real D2_26/62.
const BASE = {
  operacionPrincipal: 'Montaje camión mayor 19.5"',
  cantidadPrincipal: 4,
  minutosPrincipal: 100,
  includedTasks: [
    tarea({ id: "fij", label: "Montaje fijación", quantity: 4, standardMinutes: 40 }),
  ],
  materiales: [
    { descripcion: "315/70X22.5 SAILUN SDL1 154L", unidades: 4, precioUnitario: 600, precioTotal: 2400 },
    { descripcion: "ALARGADERA PLASTICO 170", unidades: 2 },
  ],
};

describe("resumenTarjeta · mano de obra", () => {
  it("pone la operación principal y las incluidas en la MISMA lista", () => {
    const r = resumenTarjeta(BASE);

    expect(r.manoDeObra.map((l) => l.label)).toEqual([
      'Montaje camión mayor 19.5"',
      "Montaje fijación",
    ]);

    expect(r.manoDeObra[0].principal).toBe(true);
    expect(r.manoDeObra[1].principal).toBe(false);
  });

  it("suma los minutos de todas las líneas", () => {
    expect(resumenTarjeta(BASE).minutosTotales).toBe(140);
  });

  it("sin tareas incluidas, la mano de obra es solo la principal", () => {
    const r = resumenTarjeta({ ...BASE, includedTasks: [] });

    expect(r.manoDeObra).toHaveLength(1);
    expect(r.minutosTotales).toBe(100);
  });

  it("una cantidad ausente vale 1, no 0", () => {
    const r = resumenTarjeta({ ...BASE, cantidadPrincipal: undefined });

    expect(r.manoDeObra[0].cantidad).toBe(1);
  });

  it("descarta cantidades y minutos que no son números útiles", () => {
    const r = resumenTarjeta({
      operacionPrincipal: "Revisión",
      cantidadPrincipal: -3,
      minutosPrincipal: "no es un número",
      includedTasks: [
        tarea({ id: "a", label: "Con basura", quantity: Number.NaN, standardMinutes: -10 }),
      ],
      materiales: [],
    });

    expect(r.manoDeObra[0].cantidad).toBe(1);
    expect(r.manoDeObra[0].minutos).toBe(0);
    expect(r.manoDeObra[1].cantidad).toBe(1);
    expect(r.manoDeObra[1].minutos).toBe(0);
    expect(r.minutosTotales).toBe(0);
  });

  it("ignora una tarea incluida sin etiqueta: no dice nada al técnico", () => {
    const r = resumenTarjeta({
      ...BASE,
      includedTasks: [tarea({ id: "vacia", label: "   " })],
    });

    expect(r.manoDeObra).toHaveLength(1);
  });
});

describe("resumenTarjeta · material", () => {
  it("lista el material con su cantidad", () => {
    const r = resumenTarjeta(BASE);

    expect(r.materiales).toEqual([
      { id: "material-0", descripcion: "315/70X22.5 SAILUN SDL1 154L", unidades: 4 },
      { id: "material-1", descripcion: "ALARGADERA PLASTICO 170", unidades: 2 },
    ]);
  });

  it("NO devuelve importes: el técnico no factura", () => {
    const texto = JSON.stringify(resumenTarjeta(BASE));

    expect(texto).not.toContain("600");
    expect(texto).not.toContain("2400");
    expect(texto).not.toContain("precio");
  });

  it("descarta líneas de material sin descripción o sin unidades", () => {
    const r = resumenTarjeta({
      ...BASE,
      materiales: [
        { descripcion: "", unidades: 4 },
        { descripcion: "Sin unidades", unidades: 0 },
        { descripcion: "Válida", unidades: 1 },
      ],
    });

    expect(r.materiales.map((m) => m.descripcion)).toEqual(["Válida"]);
  });

  it("sin material, la lista queda vacía y la tarjeta no pinta el bloque", () => {
    expect(resumenTarjeta({ ...BASE, materiales: [] }).materiales).toEqual([]);
  });
});

describe("resumenTarjeta · datos corruptos", () => {
  it("aguanta null en las dos columnas JSONB", () => {
    const r = resumenTarjeta({
      operacionPrincipal: "Pinchazo camión",
      includedTasks: null,
      materiales: null,
    });

    expect(r.manoDeObra).toHaveLength(1);
    expect(r.materiales).toEqual([]);
    expect(r.minutosTotales).toBe(0);
  });

  it("aguanta que llegue algo que no es una lista", () => {
    const r = resumenTarjeta({
      operacionPrincipal: "Pinchazo camión",
      includedTasks: "basura" as unknown as null,
      materiales: 42 as unknown as null,
    });

    expect(r.manoDeObra).toHaveLength(1);
    expect(r.materiales).toEqual([]);
  });

  it("sin operación principal no inventa una línea vacía", () => {
    const r = resumenTarjeta({ operacionPrincipal: "  ", includedTasks: [], materiales: [] });

    expect(r.manoDeObra).toEqual([]);
  });
});
