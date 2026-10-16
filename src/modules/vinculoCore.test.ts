import { describe, expect, it } from "vitest";
import {
  cambiosPendientes,
  eleccionInicial,
  empleadosRepetidos,
  type PropuestaVinculo,
} from "./vinculoCore";

function p(extra: Partial<PropuestaVinculo> & { tech: string }): PropuestaVinculo {
  return {
    employeeId: null,
    employeeNombre: null,
    certeza: "sin_candidato",
    candidatos: [],
    vinculadoA: null,
    ...extra,
  };
}

describe("vinculoCore", () => {
  it("lo ya vinculado manda sobre la propuesta", () => {
    expect(eleccionInicial(p({ tech: "José", vinculadoA: "e1", employeeId: "e2" }))).toBe("e1");
    expect(eleccionInicial(p({ tech: "José", employeeId: "e2", certeza: "unica" }))).toBe("e2");
    expect(eleccionInicial(p({ tech: "José" }))).toBe("");
  });

  it("una propuesta sin tocar SÍ cuenta como cambio: guardarla es confirmarla", () => {
    const props = [p({ tech: "José", employeeId: "e2", certeza: "unica" })];
    expect(cambiosPendientes(props, {})).toEqual([{ tech: "José", employeeId: "e2" }]);
  });

  it("lo vinculado y sin tocar no se reenvía", () => {
    expect(cambiosPendientes([p({ tech: "José", vinculadoA: "e1" })], {})).toEqual([]);
  });

  it("vaciar la elección desvincula", () => {
    expect(cambiosPendientes([p({ tech: "José", vinculadoA: "e1" })], { José: "" })).toEqual([
      { tech: "José", employeeId: null },
    ]);
  });

  it("sin candidato y sin elegir no se envía nada", () => {
    expect(cambiosPendientes([p({ tech: "Ana" })], {})).toEqual([]);
  });

  it("detecta el mismo empleado elegido para dos técnicos", () => {
    const props = [p({ tech: "José", vinculadoA: "e1" }), p({ tech: "Pepe" })];
    expect([...empleadosRepetidos(props, { Pepe: "e1" })]).toEqual(["e1"]);
    expect(empleadosRepetidos(props, {}).size).toBe(0);
  });
});
