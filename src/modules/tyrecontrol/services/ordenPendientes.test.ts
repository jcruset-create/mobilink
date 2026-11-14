import { describe, expect, it } from "vitest";
import {
  compararMatricula, compararPosicion, compararUnidad, grupoDeSitio,
  ordenarPendientes, recuentoPorGrupo, sitioDeVehiculo,
  type FilaPendiente, type Sitio,
} from "./ordenPendientes";
import type { PresenciaEnBase, VehiculoWebfleetEstado } from "../types";

/**
 * Lo que se fija aquí es que «ordenar por posición» signifique agrupar por
 * dónde hay que ir, y no ordenar alfabéticamente el texto de la chapa: eso
 * dejaría «En ruta» metido entre «En Calafell» y «En Reus», que es justo lo
 * que hace la lista inservible para salir a buscarlos.
 */

const sitio = (tono: Sitio["tono"], base: string | null = null): Sitio => ({ tono, base });

const fila = (matricula: string, s: Sitio, unidad: string | null = null): FilaPendiente =>
  ({ id: matricula, matricula, unidad, sitio: s });

describe("grupoDeSitio", () => {
  it("primero los que están en una base ahora", () => {
    expect(grupoDeSitio(sitio("base", "Reus"))).toBe(0);
  });

  it("después los que estuvieron en una base y hace rato que callan", () => {
    expect(grupoDeSitio(sitio("viejo", "Vilanova"))).toBe(1);
  });

  it("los de ruta van detrás: no se puede ir a por ellos", () => {
    expect(grupoDeSitio(sitio("ruta"))).toBe(2);
  });

  it("sin señal, sin posición o posición no válida, al final", () => {
    expect(grupoDeSitio(sitio("desconocido"))).toBe(3);
  });

  it("un «última vez» SIN base no se cuela entre los que sí tienen sitio", () => {
    // «Última vez fuera de las bases» no dice a dónde ir, así que vale lo
    // mismo que no saber nada.
    expect(grupoDeSitio(sitio("viejo", null))).toBe(3);
  });

  it("un «en base» sin nombre de base tampoco: no hay base a la que ir", () => {
    expect(grupoDeSitio(sitio("base", null))).toBe(3);
  });
});

describe("compararMatricula", () => {
  it("ordena como las lee una persona, con los números por valor", () => {
    expect(compararMatricula("9266KKK", "9986CDL")).toBeLessThan(0);
    expect(compararMatricula("1170NNC", "9266KKK")).toBeLessThan(0);
  });

  it("no distingue mayúsculas de minúsculas", () => {
    expect(compararMatricula("3361nsv", "3361NSV")).toBe(0);
  });
});

describe("compararUnidad", () => {
  it("un número escrito como texto se ordena por valor, no por letra", () => {
    // Por orden alfabético "1096" iría antes que "211", que es el error que
    // esto evita.
    expect(compararUnidad("211", "1096")).toBeLessThan(0);
  });

  it("los que no tienen número van al final: un hueco no es un cero", () => {
    expect(compararUnidad(null, "1")).toBeGreaterThan(0);
    expect(compararUnidad("1", "")).toBeLessThan(0);
    expect(compararUnidad(null, null)).toBe(0);
  });

  it("los espacios no cuentan como número", () => {
    expect(compararUnidad("   ", "7")).toBeGreaterThan(0);
  });
});

describe("compararPosicion", () => {
  it("manda el grupo sobre el nombre de la base", () => {
    // Vilanova en base va antes que Calafell de hace horas, aunque la C
    // vaya antes que la V.
    expect(compararPosicion(sitio("base", "Vilanova"), sitio("viejo", "Calafell"))).toBeLessThan(0);
  });

  it("dentro del mismo grupo, por nombre de base", () => {
    expect(compararPosicion(sitio("base", "Calafell"), sitio("base", "Reus"))).toBeLessThan(0);
  });

  it("en ruta nunca se mete entre dos bases", () => {
    expect(compararPosicion(sitio("ruta"), sitio("base", "Zaragoza"))).toBeGreaterThan(0);
    expect(compararPosicion(sitio("ruta"), sitio("desconocido"))).toBeLessThan(0);
  });
});

