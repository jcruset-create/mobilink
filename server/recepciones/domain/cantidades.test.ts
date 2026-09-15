import { describe, expect, it } from "vitest";
import {
  cantidad,
  diferencia,
  esIncidenciaDeRecepcion,
  pendienteDeExpedir,
  pendienteDeRecibir,
} from "./cantidades.ts";

describe("cantidades", () => {
  it("pendiente de recibir es expedida menos recibida, nunca negativa", () => {
    expect(pendienteDeRecibir(10, 8)).toBe(2);
    expect(pendienteDeRecibir(2, 3)).toBe(0);
  });

  it("pendiente de expedir es pedida menos expedida", () => {
    expect(pendienteDeExpedir(10, 6)).toBe(4);
  });

  it("la diferencia lleva signo: negativa cuando falta", () => {
    expect(diferencia(2, 1)).toBe(-1);
    expect(diferencia(2, 3)).toBe(1);
  });

  it("expedido ≠ recibido es incidencia; pedido ≠ expedido no entra aquí", () => {
    expect(esIncidenciaDeRecepcion(2, 1)).toBe(true);
    expect(esIncidenciaDeRecepcion(6, 6)).toBe(false);
  });

  it("acepta texto con coma y rechaza negativos y cero salvo que se permita", () => {
    expect(cantidad("2,5")).toBe(2.5);
    expect(() => cantidad(-1)).toThrow();
    expect(() => cantidad(0)).toThrow();
    expect(cantidad(0, "recibida", { permitirCero: true })).toBe(0);
    expect(() => cantidad("abc")).toThrow();
  });
});
