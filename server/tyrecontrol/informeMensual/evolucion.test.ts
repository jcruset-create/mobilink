import { describe, expect, it } from "vitest";

import {
  mesesHasta, quesitoDeBandas, quesitoDeCondicion, recortar, serieMensual,
  type MesEvolucion,
} from "./evolucion.ts";
import { BANDAS, type RuedaCompleta } from "./matrices.ts";
import { periodoDeMes } from "./armar.ts";

const rueda = (o: Partial<RuedaCompleta> = {}): RuedaCompleta => ({
  vehiculoId: "v1", posicion: 1, profundidadMm: 8, fecha: "2026-10-10",
  revisionId: "r1", neumaticoId: "n1", estadoVisual: null,
  marca: "HANKOOK", modelo: "AH31", medida: "295/80R22.5",
  reesculturada: false, recauchutada: false, rayada: false, condicionConocida: true,
  ...o,
});

const mes = (o: Partial<MesEvolucion> = {}): MesEvolucion => ({
  mes: "2026-10", etiqueta: "OCTUBRE 2026",
  porBanda: [0, 0, 0, 0, 0, 0], pctPorBanda: [0, 0, 0, 0, 0, 0],
  total: 0, ruedas: 0, recauchutadas: 0, reesculturadas: 0, ...o,
});

describe("mesesHasta()", () => {
  it("devuelve los doce meses que acaban en el pedido, en orden", () => {
    const m = mesesHasta("2026-10");
    expect(m).toHaveLength(12);
    expect(m[0].mes).toBe("2025-11");
    expect(m[11].mes).toBe("2026-10");
  });

  // Restando días se pierde un 31 de marzo; con aritmética de meses, no.
  it("cruza el cambio de año sin perderse", () => {
    const m = mesesHasta("2026-02", 4).map((p) => p.mes);
    expect(m).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("y los meses de 31 días no desplazan nada", () => {
    expect(mesesHasta("2026-03", 2).map((p) => p.mes)).toEqual(["2026-02", "2026-03"]);
  });

  it("se le puede pedir menos de doce", () => {
    expect(mesesHasta("2026-10", 3).map((p) => p.mes)).toEqual(["2026-08", "2026-09", "2026-10"]);
  });
});

describe("serieMensual()", () => {
  const periodos = ["2026-09", "2026-10"].map(periodoDeMes);

  it("reparte las ruedas por banda, mes a mes", () => {
    const ruedas = new Map([
      ["2026-09", [rueda({ profundidadMm: 3 }), rueda({ profundidadMm: 13 })]],
      ["2026-10", [rueda({ profundidadMm: 3 })]],
    ]);
    const s = serieMensual(periodos, ruedas);
    expect(s[0].porBanda).toEqual([1, 0, 0, 0, 0, 1]);
    expect(s[1].porBanda).toEqual([1, 0, 0, 0, 0, 0]);
  });

  it("los porcentajes son sobre el total del mes, no de la serie", () => {
    const ruedas = new Map([
      ["2026-09", [rueda({ profundidadMm: 3 }), rueda({ profundidadMm: 13 })]],
      ["2026-10", [rueda({ profundidadMm: 3 })]],
    ]);
    const s = serieMensual(periodos, ruedas);
    expect(s[0].pctPorBanda[0]).toBe(50);
    expect(s[1].pctPorBanda[0]).toBe(100);
  });

  it("un mes sin ruedas sale a cero y no se salta", () => {
    const s = serieMensual(periodos, new Map([["2026-10", [rueda()]]]));
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ mes: "2026-09", ruedas: 0, total: 0 });
    expect(s[0].pctPorBanda).toEqual([0, 0, 0, 0, 0, 0]);
  });

  // Revisada sin apuntar la profundidad es revisada: cuenta como rueda pero
  // no cae en ninguna banda, y por eso los dos totales son distintos.
  it("distingue ruedas revisadas de ruedas con profundidad", () => {
    const ruedas = new Map([["2026-10", [rueda(), rueda({ profundidadMm: null, posicion: 2 })]]]);
    const s = serieMensual(periodos, ruedas);
    expect(s[1].ruedas).toBe(2);
    expect(s[1].total).toBe(1);
  });

  it("cuenta recauchutadas y reesculturadas de cada mes", () => {
    const ruedas = new Map([
      ["2026-10", [rueda({ recauchutada: true }), rueda({ reesculturada: true, posicion: 2 })]],
    ]);
    const s = serieMensual(periodos, ruedas);
    expect(s[1]).toMatchObject({ recauchutadas: 1, reesculturadas: 1 });
  });

  it("la etiqueta es la del mes, para el eje de la gráfica", () => {
    expect(serieMensual(periodos, new Map())[1].etiqueta).toBe("OCTUBRE 2026");
  });
});

