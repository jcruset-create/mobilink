import { describe, expect, it } from "vitest";

import { fechaHoraCorta } from "./roadsideFechaHora";

/// Fechas locales a proposito: lo que se pinta es la hora local del que mira,
/// y construirlas en UTC haria que la prueba pasara o fallara segun el huso
/// del que la ejecuta.
const local = (a: number, m: number, d: number, h = 0, min = 0) =>
  new Date(a, m - 1, d, h, min).getTime();

const ahora2026 = new Date(2026, 8, 17, 22, 21); // 17/09/2026

describe("fecha y hora de la tarjeta", () => {
  it("pone la fecha delante de la hora", () => {
    expect(fechaHoraCorta(local(2026, 9, 14, 19, 39), { ahora: ahora2026 }))
      .toBe("14/09 19:39");
  });

  it("rellena con cero el dia, el mes y la hora", () => {
    // «3/7 9:3» se lee mal y descuadra la columna; «03/07 09:03» no.
    expect(fechaHoraCorta(local(2026, 7, 3, 9, 3), { ahora: ahora2026 }))
      .toBe("03/07 09:03");
  });

  it("la medianoche es 00:03 del dia que es, no de la vispera", () => {
    // En la pantalla salia «00:03» suelto y no se sabia de que dia.
    expect(fechaHoraCorta(local(2026, 9, 15, 0, 3), { ahora: ahora2026 }))
      .toBe("15/09 00:03");
  });

  it("el mismo dia tampoco se abrevia", () => {
    // Tentador poner «hoy», pero en una columna de noventa y cinco filas
    // mezclar «hoy» con «14/09» se lee peor que tener siempre el mismo
    // formato.
    expect(fechaHoraCorta(local(2026, 9, 17, 8, 5), { ahora: ahora2026 }))
      .toBe("17/09 08:05");
  });
});

describe("el ano, solo cuando hace falta", () => {
  it("del ano corriente no se pone", () => {
    expect(fechaHoraCorta(local(2026, 1, 2, 12, 0), { ahora: ahora2026 }))
      .toBe("02/01 12:00");
  });

  it("de otro ano si, porque si no diria otra cosa", () => {
    expect(fechaHoraCorta(local(2025, 9, 14, 19, 39), { ahora: ahora2026 }))
      .toBe("14/09/25 19:39");
  });

  it("en enero, lo de diciembre pasado lleva su ano", () => {
    // El caso que de verdad importa: el 2 de enero, un servicio del 30 de
    // diciembre. Sin el ano parece de la semana que viene.
    const enero = new Date(2027, 0, 2, 9, 0);
    expect(fechaHoraCorta(local(2026, 12, 30, 18, 15), { ahora: enero }))
      .toBe("30/12/26 18:15");
  });

  it("un ano de dos digitos se rellena", () => {
    expect(fechaHoraCorta(local(2005, 3, 1, 10, 0), { ahora: ahora2026 }))
      .toBe("01/03/05 10:00");
  });
});

describe("lo que no se puede pintar", () => {
  /*
   * Mismo contrato que el `formatTime` que habia: quien llama pinta lo que
   * salga sin comprobar nada, asi que aqui no puede salir «NaN» ni
   * «Invalid Date».
   */
  it("sin valor, un guion", () => {
    expect(fechaHoraCorta(null)).toBe("-");
    expect(fechaHoraCorta(undefined)).toBe("-");
    expect(fechaHoraCorta(0)).toBe("-");
    expect(fechaHoraCorta("")).toBe("-");
  });

  it("con basura, un guion", () => {
    expect(fechaHoraCorta("no es una fecha")).toBe("-");
    expect(fechaHoraCorta(Number.NaN)).toBe("-");
  });

  it("acepta la marca de tiempo como cadena", () => {
    // Segun por donde entre la asistencia, los BIGINT llegan como cadena.
    const ms = local(2026, 9, 14, 19, 39);
    expect(fechaHoraCorta(String(ms), { ahora: ahora2026 })).toBe("14/09 19:39");
  });

  it("sin pasarle `ahora` no revienta", () => {
    expect(fechaHoraCorta(Date.now())).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
  });
});
