import { describe, expect, it } from "vitest";
import {
  descripcionDeMeses, etiquetaPeriodo, mesesElegidos, resumenPorMes, totalACrear,
} from "./lotesMensuales";

/**
 * Lo que se fija aquí es el número que sale en el botón y en el «¿seguro?».
 * Equivocarlo es justo lo que no puede pasar: con un Excel de diez meses, la
 * diferencia entre «1.484» y «148» es la diferencia entre importar el
 * histórico entero y importar enero.
 *
 * Y un principio que vale para toda la pantalla: **sin simular no hay
 * número**. Un cero en esa casilla diría «este mes no trae nada», que es una
 * afirmación; lo que de verdad pasa es que nadie lo ha calculado todavía.
 */

const alb = (origen_doc: string) => ({ origen_doc });

const lotes = new Map([
  ["2026-01", [alb("a"), alb("b"), alb("c")]],
  ["2026-02", [alb("d"), alb("e")]],
]);

const sim = (pares: Record<string, string>) =>
  new Map(Object.entries(pares).map(([k, v]) => [k, { estado: v as never }]));

describe("resumenPorMes", () => {
  it("sin simular cuenta albaranes y deja el resto en null, no en cero", () => {
    const r = resumenPorMes(lotes, null);
    expect(r).toEqual([
      { periodo: "2026-01", albaranes: 3, seCrearian: null, yaPresentes: null, bloqueados: null },
      { periodo: "2026-02", albaranes: 2, seCrearian: null, yaPresentes: null, bloqueados: null },
    ]);
  });

  it("con simulación reparte cada albarán en su estado", () => {
    const r = resumenPorMes(lotes, sim({
      a: "se_crearia", b: "se_crearia", c: "bloqueado",
      d: "ya_presente", e: "se_crearia",
    }));
    expect(r[0]).toMatchObject({ periodo: "2026-01", seCrearian: 2, bloqueados: 1, yaPresentes: 0 });
    expect(r[1]).toMatchObject({ periodo: "2026-02", seCrearian: 1, bloqueados: 0, yaPresentes: 1 });
  });

  it("un albarán que la simulación no devolvió no se cuenta en ningún estado", () => {
    const r = resumenPorMes(lotes, sim({ a: "se_crearia" }));
    expect(r[0]).toMatchObject({ albaranes: 3, seCrearian: 1, bloqueados: 0, yaPresentes: 0 });
  });

  it("respeta el orden del fichero: el primero es el más antiguo", () => {
    expect(resumenPorMes(lotes, null).map((m) => m.periodo)).toEqual(["2026-01", "2026-02"]);
  });

  it("un fichero sin meses no da filas", () => {
    expect(resumenPorMes(new Map(), null)).toEqual([]);
  });
});

describe("mesesElegidos", () => {
  const periodos = ["2026-01", "2026-02", "2026-03"];

  it("null significa todos: un fichero recién leído se comporta como siempre", () => {
    expect(mesesElegidos(periodos, null)).toEqual(periodos);
  });

  it("devuelve los marcados en el orden del fichero, no en el de marcado", () => {
    expect(mesesElegidos(periodos, new Set(["2026-03", "2026-01"]))).toEqual(["2026-01", "2026-03"]);
  });

  it("ninguno marcado es ninguno, no todos", () => {
    expect(mesesElegidos(periodos, new Set())).toEqual([]);
  });

  it("un mes marcado que no está en el fichero no inventa una fila", () => {
    expect(mesesElegidos(periodos, new Set(["2025-12"]))).toEqual([]);
  });
});

describe("totalACrear", () => {
  const meses = resumenPorMes(lotes, sim({
    a: "se_crearia", b: "se_crearia", c: "bloqueado",
    d: "ya_presente", e: "se_crearia",
  }));

  it("suma solo lo de los meses marcados", () => {
    expect(totalACrear(meses, new Set(["2026-01"]))).toBe(2);
    expect(totalACrear(meses, new Set(["2026-02"]))).toBe(1);
    expect(totalACrear(meses, null)).toBe(3);
  });

  it("sin nada marcado, cero: el botón no puede escribir nada", () => {
    expect(totalACrear(meses, new Set())).toBe(0);
  });

  it("sin simular no hay número que prometer", () => {
    expect(totalACrear(resumenPorMes(lotes, null), null)).toBeNull();
  });

  it("si el mes marcado está sin simular, tampoco: no se suma a medias", () => {
    const mezcla = [
      { periodo: "2026-01", albaranes: 3, seCrearian: 2, yaPresentes: 0, bloqueados: 1 },
      { periodo: "2026-02", albaranes: 2, seCrearian: null, yaPresentes: null, bloqueados: null },
    ];
    expect(totalACrear(mezcla, null)).toBeNull();
    // Pero si el que falta NO está marcado, el número del marcado sí vale.
    expect(totalACrear(mezcla, new Set(["2026-01"]))).toBe(2);
  });
});

describe("etiquetaPeriodo", () => {
  it("se lee como un mes, no como un código", () => {
    expect(etiquetaPeriodo("2026-01")).toContain("2026");
    expect(etiquetaPeriodo("2026-01")).not.toBe("2026-01");
  });

  it("enero es enero: el mes va por su número de persona", () => {
    expect(etiquetaPeriodo("2026-01")).not.toBe(etiquetaPeriodo("2026-02"));
  });

  it("diciembre no se desborda al año siguiente", () => {
    expect(etiquetaPeriodo("2025-12")).toContain("2025");
  });

  it("lo que no es un periodo se enseña tal cual, sin inventar una fecha", () => {
    expect(etiquetaPeriodo("sin-fecha")).toBe("sin-fecha");
    expect(etiquetaPeriodo("")).toBe("");
  });
});

describe("descripcionDeMeses", () => {
  it("ninguno se dice, en vez de dejar la frase coja", () => {
    expect(descripcionDeMeses([])).toBe("ningún mes");
  });

  it("uno o dos se nombran enteros", () => {
    expect(descripcionDeMeses(["2026-01"])).toBe(etiquetaPeriodo("2026-01"));
    expect(descripcionDeMeses(["2026-01", "2026-02"])).toContain(" y ");
  });

  it("con más se dice cuántos y de cuándo a cuándo: es lo que se comprueba de un vistazo", () => {
    const t = descripcionDeMeses(["2026-01", "2026-02", "2026-03"]);
    expect(t).toContain("3 meses");
    expect(t).toContain(etiquetaPeriodo("2026-01"));
    expect(t).toContain(etiquetaPeriodo("2026-03"));
  });
});
