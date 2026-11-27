import { describe, expect, it } from "vitest";

import { conclusion, ventanasDePrueba, type Respuesta, type ResultadoVentana, type Ventana } from "./prueba.ts";

const OCT = { year: 2026, month: 10 };
const ventanas = ventanasDePrueba(OCT, "Europe/Madrid");

const con = (r: Partial<Record<Ventana["clave"], Respuesta>>): ResultadoVentana[] =>
  [...ventanas, { clave: "control" as const, etiqueta: "control", desde: ventanas[0].desde, hasta: ventanas[0].hasta }]
    .map((v) => ({ ...v, unidad: "1", peticion: { units: [1], initial_date: 0, end_date: 0 }, respuesta: r[v.clave] ?? { tipo: "vacio" } }));

const OK: Respuesta = { tipo: "ok", km: 100, odometroInicial: null, odometroFinal: null, viajes: 3 };
const ERR: Respuesta = { tipo: "error", mensaje: "Cannot read properties of undefined" };

describe("ventanasDePrueba", () => {
  it("el mes, las dos quincenas, una semana, un día y el mes anterior, en hora de Madrid", () => {
    expect(ventanas.map((v) => v.clave)).toEqual(["mes", "q1", "q2", "semana", "dia", "anterior"]);
    expect(ventanas[0].desde.toISOString()).toBe("2026-09-30T22:00:00.000Z"); // 1/10 00:00 Madrid (verano)
    expect(ventanas[0].hasta.toISOString()).toBe("2026-10-31T23:00:00.000Z"); // 1/11 00:00 Madrid (invierno)
    expect(ventanas[1].hasta.toISOString()).toBe("2026-10-15T22:00:00.000Z"); // 16/10
    expect(ventanas[2].etiqueta).toBe("16–31 de octubre");
    expect(ventanas[4].hasta.getTime() - ventanas[4].desde.getTime()).toBe(24 * 3_600_000);
    expect(ventanas[5].etiqueta).toContain("septiembre");
  });
});

describe("conclusion", () => {
  it("todo falla y el control funciona: es de Movertis con esta unidad", () => {
    const t = conclusion(con({ mes: ERR, q1: ERR, q2: ERR, semana: ERR, dia: ERR, anterior: OK, control: OK }));
    expect(t).toContain("problema es de Movertis con esta unidad");
    expect(t).toContain("mes anterior entero sí funciona");
  });
  it("solo falla el mes entero: se arregla pidiendo por partes", () => {
    expect(conclusion(con({ mes: ERR, q1: OK, q2: OK, semana: OK, dia: OK, control: OK }))).toContain("por partes");
  });
  it("el control también falla: fallo general, repetir", () => {
    expect(conclusion(con({ mes: ERR, q1: ERR, q2: ERR, semana: ERR, dia: ERR, control: ERR }))).toContain("fallo general");
  });
  it("todo bien: se puede volver a pedir", () => {
    expect(conclusion(con({ mes: OK, q1: OK, q2: OK, semana: OK, dia: OK }))).toContain("contesta bien");
  });
  it("avisa si alguna ventana se quedó sin turno", () => {
    expect(conclusion(con({ mes: ERR, q1: { tipo: "sin_turno" } }))).toContain("límite de peticiones");
  });
});
