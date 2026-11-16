import { describe, expect, it } from "vitest";
import { juzgarDesgaste, kmEnFecha, ritmoDeLaGoma, ritmoMedio, type LecturaConKm, type PuntoKm } from "./desgasteCreible";

/**
 * Las series son las del 2651JRM en producción el 16/11/2026: las revisiones
 * completas del arco desde que se montaron sus gomas en agosto, de la más
 * reciente a la más antigua. Fecha · km · profundidad.
 *
 * La delantera izquierda es el caso que hizo falta: nueva desde el 11/08, 12,2
 * mm el 13/11 y 1,6 el 14/11, 195 km después.
 */
type Fila = [fecha: string, km: number | null, e1izq: number, e2izqExt: number, e2izqInt: number];
const REVISIONES: Fila[] = [
  ["2026-11-16", null, 2.2, 3.8, 5.9],
  ["2026-11-14", 776502, 1.6, 4.9, 5.5],
  ["2026-11-10", 775838, 11.9, 3.9, 6.0],
  ["2026-11-09", 775587, 12.2, 4.2, 6.3],
  ["2026-11-04", 774688, 12.4, 4.1, 6.1],
  ["2026-10-30", 773827, 12.4, 4.6, 6.3],
  ["2026-10-29", 773661, 12.2, 4.7, 6.1],
  ["2026-10-01", null, 12.6, 5.2, 6.8],
  ["2026-09-30", null, 12.9, 5.4, 6.6],
  ["2026-09-26", 767958, 12.8, 5.8, 6.8],
  ["2026-09-25", 767578, 12.6, 5.3, 6.9],
  ["2026-09-07", 767431, 12.9, 5.6, 6.9],
  ["2026-09-04", 767299, 13.1, 5.7, 6.9],
  ["2026-09-03", 767057, 13.0, 5.7, 7.1],
  ["2026-09-02", 766817, 13.1, 5.9, 7.2],
  ["2026-09-01", 766573, 13.3, 5.9, 7.4],
  ["2026-08-31", 766329, 13.9, 6.0, 7.5],
  ["2026-08-30", 766083, 13.4, 6.6, 7.4],
  ["2026-08-29", 765933, 12.9, 6.5, 7.8],
  ["2026-08-28", 765645, 13.8, 6.6, 7.7],
  ["2026-08-27", 765404, 13.9, 6.8, 7.8],
  ["2026-08-26", 765144, 13.9, 7.1, 7.8],
  ["2026-08-23", 764681, 14.0, 7.1, 8.0],
  ["2026-08-21", 764567, 14.0, 7.2, 8.1],
  ["2026-08-20", 764160, 13.6, 7.1, 8.1],
  ["2026-08-13", 764143, 14.2, 7.5, 8.1],
  ["2026-08-12", 763662, 14.1, 7.8, 8.2],
];
const PUNTOS: PuntoKm[] = REVISIONES.filter((r) => r[1] != null).map((r) => ({ fecha: r[0], km: r[1] as number }));
const serie = (columna: 2 | 3 | 4, filas = REVISIONES): LecturaConKm[] =>
  filas.map((r) => ({ mm: r[columna], fecha: r[0], km: r[1] ?? kmEnFecha(PUNTOS, r[0]), manual: false }));

describe("kmEnFecha", () => {
  it("el día que se sabe, el que es", () => {
    expect(kmEnFecha(PUNTOS, "2026-11-14")).toBe(776502);
  });

  it("entre dos lecturas, en línea recta", () => {
    // 26/09: 767.958 · 29/10: 773.661 → 33 días. El 30/09 son 4 días.
    expect(kmEnFecha(PUNTOS, "2026-09-30")).toBe(Math.round(767958 + (773661 - 767958) / 33 * 4));
  });

  it("después de la última, con el ritmo del último mes", () => {
    const km = kmEnFecha(PUNTOS, "2026-11-16")!;
    expect(km).toBeGreaterThan(776502);
    expect(km).toBeLessThan(776502 + 1000);
  });

  it("con un solo punto no hay ritmo: solo vale ese día", () => {
    expect(kmEnFecha([{ fecha: "2026-11-14", km: 776502 }], "2026-11-16")).toBeNull();
    expect(kmEnFecha([{ fecha: "2026-11-14", km: 776502 }], "2026-11-14")).toBe(776502);
    expect(kmEnFecha([], "2026-11-14")).toBeNull();
  });
});

