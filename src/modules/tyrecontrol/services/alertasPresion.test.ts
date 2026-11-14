/**
 * Cómo se dice un aviso de presión.
 *
 * Lo que se fija aquí es, sobre todo, que no se afirme nada que el correo no
 * diga: ni un cero donde no hay lectura, ni un porcentaje calculado por
 * nosotros que no sea el que el cliente ve en su portal de Goodyear.
 */

import { describe, expect, it } from "vitest";

import {
  fechaCorta, fechaYHoraCorta, nombreDelTipo, textoDePresion, textoDeRepeticion,
} from "./alertasPresion";

describe("cómo se dice la presión", () => {
  it("el caso normal: lo medido, lo recomendado y la desviación", () => {
    // El aviso real de 1467HJS del 10/11.
    expect(textoDePresion({
      tipo: "presion_baja", presion_bar: 4, presion_recomendada_bar: 8, desviacion_pct: -49.65,
    })).toBe("4 bar de 8 recomendados (-49.65 %)");
  });

  it("sin lectura NO se dice cero", () => {
    // Es el aviso de «neumático desinflado», donde el correo pone `!!!`.
    // «0 bar» afirmaría que se midió cero, que es otra cosa: lo que pasa es
    // que el sensor no da un número fiable.
    expect(textoDePresion({
      tipo: "desinflado", presion_bar: null, presion_recomendada_bar: 8, desviacion_pct: null,
    })).toBe("Sin lectura del sensor de 8 recomendados");
  });

  it("el porcentaje no se inventa cuando falta", () => {
    expect(textoDePresion({ tipo: "presion_baja", presion_bar: 4, presion_recomendada_bar: 8 }))
      .toBe("4 bar de 8 recomendados");
  });

  it("sin recomendada tampoco se inventa", () => {
    expect(textoDePresion({ tipo: "presion_baja", presion_bar: 4 })).toBe("4 bar");
  });

  it("se copia el porcentaje del correo, aunque no cuadre con los bares", () => {
    // 2,0 sobre 2,5 serían −20 % y el correo dice −18,76 %: los bares vienen
    // redondeados. Calcularlo daría un número distinto del de su portal.
    const t = textoDePresion({
      tipo: "presion_baja", presion_bar: 2, presion_recomendada_bar: 2.5, desviacion_pct: -18.76,
    });
    expect(t).toContain("-18.76 %");
    expect(t).not.toContain("-20");
  });
});

describe("cuántas veces ha avisado", () => {
  it("con un solo aviso no se dice nada", () => {
    // Decir «1 aviso» en todas las líneas es ruido que tapa las que sí
    // llevan días avisando.
    expect(textoDeRepeticion({ tipo: "presion_baja", avisos: 1, primer_aviso_at: "2026-11-10T21:30:00Z" }))
      .toBeNull();
    expect(textoDeRepeticion({ tipo: "presion_baja" })).toBeNull();
  });

  it("con varios se dice desde cuándo", () => {
    // Es el dato que distingue una presión baja de una fuga.
    expect(textoDeRepeticion({
      tipo: "presion_baja", avisos: 3, primer_aviso_at: "2026-11-08T07:58:00Z",
    })).toBe("3 avisos desde el 08/11");
  });

  it("sin fecha de inicio se dice el número a secas", () => {
    expect(textoDeRepeticion({ tipo: "presion_baja", avisos: 2 })).toBe("2 avisos");
  });
});

describe("las fechas", () => {
  it("día y mes", () => {
    expect(fechaCorta("2026-11-08T07:58:00Z")).toBe("08/11");
  });

  it("día, mes y hora", () => {
    expect(fechaYHoraCorta("2026-11-10T12:30:00Z")).toContain("10/11");
  });

  it("lo que no es una fecha no se pinta como «Invalid Date»", () => {
    expect(fechaCorta(null)).toBeNull();
    expect(fechaCorta("")).toBeNull();
    expect(fechaCorta("ayer")).toBeNull();
    expect(fechaYHoraCorta(undefined)).toBeNull();
  });
});

describe("el nombre del tipo", () => {
  it("los dos que manda Goodyear", () => {
    expect(nombreDelTipo("presion_baja")).toBe("Presión baja");
    expect(nombreDelTipo("desinflado")).toBe("Neumático desinflado");
  });
});
