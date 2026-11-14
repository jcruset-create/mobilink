import { describe, it, expect } from "vitest";
import { montajesDeCondicion, presionesDeEstado, tecnicosPorMetrica } from "./cuadrosInformes";
import type { PresionNeumatico, ProductividadTecnico } from "../types/informes";

describe("presionesDeEstado", () => {
  const p = (id: string, estado: string): PresionNeumatico => ({
    neumatico_id: id, codigo: id, matricula: "1234ABC", posicion: "E1_IZQ",
    presion_medida: 8, presion_recomendada: 8.5, diferencia: -0.5, estado,
  });
  const lista = [p("a", "baja"), p("b", "ok"), p("c", "baja"), p("d", "alta"), p("e", "sin_referencia"), p("f", "raro")];

  it("sin estado, todas: la misma lista", () => {
    expect(presionesDeEstado(lista, null)).toBe(lista);
  });

  it("cada cuadro deja las suyas, en su orden", () => {
    expect(presionesDeEstado(lista, "baja").map((i) => i.neumatico_id)).toEqual(["a", "c"]);
    expect(presionesDeEstado(lista, "alta").map((i) => i.neumatico_id)).toEqual(["d"]);
    expect(presionesDeEstado(lista, "sin_referencia").map((i) => i.neumatico_id)).toEqual(["e"]);
  });

  it("un estado que no es de ningún cuadro no se cuela en ninguno", () => {
    const enCuadros = (["baja", "alta", "ok", "sin_referencia"] as const).flatMap((e) => presionesDeEstado(lista, e));
    expect(enCuadros.map((i) => i.neumatico_id)).not.toContain("f");
  });
});

describe("tecnicosPorMetrica", () => {
  const t = (tecnico: string, revisiones: number, neumaticos_revisados: number, operaciones: number): ProductividadTecnico =>
    ({ tecnico_id: tecnico, tecnico, revisiones, neumaticos_revisados, operaciones });
  const lista = [t("Ana", 10, 60, 0), t("Blas", 0, 0, 7), t("Carla", 25, 150, 3), t("Dani", 10, 40, 0)];

  it("sin métrica, la lista tal cual", () => {
    expect(tecnicosPorMetrica(lista, null)).toBe(lista);
  });

  it("deja a los que tienen algo de eso, del que más al que menos", () => {
    expect(tecnicosPorMetrica(lista, "operaciones").map((i) => i.tecnico)).toEqual(["Blas", "Carla"]);
    expect(tecnicosPorMetrica(lista, "neumaticos_revisados").map((i) => i.tecnico)).toEqual(["Carla", "Ana", "Dani"]);
  });

  it("a igualdad, por nombre: el orden no baila entre cargas", () => {
    expect(tecnicosPorMetrica(lista, "revisiones").map((i) => i.tecnico)).toEqual(["Carla", "Ana", "Dani"]);
  });

  it("no desordena la lista que le pasan", () => {
    tecnicosPorMetrica(lista, "revisiones");
    expect(lista.map((i) => i.tecnico)).toEqual(["Ana", "Blas", "Carla", "Dani"]);
  });
});

describe("montajesDeCondicion", () => {
  const data = {
    por_referencia: [
      { marca: "Hankook", modelo: "AH51", medida: "295/80R22.5", condicion: "nueva", n: 8, historico: 0, normal: 8 },
      { marca: "Hankook", modelo: "AH51", medida: "295/80R22.5", condicion: "usada", n: 3, historico: 1, normal: 2 },
      { marca: "Insa", modelo: "K25", medida: "295/80R22.5", condicion: "recauchutada", n: 2, historico: 0, normal: 2 },
    ],
    por_vehiculo: [
      { vehiculo_id: "1", matricula: "1111AAA", n: 6, nuevas: 4, usadas: 2, recauchutadas: 0 },
      { vehiculo_id: "2", matricula: "2222BBB", n: 5, nuevas: 4, usadas: 0, recauchutadas: 1 },
      { vehiculo_id: "3", matricula: "3333CCC", n: 2, nuevas: 0, usadas: 1, recauchutadas: 1 },
    ],
  };

  it("sin condición, todo: referencias tal cual y el total de cada vehículo", () => {
    const r = montajesDeCondicion(data, null);
    expect(r.referencias).toBe(data.por_referencia);
    expect(r.vehiculos).toEqual([{ matricula: "1111AAA", n: 6 }, { matricula: "2222BBB", n: 5 }, { matricula: "3333CCC", n: 2 }]);
  });

  it("con una condición, sus referencias y cuántas de ESAS lleva cada vehículo", () => {
    const r = montajesDeCondicion(data, "usada");
    expect(r.referencias.map((x) => x.n)).toEqual([3]);
    expect(r.vehiculos).toEqual([{ matricula: "1111AAA", n: 2 }, { matricula: "3333CCC", n: 1 }]);
  });

  it("el vehículo que no lleva ninguna de esa condición no sale, y a igualdad va por matrícula", () => {
    expect(montajesDeCondicion(data, "nueva").vehiculos).toEqual([{ matricula: "1111AAA", n: 4 }, { matricula: "2222BBB", n: 4 }]);
    expect(montajesDeCondicion(data, "recauchutada").vehiculos.map((v) => v.matricula)).toEqual(["2222BBB", "3333CCC"]);
  });

  it("lo que suman los vehículos es lo que suman las referencias de esa condición", () => {
    for (const c of ["nueva", "usada", "recauchutada"] as const) {
      const r = montajesDeCondicion(data, c);
      expect(r.vehiculos.reduce((s, v) => s + v.n, 0)).toBe(r.referencias.reduce((s, x) => s + x.n, 0));
    }
  });
});
