/**
 * Normalización de teléfonos, sin base de datos.
 *
 * Sirve para responder a UNA pregunta —¿el conductor y el cliente son el mismo
 * número?— y de acertarla depende que a alguien no le lleguen dos encuestas
 * del mismo servicio.
 */

import { describe, expect, it } from "vitest";

import { mismoTelefono, normalizarTelefono } from "./telefonos.ts";

describe("normalización", () => {
  it("da igual cómo esté escrito", () => {
    const esperado = "600112233";
    for (const forma of [
      "600112233", "600 11 22 33", "600-11-22-33", "(600) 112233",
      "+34600112233", "+34 600 11 22 33", "0034600112233", "34600112233",
      " 600112233 ",
    ]) {
      expect(normalizarTelefono(forma)).toBe(esperado);
    }
  });

  it("lo que no es un teléfono no lo es", () => {
    for (const malo of ["", "   ", "12345", "abc", null, undefined, "+34"]) {
      expect(normalizarTelefono(malo)).toBeNull();
    }
  });

  it("una extensión escrita detrás no lo convierte en otro número", () => {
    // Se comparan los nueve últimos dígitos, así que esto NO son iguales, y
    // está bien: es preferible mandar dos encuestas que fusionar dos personas.
    expect(mismoTelefono("600112233", "600112233 ext 12")).toBe(false);
  });

  it("reconoce el mismo número escrito de dos maneras", () => {
    expect(mismoTelefono("+34 600 11 22 33", "600112233")).toBe(true);
    expect(mismoTelefono("0034-600112233", "(600)112233")).toBe(true);
  });

  it("dos números distintos no son el mismo", () => {
    expect(mismoTelefono("600112233", "600112234")).toBe(false);
  });

  it("sin número no hay coincidencia posible", () => {
    expect(mismoTelefono(null, null)).toBe(false);
    expect(mismoTelefono("600112233", "")).toBe(false);
    // Dos vacíos NO son «el mismo destinatario»: son dos ausencias.
    expect(mismoTelefono("", "")).toBe(false);
  });
});
