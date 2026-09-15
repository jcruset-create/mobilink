import { describe, expect, it } from "vitest";
import { mismoNumero, normalizarNumero } from "./numero.ts";

describe("normalizarNumero", () => {
  it("cruza el pedido del correo con el del albarán de Soledad", () => {
    expect(normalizarNumero("B-2026-5688837")).toBe("5688837");
    expect(normalizarNumero("5688837")).toBe("5688837");
    expect(mismoNumero("B-2026-5688837", " 5688837 ")).toBe(true);
  });

  it("no da por iguales dos números parecidos", () => {
    expect(mismoNumero("5688837", "5688838")).toBe(false);
  });

  it("quita ceros a la izquierda y aguanta sufijos cortos", () => {
    expect(normalizarNumero("0002028450461")).toBe("2028450461");
    expect(normalizarNumero("2028450461/2")).toBe("2028450461");
  });

  it("sin dígitos se queda con las letras; vacío es null", () => {
    expect(normalizarNumero("ALB-A")).toBe("ALBA");
    expect(normalizarNumero("")).toBeNull();
    expect(normalizarNumero(null)).toBeNull();
  });
});
