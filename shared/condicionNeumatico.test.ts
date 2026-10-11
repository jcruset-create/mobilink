import { describe, it, expect } from "vitest";
import { condicionDeOperacion, resumenMontajes, textoPorCondicion } from "./condicionNeumatico";

describe("condicionDeOperacion", () => {
  it("manda la condición explícita del histórico", () => {
    expect(condicionDeOperacion({ condicion: "recauchutada", observaciones: "" })).toBe("recauchutada");
    expect(condicionDeOperacion({ condicion: "nueva", observaciones: "[USADO]" })).toBe("nueva");
  });
  it("sin condición, el marcador [USADO] de la RPC de montaje", () => {
    expect(condicionDeOperacion({ observaciones: "montaje [USADO] del almacén" })).toBe("usada");
    expect(condicionDeOperacion({})).toBe("nueva");
  });
});

describe("resumenMontajes", () => {
  // B2_26/4905: 4 montajes históricos, 2 nuevos deducidos en E1 y 2 usados sin posición.
  const alb4905 = [
    { tipo_operacion: "montaje", condicion: "nueva", posicion_destino: { codigo_posicion: "E1_IZQ" }, posicion_fuente: "deducida" },
    { tipo_operacion: "montaje", condicion: "nueva", posicion_destino: { codigo_posicion: "E1_DER" }, posicion_fuente: "deducida" },
    { tipo_operacion: "montaje", condicion: "usada", posicion_destino: null, posicion_fuente: "desconocida" },
    { tipo_operacion: "montaje", condicion: "usada", posicion_destino: null, posicion_fuente: "desconocida" },
  ];
  it("el total son operaciones, no posiciones conocidas", () => {
    const r = resumenMontajes(alb4905);
    expect(r).toEqual({ total: 4, montajes: 4, porCondicion: { nueva: 2, usada: 2, recauchutada: 0 }, conPosicion: 2, sinPosicion: 2, posicionConfirmada: 0, posicionDeducida: 2 });
    expect(textoPorCondicion(r)).toBe("2 nuevos · 2 usados");
  });
  it("las anuladas no cuentan y las reparaciones no son montajes", () => {
    const r = resumenMontajes([
      ...alb4905,
      { tipo_operacion: "montaje", condicion: "nueva", is_anulada: true },
      { tipo_operacion: "reparacion", posicion_origen_id: "p1" },
    ]);
    expect(r.total).toBe(5); expect(r.montajes).toBe(4); expect(r.conPosicion).toBe(3); expect(r.sinPosicion).toBe(2);
    // La reparación del taller tiene posición registrada: confirmada, no deducida.
    expect(r.posicionConfirmada).toBe(1); expect(r.posicionDeducida).toBe(2);
  });
  it("una operación normal sin marcador es nueva; con [USADO], usada", () => {
    const r = resumenMontajes([{ tipo_operacion: "montaje", observaciones: "[USADO]" }, { tipo_operacion: "sustitucion" }]);
    expect(r.porCondicion).toEqual({ nueva: 1, usada: 1, recauchutada: 0 });
    expect(textoPorCondicion({ porCondicion: { nueva: 1, usada: 0, recauchutada: 1 } })).toBe("1 nuevo · 1 recauchutado");
  });
});
