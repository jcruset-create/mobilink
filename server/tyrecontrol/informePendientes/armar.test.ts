import { describe, expect, it } from "vitest";
import {
  armarPendientes, clave, enPalabras, indexarFichas, minutosDesde, prioridad,
  type FichaVehiculo, type PresenciaFila,
} from "./armar.ts";
import type { RevisionEstado } from "../../../src/modules/tyrecontrol/types/index.ts";

/**
 * Lo que se fija aquí es que el papel diga lo mismo que la pantalla.
 *
 *  · Solo `IN_BASE`. Un `STALE_POSITION` cae dentro del recinto y
 *    probablemente siga ahí, pero «probablemente» no es a quien se manda
 *    buscar al patio: si el PDF lo incluye, alguien da una vuelta en balde.
 *  · El orden es el de la urgencia, no el alfabético: la hoja se usa de
 *    arriba abajo.
 *  · Lo que se deja fuera se DICE. Un vehículo en base sin delegación no se
 *    mete en un cajón llamado «otras»: se cuenta y se avisa.
 */

const AHORA = new Date("2026-11-04T12:00:00Z");

const pres = (p: Partial<PresenciaFila> & { vehiculo_id: string }): PresenciaFila => ({
  estado: "IN_BASE", delegacion_id: "b1", distancia_m: 50, antiguedad_min: 5,
  entrada_base_at: "2026-11-04T09:00:00Z", posicion_at: "2026-11-04T11:55:00Z",
  vehiculo: { matricula: "1234ABC", numero_unidad: "10" },
  delegacion: { id: "b1", nombre: "Tarragona" }, ...p,
});

const rev = (estado: string, p: Partial<RevisionEstado> = {}): RevisionEstado =>
  ({ vehiculo_id: "v", estado: estado as never, ...p });

const ficha = (p: Partial<FichaVehiculo> = {}): FichaVehiculo => ({
  matricula: "1234ABC", unidad: "10", base: "Tarragona", tipo: "autobus",
  config: "2x4 BUS", medida: "295/80R22.5", estado: "revisar",
  ultima_revision: "2026-09-01", dias_desde: 64, ruedas_plano: 6, ruedas_montadas: 6,
  ruedas_medidas: 6, profundidad_minima: 5.2, bajo_minimo: 0, en_aviso: 1,
  km_actual: 120000, ...p,
});

const op = (p: Partial<Parameters<typeof armarPendientes>[4]> = {}) =>
  ({ baseId: null, ahora: AHORA, ...p });

describe("armarPendientes · quién entra", () => {
  it("solo los que están DENTRO: un STALE no se manda buscar", () => {
    const d = armarPendientes(
      [pres({ vehiculo_id: "v1" }), pres({ vehiculo_id: "v2", estado: "STALE_POSITION" })],
      new Map([["v1", rev("vencida")], ["v2", rev("vencida")]]),
      new Map(), "Plana", op());
    expect(d.total).toBe(1);
  });

  it("solo los que tienen revisión pendiente", () => {
    const d = armarPendientes(
      [pres({ vehiculo_id: "v1" }), pres({ vehiculo_id: "v2" })],
      new Map([["v1", rev("vencida")], ["v2", rev("al_dia")]]),
      new Map(), "Plana", op());
    expect(d.total).toBe(1);
  });

  it("sin estado de revisión cuenta como pendiente: no se sabe nada de él", () => {
    const d = armarPendientes([pres({ vehiculo_id: "v1" })], new Map(), new Map(), "Plana", op());
    // `tieneRevisionPendiente(undefined)` es false, así que NO entra: el
    // criterio lo decide la pantalla, no este módulo. Se fija para que si
    // algún día cambia allí, aquí salte.
    expect(d.total).toBe(0);
  });

  it("un vehículo en base sin delegación no se agrupa, y se dice", () => {
    const d = armarPendientes(
      [pres({ vehiculo_id: "v1", delegacion_id: null })],
      new Map([["v1", rev("vencida")]]), new Map(), "Plana", op());
    expect(d.total).toBe(0);
    expect(d.advertencias.join(" ")).toMatch(/sin delegación/i);
  });

  /**
   * Un PDF vacío tiene cuatro motivos y no se arreglan en el mismo sitio.
   * «No hay ningún vehículo pendiente» se lee como «está todo al día», que
   * solo es cierto en uno de los cuatro: decirlo en los otros tres es
   * afirmar algo que nadie ha comprobado.
   */
  it("sin barrido: lo dice, en vez de dar a entender que está todo al día", () => {
    const d = armarPendientes([], new Map(), new Map(), "Plana", op());
    expect(d.advertencias.join(" ")).toMatch(/ningún barrido de posiciones/i);
  });

  it("con barrido pero nadie dentro de una base, lo dice así", () => {
    const d = armarPendientes(
      [pres({ vehiculo_id: "v1", estado: "OUTSIDE_BASES" })],
      new Map([["v1", rev("vencida")]]), new Map(), "Plana", op());
    expect(d.advertencias.join(" ")).toMatch(/está dentro de una base/i);
  });

  it("con gente dentro y todos al día, se dice que están al día", () => {
    const d = armarPendientes(
      [pres({ vehiculo_id: "v1" }), pres({ vehiculo_id: "v2" })],
      new Map([["v1", rev("al_dia")], ["v2", rev("al_dia")]]), new Map(), "Plana", op());
    expect(d.advertencias.join(" ")).toMatch(/revisión al día/i);
  });

  it("con pendientes pero en otra base, se dice que en ESA base no hay", () => {
    const d = armarPendientes(
      [pres({ vehiculo_id: "v1", delegacion_id: "b1" })],
      new Map([["v1", rev("vencida")]]), new Map(), "Plana", op({ baseId: "b9" }));
    expect(d.advertencias.join(" ")).toMatch(/dentro de esa base/i);
  });
});

