/**
 * Normalización y búsqueda de matrículas.
 *
 * El patrón de búsqueda es lo que sustituye al «traer 2.000 filas y comparar
 * en JavaScript», así que conviene que esté fijado: si deja de encajar con un
 * separador, el vehículo deja de encontrarse y nadie ve ningún error.
 */

import { describe, expect, it } from "vitest";

import { coincideMatricula, normalizarMatricula, patronBusquedaMatricula } from "./matricula.ts";

describe("Normalización", () => {
  it("mayúsculas, sin espacios y sin guiones", () => {
    expect(normalizarMatricula("1234-abc")).toBe("1234ABC");
    expect(normalizarMatricula(" 1234 ABC ")).toBe("1234ABC");
    expect(normalizarMatricula("1234abc")).toBe("1234ABC");
  });

  it("aguanta lo que no es texto", () => {
    expect(normalizarMatricula(null)).toBe("");
    expect(normalizarMatricula(undefined)).toBe("");
    expect(normalizarMatricula(1234)).toBe("1234");
  });
});

describe("Patrón de búsqueda", () => {
  /* Es lo que permite filtrar en el servidor sin columna normalizada. */
  it("intercala comodines entre cada carácter", () => {
    expect(patronBusquedaMatricula("1234ABC")).toBe("1%2%3%4%A%B%C%");
  });

  it("normaliza antes de construirlo", () => {
    expect(patronBusquedaMatricula(" 1234-abc ")).toBe("1%2%3%4%A%B%C%");
  });

  /* Sin ancla por la izquierda traería media tabla. */
  it("va anclado por la izquierda", () => {
    expect(patronBusquedaMatricula("1234ABC")!.startsWith("%")).toBe(false);
  });

  it("una matrícula demasiado corta no genera patrón", () => {
    expect(patronBusquedaMatricula("12")).toBeNull();
    expect(patronBusquedaMatricula("")).toBeNull();
    expect(patronBusquedaMatricula("---")).toBeNull();
  });
});

describe("Coincidencia exacta", () => {
  /*
   * El patrón admite `1X2X3X4XAXBXC`, así que la igualdad la decide esta
   * comprobación y no el LIKE.
   */
  it("iguala las variantes de separador", () => {
    expect(coincideMatricula("1234-ABC", "1234ABC")).toBe(true);
    expect(coincideMatricula("1234 abc", " 1234-ABC ")).toBe(true);
  });

  it("rechaza lo que el patrón dejaría pasar", () => {
    expect(coincideMatricula("1X2X3X4XAXBXC", "1234ABC")).toBe(false);
    expect(coincideMatricula("1234ABCD", "1234ABC")).toBe(false);
  });

  it("una matrícula vacía no coincide con nada", () => {
    expect(coincideMatricula("", "")).toBe(false);
    expect(coincideMatricula("1234ABC", "")).toBe(false);
  });
});
