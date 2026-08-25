/**
 * Generación de CSV. Funciones puras.
 *
 * Lo que se fija aquí sobre todo es la defensa contra la inyección de fórmulas,
 * que es la razón de que este módulo exista.
 */

import { describe, expect, it } from "vitest";
import { aCsv, celda, importe } from "./csv.ts";

describe("celdas seguras", () => {
  /*
   * Excel ejecuta las celdas que empiezan por =, +, - o @. Un concepto de cobro
   * es texto que escribe un usuario y acaba en un informe que alguien abre en
   * su portátil.
   */
  it("neutraliza las fórmulas de Excel", () => {
    expect(celda('=HYPERLINK("http://malo")')).toBe('"\'=HYPERLINK(""http://malo"")"');
    expect(celda("+1+1")).toBe("'+1+1");
    expect(celda("-2+3")).toBe("'-2+3");
    expect(celda("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("un texto normal no se toca", () => {
    expect(celda("Cobro en mostrador")).toBe("Cobro en mostrador");
    expect(celda("Talleres Pérez")).toBe("Talleres Pérez");
  });

  /*
   * Sin entrecomillar, un concepto con comas convierte una fila en varias
   * columnas mal alineadas, y a partir de ahí todo el informe miente.
   */
  it("entrecomilla lo que rompería el fichero", () => {
    // Por el separador `;`, no por la coma: los importes llevan coma decimal y
    // entrecomillarlos haría que Excel los leyera como texto.
    expect(celda("Cobro; urgente")).toBe('"Cobro; urgente"');
    expect(celda("Cobro, urgente")).toBe("Cobro, urgente");
    expect(celda('Cobro "urgente"')).toBe('"Cobro ""urgente"""');
    expect(celda("Dos\nlíneas")).toBe('"Dos\nlíneas"');
  });

  it("el apóstrofo queda DENTRO de las comillas, o no serviría de nada", () => {
    const r = celda("=1;2");
    expect(r.startsWith('"')).toBe(true);
    expect(r).toContain("'=");
  });

  it("lo vacío sale vacío, no como la palabra null", () => {
    expect(celda(null)).toBe("");
    expect(celda(undefined)).toBe("");
    expect(celda(0)).toBe("0");
  });
});

describe("importes", () => {
  it("van con coma decimal y sin separador de miles", () => {
    expect(importe(123456)).toBe("1234,56");
    expect(importe(5)).toBe("0,05");
    expect(importe(-4530)).toBe("-45,30");
    expect(importe(0)).toBe("0,00");
  });

  it("un importe vacío no se convierte en cero", () => {
    // Cero euros y «no hay dato» no son lo mismo en un informe de dinero.
    expect(importe(null)).toBe("");
  });
});

describe("fichero completo", () => {
  it("lleva BOM, separador ; y saltos de Windows", () => {
    const csv = aCsv(["Caja", "Importe"], [["Mostrador", importe(150000)]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Caja;Importe");
    expect(csv).toContain("Mostrador;1500,00");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("una fila maliciosa no contamina las demás", () => {
    const csv = aCsv(
      ["Concepto"],
      [["=1+1"], ["Normal"]]
    );
    const lineas = csv.replace("﻿", "").trim().split("\r\n");
    expect(lineas).toHaveLength(3);
    expect(lineas[1]).toBe("'=1+1");
    expect(lineas[2]).toBe("Normal");
  });
});