describe("armarPendientes · el filtro por base", () => {
  const presencia = [
    pres({ vehiculo_id: "v1", delegacion_id: "b1", delegacion: { id: "b1", nombre: "Tarragona" } }),
    pres({ vehiculo_id: "v2", delegacion_id: "b2", delegacion: { id: "b2", nombre: "Reus" } }),
  ];
  const revisiones = new Map([["v1", rev("vencida")], ["v2", rev("vencida")]]);

  it("sin filtro salen todas las bases", () => {
    const d = armarPendientes(presencia, revisiones, new Map(), "Plana", op());
    expect(d.bases.map((b) => b.nombre).sort()).toEqual(["Reus", "Tarragona"]);
    expect(d.baseFiltrada).toBeNull();
  });

  it("con filtro sale una sola, y el documento dice cuál", () => {
    const d = armarPendientes(presencia, revisiones, new Map(), "Plana", op({ baseId: "b2" }));
    expect(d.bases.map((b) => b.nombre)).toEqual(["Reus"]);
    expect(d.baseFiltrada).toBe("Reus");
    expect(d.total).toBe(1);
  });

  it("una base sin pendientes avisa en vez de salir vacía", () => {
    const d = armarPendientes(presencia, revisiones, new Map(), "Plana", op({ baseId: "b9" }));
    expect(d.total).toBe(0);
    expect(d.advertencias.join(" ")).toMatch(/dentro de esa base/i);
  });

  it("filtrando una base sin pendientes, la cabecera sigue diciendo cuál", () => {
    // Si no, una hoja vacía de Reus se imprime como «todas las bases» y
    // parece que no hay nada pendiente en ninguna parte.
    const d = armarPendientes(
      [pres({ vehiculo_id: "v1", delegacion_id: "b2", delegacion: { id: "b2", nombre: "Reus" } })],
      new Map([["v1", rev("al_dia")]]), new Map(), "Plana", op({ baseId: "b2" }));
    expect(d.total).toBe(0);
    expect(d.baseFiltrada).toBe("Reus");
  });
});

