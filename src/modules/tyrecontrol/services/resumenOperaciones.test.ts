import { describe, it, expect } from "vitest";
import { resumenOperaciones } from "./resumenOperaciones";
import type { OperacionParaResumen } from "./resumenOperaciones";

const pos = (nombre: string) => ({ codigo_posicion: nombre.replaceAll(" ", "_"), nombre });

describe("resumenOperaciones (generador único panel + servidor)", () => {
  it("agrupa por tipo con plural y lista de posiciones", () => {
    const ops: OperacionParaResumen[] = [
      { tipo_operacion: "sustitucion", posicion_destino: pos("Eje 3 derecha") },
      { tipo_operacion: "sustitucion", posicion_destino: pos("Eje 3 izquierda") },
    ];
    expect(resumenOperaciones(ops)).toEqual([
      "Sustituidos 2 neumáticos: Eje 3 derecha y Eje 3 izquierda",
    ]);
  });

  it("singular y reparación agrupada por motivo", () => {
    const ops: OperacionParaResumen[] = [
      { tipo_operacion: "montaje", posicion_destino: pos("Eje 1 derecha") },
      { tipo_operacion: "reparacion", motivo: "pinchazo", posicion_origen: pos("Eje 1 izquierda") },
    ];
    expect(resumenOperaciones(ops)).toEqual([
      "Montado 1 neumático: Eje 1 derecha",
      "Reparación (pinchazo): Eje 1 izquierda",
    ]);
  });

  it("excluye las anuladas; sin operaciones activas no hay líneas", () => {
    const ops: OperacionParaResumen[] = [
      { tipo_operacion: "montaje", is_anulada: true, posicion_destino: pos("Eje 1 derecha") },
    ];
    expect(resumenOperaciones(ops)).toEqual([]);
  });

  it("etiqueta por neumático cuando no hay posición: número interno antes que medida", () => {
    const ops: OperacionParaResumen[] = [
      { tipo_operacion: "desmontaje", neumatico: { numero_interno: "NT-2026-000039", medida: "315/80R22.5" } },
      { tipo_operacion: "descarte", neumatico: { medida: "315/80R22.5" } },
    ];
    expect(resumenOperaciones(ops)).toEqual([
      "Desmontado 1 neumático: NT-2026-000039",
      "Descartado 1 neumático: 315/80R22.5",
    ]);
  });

  it("conoce las correcciones (la copia vieja del servidor no las conocía)", () => {
    const ops: OperacionParaResumen[] = [
      { tipo_operacion: "correccion_posicion", posicion_destino: pos("Eje 2 derecha") },
    ];
    expect(resumenOperaciones(ops)).toEqual(["Corregida posición 1 neumático: Eje 2 derecha"]);
  });

  it("un motivo fuera del mapa (catálogo editable) no revienta ni desaparece", () => {
    const ops: OperacionParaResumen[] = [
      { tipo_operacion: "reparacion", motivo: "profundidad_minima", posicion_origen: pos("Eje 1 derecha") },
    ];
    expect(resumenOperaciones(ops)).toEqual(["Reparación (profundidad minima): Eje 1 derecha"]);
  });

  it("un tipo sin verbo sale con su código en crudo (no se pierde)", () => {
    const ops: OperacionParaResumen[] = [{ tipo_operacion: "retirada_stock", posicion_origen: pos("Eje 2 izquierda") }];
    expect(resumenOperaciones(ops)).toEqual(["retirada_stock 1 neumático: Eje 2 izquierda"]);
  });

  it("cuenta operaciones sin etiqueta de lugar sin inventar posiciones", () => {
    const ops: OperacionParaResumen[] = [
      { tipo_operacion: "montaje" },
      { tipo_operacion: "montaje", posicion_destino: pos("Eje 1 derecha") },
    ];
    // Una tiene lugar y la otra no: el recuento es 1 (con lugar) — mismo
    // comportamiento que las dos copias históricas.
    expect(resumenOperaciones(ops)).toEqual(["Montado 1 neumático: Eje 1 derecha"]);
  });
});
