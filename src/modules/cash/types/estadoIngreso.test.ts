import { describe, expect, it } from "vitest";
import { ETIQUETA_ESTADO_INGRESO, estadoIngreso } from "./index";

describe("estado visible de un ingreso", () => {
  it("registrado pero sin pisar el banco: pendiente de confirmar", () => {
    // Es el caso normal: se prepara la bolsa y alguien va al banco después.
    expect(estadoIngreso({ estado: "CONFIRMADO", fechaIngreso: null })).toBe("PENDIENTE_CONFIRMAR");
  });

  it("con la fecha real puesta: confirmado", () => {
    expect(estadoIngreso({ estado: "CONFIRMADO", fechaIngreso: "2026-08-27" })).toBe("CONFIRMADO");
  });

  it("anulado manda sobre todo lo demás", () => {
    // Aunque tuviera fecha: si se anuló, lo que importa es que se anuló.
    expect(estadoIngreso({ estado: "ANULADO", fechaIngreso: "2026-08-27" })).toBe("ANULADO");
    expect(estadoIngreso({ estado: "ANULADO", fechaIngreso: null })).toBe("ANULADO");
  });

  it("las tres tienen etiqueta", () => {
    expect(ETIQUETA_ESTADO_INGRESO.PENDIENTE_CONFIRMAR).toBe("Pendiente de confirmar");
    expect(ETIQUETA_ESTADO_INGRESO.CONFIRMADO).toBe("Confirmado");
    expect(ETIQUETA_ESTADO_INGRESO.ANULADO).toBe("Anulado");
  });
});