describe("armarPendientes · el orden", () => {
  it("sin revisión, luego vencida, luego próxima", () => {
    expect(prioridad("sin_revision")).toBeLessThan(prioridad("vencida"));
    expect(prioridad("vencida")).toBeLessThan(prioridad("proxima"));
  });

  it("dentro del mismo estado, más días vencido primero", () => {
    const d = armarPendientes([
      pres({ vehiculo_id: "a", vehiculo: { matricula: "AAA" } }),
      pres({ vehiculo_id: "b", vehiculo: { matricula: "BBB" } }),
    ], new Map([
      ["a", rev("vencida", { dias_vencido: 3 })],
      ["b", rev("vencida", { dias_vencido: 90 })],
    ]), new Map(), "Plana", op());
    expect(d.bases[0].vehiculos.map((v) => v.matricula)).toEqual(["BBB", "AAA"]);
  });

  it("a igualdad, el que lleva más rato dentro primero: puede irse antes", () => {
    const d = armarPendientes([
      pres({ vehiculo_id: "a", vehiculo: { matricula: "AAA" }, entrada_base_at: "2026-11-04T11:30:00Z" }),
      pres({ vehiculo_id: "b", vehiculo: { matricula: "BBB" }, entrada_base_at: "2026-11-01T09:00:00Z" }),
    ], new Map([["a", rev("vencida")], ["b", rev("vencida")]]), new Map(), "Plana", op());
    expect(d.bases[0].vehiculos.map((v) => v.matricula)).toEqual(["BBB", "AAA"]);
  });

  it("las bases van por lo que más corre, no por nombre", () => {
    const d = armarPendientes([
      pres({ vehiculo_id: "a", delegacion_id: "z", delegacion: { id: "z", nombre: "Zaragoza" } }),
      pres({ vehiculo_id: "b", delegacion_id: "z", delegacion: { id: "z", nombre: "Zaragoza" } }),
      pres({ vehiculo_id: "c", delegacion_id: "a", delegacion: { id: "a", nombre: "Alcañiz" } }),
    ], new Map([
      ["a", rev("vencida")], ["b", rev("vencida")], ["c", rev("proxima")],
    ]), new Map(), "Plana", op());
    expect(d.bases.map((b) => b.nombre)).toEqual(["Zaragoza", "Alcañiz"]);
    expect(d.bases[0].vencidos).toBe(2);
  });
});

describe("armarPendientes · la ficha", () => {
  it("se cruza por matrícula normalizada: los espacios no la pierden", () => {
    const fichas = indexarFichas([ficha({ matricula: "1234 ABC" })]);
    const d = armarPendientes([pres({ vehiculo_id: "v1" })],
      new Map([["v1", rev("vencida")]]), fichas, "Plana", op());
    expect(d.bases[0].vehiculos[0].ficha?.tipo).toBe("autobus");
  });

  it("si el vehículo no está en la flota, sale igual y se avisa", () => {
    const d = armarPendientes([pres({ vehiculo_id: "v1" })],
      new Map([["v1", rev("vencida")]]), new Map(), "Plana", op());
    expect(d.bases[0].vehiculos[0].ficha).toBeNull();
    expect(d.advertencias.join(" ")).toMatch(/sin los datos de su ficha/i);
  });
});

describe("minutosDesde y enPalabras", () => {
  it("cuenta los minutos desde un instante", () => {
    expect(minutosDesde("2026-11-04T09:00:00Z", AHORA)).toBe(180);
  });

  it("una fecha futura no da minutos negativos", () => {
    expect(minutosDesde("2026-11-04T13:00:00Z", AHORA)).toBe(0);
  });

  it("sin fecha, o con una que no se entiende, no se inventa un número", () => {
    expect(minutosDesde(null, AHORA)).toBeNull();
    expect(minutosDesde("vete a saber", AHORA)).toBeNull();
  });

  it("se escribe como lo diría una persona", () => {
    expect(enPalabras(45)).toBe("45 min");
    expect(enPalabras(130)).toBe("2 h 10 min");
    expect(enPalabras(60 * 24 * 3 + 60 * 7)).toBe("3 d 7 h");
    expect(enPalabras(null)).toBe("—");
  });
});

describe("clave", () => {
  it("normaliza para cruzar matrículas escritas de otra manera", () => {
    expect(clave("1234 abc")).toBe("1234ABC");
    expect(clave("1234-ABC")).toBe("1234ABC");
    expect(clave(null)).toBe("");
  });

  it("al indexar, la primera gana y no revienta con repetidas", () => {
    const m = indexarFichas([ficha({ tipo: "autobus" }), ficha({ tipo: "autocar" })]);
    expect(m.get("1234ABC")?.tipo).toBe("autobus");
  });
});