describe("ordenarPendientes", () => {
  const filas = [
    fila("9986CDL", sitio("ruta"), "1096"),
    fila("3363NSV", sitio("base", "Tarragona"), "211"),
    fila("9266KKK", sitio("viejo", null)),
    fila("3361NSV", sitio("base", "Calafell"), null),
    fila("8773NMX", sitio("base", "Reus"), "47"),
  ];

  it("por defecto, por matrícula", () => {
    expect(ordenarPendientes(filas, "matricula").map((f) => f.matricula))
      .toEqual(["3361NSV", "3363NSV", "8773NMX", "9266KKK", "9986CDL"]);
  });

  it("por posición: las bases primero y juntas, la ruta después, lo que no dice nada al final", () => {
    expect(ordenarPendientes(filas, "posicion").map((f) => f.matricula))
      .toEqual(["3361NSV", "8773NMX", "3363NSV", "9986CDL", "9266KKK"]);
  });

  it("por unidad: por valor, y los que no tienen número al final", () => {
    expect(ordenarPendientes(filas, "unidad").map((f) => f.unidad))
      .toEqual(["47", "211", "1096", null, null]);
  });

  it("la matrícula desempata siempre, así que la lista no baila entre dos cargas", () => {
    const empatados = [
      fila("9986CDL", sitio("base", "Reus")),
      fila("1170NNC", sitio("base", "Reus")),
    ];
    expect(ordenarPendientes(empatados, "posicion").map((f) => f.matricula))
      .toEqual(["1170NNC", "9986CDL"]);
  });

  it("no toca la lista que recibe", () => {
    const original = [...filas];
    ordenarPendientes(filas, "posicion");
    expect(filas).toEqual(original);
  });
});

describe("recuentoPorGrupo", () => {
  it("cuenta los cuatro grupos por separado", () => {
    expect(recuentoPorGrupo([
      fila("A", sitio("base", "Reus")),
      fila("B", sitio("base", "Reus")),
      fila("C", sitio("viejo", "Vilanova")),
      fila("D", sitio("ruta")),
      fila("E", sitio("desconocido")),
      fila("F", sitio("viejo", null)),
    ])).toEqual({ enBase: 2, ultimaVez: 1, enRuta: 1, sinSenal: 2 });
  });
});

describe("sitioDeVehiculo", () => {
  const presencia = (p: Partial<PresenciaEnBase>): PresenciaEnBase =>
    ({ vehiculo_id: "v", estado: "NO_POSITION", ...p });
  const base = (nombre: string) => ({ id: "d", nombre });

  it("en una base ahora mismo: se puede ir a por él", () => {
    expect(sitioDeVehiculo(presencia({ estado: "IN_BASE", delegacion: base("Reus") }), undefined))
      .toEqual({ tono: "base", base: "Reus" });
  });

  it("estuvo en una base y hace rato que calla: se sabe a dónde ir, con menos confianza", () => {
    expect(sitioDeVehiculo(presencia({ estado: "STALE_POSITION", delegacion: base("Vilanova") }), undefined))
      .toEqual({ tono: "viejo", base: "Vilanova" });
  });

  it("en ruta: no hay base a la que ir", () => {
    expect(sitioDeVehiculo(presencia({ estado: "OUTSIDE_BASES" }), undefined))
      .toEqual({ tono: "ruta", base: null });
  });

  it("sin posición: ni base ni ruta", () => {
    expect(sitioDeVehiculo(presencia({ estado: "NO_POSITION" }), undefined))
      .toEqual({ tono: "desconocido", base: null });
  });

  it("posición no válida no se confunde con «no hay posición»… pero tampoco dice dónde", () => {
    expect(sitioDeVehiculo(presencia({ estado: "INVALID_POSITION" }), undefined))
      .toEqual({ tono: "desconocido", base: null });
  });

  it("sin presencia tira de Webfleet, que es de dónde salen muchos", () => {
    const wf: VehiculoWebfleetEstado = {
      vehiculo_id: "v", empresa_id: "e", estado: "en_base", delegacion: base("Tarragona"),
    };
    expect(sitioDeVehiculo(undefined, wf)).toEqual({ tono: "base", base: "Tarragona" });
  });

  it("sin nada que mirar, no se inventa un sitio", () => {
    expect(sitioDeVehiculo(undefined, undefined)).toEqual({ tono: "desconocido", base: null });
  });

  it("un STALE sin nombre de base se queda sin base, y por eso cae al último grupo", () => {
    const s = sitioDeVehiculo(presencia({ estado: "STALE_POSITION" }), undefined);
    expect(s).toEqual({ tono: "viejo", base: null });
    expect(grupoDeSitio(s)).toBe(3);
  });
});