describe("ritmoDeLaGoma", () => {
  it("la delantera nueva: unos 0,16 mm cada 1.000 km", () => {
    expect(ritmoDeLaGoma(serie(2))!).toBeCloseTo(0.16, 1);
  });

  it("la trasera exterior se gasta el doble de deprisa", () => {
    expect(ritmoDeLaGoma(serie(3))!).toBeGreaterThan(0.25);
    expect(ritmoDeLaGoma(serie(3))!).toBeLessThan(0.4);
  });

  it("sin recorrido bastante no hay ritmo", () => {
    expect(ritmoDeLaGoma(serie(2, REVISIONES.slice(0, 8)))).toBeNull();
    // Nueve lecturas, pero todas en 1.400 km: no dan para un ritmo.
    expect(ritmoDeLaGoma(serie(2, REVISIONES.slice(12, 21)))).toBeNull();
  });
});

describe("juzgarDesgaste · el 2651JRM", () => {
  it("la delantera izquierda: 10 mm en unos 2.000 km no es desgaste", () => {
    const j = juzgarDesgaste(serie(2));
    expect(j.creible).toBe(false);
    expect(j.base).toEqual({ mm: 12.4, fecha: "2026-11-04" });
    expect(j.bajadaMm!).toBeCloseTo(10.2, 1);
    expect(j.permitidoMm!).toBeLessThan(2);
    expect(j.explicacion).toContain("medir con sonda");
  });

  it("la trasera exterior: su bajada sí cabe, el aviso es de verdad", () => {
    const j = juzgarDesgaste(serie(3));
    expect(j.creible).toBe(true);
    expect(j.bajadaMm!).toBeLessThan(1);
  });

  it("la trasera interior, que no avisa, también cabe", () => {
    expect(juzgarDesgaste(serie(4)).creible).toBe(true);
  });

  it("el día antes del disparate no había nada que objetar", () => {
    expect(juzgarDesgaste(serie(2, REVISIONES.slice(2))).creible).toBe(true);
  });
});

describe("juzgarDesgaste · cuándo no se juzga", () => {
  it("con menos de seis lecturas no hay base", () => {
    expect(juzgarDesgaste(serie(2).slice(0, 5)).creible).toBeNull();
  });

  it("si una de las tres últimas es de un técnico, manda la sonda", () => {
    const s = serie(2);
    s[1] = { ...s[1], manual: true };
    expect(juzgarDesgaste(s).creible).toBeNull();
  });

  it("sin kilómetros de ese tramo no se acusa a la lectura", () => {
    const s = serie(2).map((l) => ({ ...l, km: null }));
    expect(juzgarDesgaste(s).creible).toBeNull();
  });

  it("sin ritmo propio ni de reserva, tampoco", () => {
    expect(juzgarDesgaste(serie(2).slice(0, 7)).creible).toBeNull();
  });

  it("con el ritmo de las demás ruedas sí se juzga a la que no tiene el suyo", () => {
    const j = juzgarDesgaste(serie(2).slice(0, 7), 0.2);
    expect(j.creible).toBe(false);
    expect(j.ritmo).toBe(0.2);
  });
});

describe("juzgarDesgaste · el margen", () => {
  const plana = (mm: number[], kmPorLectura = 250): LecturaConKm[] =>
    mm.map((v, i) => ({ mm: v, fecha: null, km: 100000 - i * kmPorLectura, manual: false }));

  it("el baile del arco (1 mm) no hace saltar nada aunque la goma no se gaste", () => {
    expect(juzgarDesgaste(plana([7.1, 7.0, 7.2, 8.0, 8.0, 8.0]), 0).creible).toBe(true);
  });

  it("y un poco más que eso, sí", () => {
    expect(juzgarDesgaste(plana([6.8, 6.9, 6.8, 8.0, 8.0, 8.0]), 0).creible).toBe(false);
  });

  it("una goma que SUBE nunca es un desgaste imposible", () => {
    expect(juzgarDesgaste(plana([9.5, 9.6, 9.4, 8.0, 8.0, 8.0]), 0.2).creible).toBe(true);
  });
});

describe("ritmoMedio", () => {
  it("solo de las que tienen ritmo", () => {
    expect(ritmoMedio([0.2, null, 0.4])).toBeCloseTo(0.3);
    expect(ritmoMedio([null, null])).toBeNull();
  });
});