describe("recortar()", () => {
  /*
   * El caso de Plana: la operación empieza en agosto de 2026 y antes hay
   * cuatro revisiones sueltas. Doce barras con eso dibujarían una caída que
   * no es de los neumáticos, sino de cuándo se instaló el programa.
   */
  it("quita los meses vacíos del principio y dice desde cuándo", () => {
    const serie = [
      mes({ mes: "2026-06", etiqueta: "JUNIO 2026" }),
      mes({ mes: "2026-07", etiqueta: "JULIO 2026" }),
      mes({ mes: "2026-08", etiqueta: "AGOSTO 2026", ruedas: 300, total: 300 }),
    ];
    const r = recortar(serie);
    expect(r.meses).toHaveLength(1);
    expect(r.desde).toBe("2026-08");
    expect(r.mesesVaciosAlPrincipio).toBe(2);
    expect(r.avisos.some((a) => a.includes("AGOSTO 2026"))).toBe(true);
  });

  // Un mes sin revisiones entre dos que sí las tienen es información: es un
  // mes en el que no se revisó. Esconderlo haría una lista de meses buenos.
  it("pero NO quita los huecos de en medio", () => {
    const serie = [
      mes({ mes: "2026-08", etiqueta: "AGOSTO 2026", ruedas: 300 }),
      mes({ mes: "2026-09", etiqueta: "SEPTIEMBRE 2026" }),
      mes({ mes: "2026-10", etiqueta: "OCTUBRE 2026", ruedas: 400 }),
    ];
    const r = recortar(serie);
    expect(r.meses).toHaveLength(3);
    expect(r.meses[1].ruedas).toBe(0);
    expect(r.avisos.some((a) => a.includes("SEPTIEMBRE 2026"))).toBe(true);
  });

  it("sin recorte no inventa un aviso", () => {
    const r = recortar([mes({ ruedas: 300 })]);
    expect(r.mesesVaciosAlPrincipio).toBe(0);
    expect(r.avisos.some((a) => a.includes("La serie empieza"))).toBe(false);
  });

  it("sin ningún mes con datos lo dice y no devuelve una serie vacía muda", () => {
    const r = recortar([mes(), mes()]);
    expect(r.meses).toEqual([]);
    expect(r.desde).toBeNull();
    expect(r.avisos[0]).toContain("No hay ninguna revisión");
  });

  // Un mes con nueve ruedas da porcentajes de 11 en 11: ponerlo al lado de
  // uno de 2.000 invita a leer una tendencia que no existe.
  it("avisa de los meses con muy pocas ruedas, que no son comparables", () => {
    const serie = [
      mes({ mes: "2026-09", etiqueta: "SEPTIEMBRE 2026", ruedas: 9 }),
      mes({ mes: "2026-10", etiqueta: "OCTUBRE 2026", ruedas: 2000 }),
    ];
    expect(recortar(serie).avisos.some((a) => a.includes("menos de 100 ruedas"))).toBe(true);
  });

  it("y no avisa cuando todos los meses tienen volumen", () => {
    const serie = [mes({ ruedas: 500 }), mes({ mes: "2026-11", ruedas: 600 })];
    expect(recortar(serie).avisos.some((a) => a.includes("menos de 100"))).toBe(false);
  });
});

describe("los quesitos", () => {
  it("el del banco de goma son las seis bandas, en orden", () => {
    const q = quesitoDeBandas(mes({ porBanda: [1, 2, 3, 4, 5, 6], pctPorBanda: [5, 10, 14, 19, 24, 28], total: 21 }));
    expect(q.map((p) => p.etiqueta)).toEqual([...BANDAS]);
    expect(q.map((p) => p.valor)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  /*
   * Sin la porción «Resto», dos valores de 0 y 2 harían un círculo entero de
   * reesculturadas y el informe diría que toda la flota lo está.
   */
  it("el de condición lleva «Resto», o un 2 de 2.116 llenaría el círculo", () => {
    const q = quesitoDeCondicion(mes({ ruedas: 2116, recauchutadas: 0, reesculturadas: 2 }));
    expect(q.map((p) => p.etiqueta)).toEqual(["Recauchutadas", "Reesculturadas", "Resto"]);
    expect(q[2].valor).toBe(2114);
    expect(q[1].pct).toBe(0.09);
    expect(q.reduce((a, p) => a + p.valor, 0)).toBe(2116);
  });

  it("sin ruedas no divide entre cero", () => {
    expect(quesitoDeCondicion(mes()).every((p) => p.pct === 0)).toBe(true);
  });
});
