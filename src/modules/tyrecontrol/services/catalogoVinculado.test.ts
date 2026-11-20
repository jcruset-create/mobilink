import { describe, expect, it } from "vitest";
import {
  claveMedida, combosVista, delModelo, juntarIndice, partirIndice, porIndice, porMedida, porVelocidad,
  type CombinacionCat, type ReferenciaCat,
} from "./catalogoVinculado";

const medidas = [
  { id: "m1", valor: "195/70R15" },
  { id: "m2", valor: "385/65R22.5" },
  { id: "m3", valor: "225/65R16CP" },
  { id: "m0", valor: "0" },
];
const combos: CombinacionCat[] = [
  { id: "c1", medida_id: "m1", medida: "195/70R15", indice_carga_simple: "104", indice_carga_doble: "102", codigo_velocidad: "R" },
  { id: "c2", medida_id: null, medida: "195/70 r15", indice_carga_simple: "100", indice_carga_doble: "98", codigo_velocidad: "r" },
  { id: "c3", medida_id: "m2", medida: "385/65R22.5", indice_carga_simple: "160", indice_carga_doble: null, codigo_velocidad: "K" },
];
const ref = (id: string, modelo: string, marca: string, combo: string): ReferenciaCat =>
  ({ id, modelo_id: modelo, tyre_size_id: combo, modelo: { id: modelo, nombre: modelo.toUpperCase(), marca: { nombre: marca } } });
const refs = [
  ref("r1", "ra58", "Hankook", "c1"),
  ref("r2", "agilis 3", "Michelin", "c1"),
  ref("r3", "ra18", "Hankook", "c2"),
  ref("r4", "duravis", "Bridgestone", "c3"),
];
const vista = combosVista(combos, refs);

describe("combinaciones", () => {
  it("dicen su índice como se lee en el flanco y sus modelos con la marca", () => {
    const c1 = vista.find((c) => c.id === "c1")!;
    expect(c1.ic).toBe("104/102");
    expect(c1.cv).toBe("R");
    expect(c1.modelos).toEqual(["Hankook RA58", "Michelin AGILIS 3"]);
    expect(vista.find((c) => c.id === "c3")!.ic).toBe("160");
  });
});

describe("por medida", () => {
  const pm = porMedida(medidas, vista, combos);

  it("cada medida con sus combinaciones, también la que se escribió distinto", () => {
    const m1 = pm.find((m) => m.medida.id === "m1")!;
    expect(m1.combos.map((c) => c.ic + c.cv)).toEqual(["100/98R", "104/102R"]);
  });

  it("la que no tiene ninguna sale vacía, y la medida «0» no sale", () => {
    expect(pm.find((m) => m.medida.id === "m3")!.combos).toEqual([]);
    expect(pm.some((m) => m.medida.valor === "0")).toBe(false);
  });

  it("CP es otra medida: no se le cuelgan las de la C", () => {
    expect(claveMedida("225/65 R16CP")).not.toBe(claveMedida("225/65R16"));
  });
});

describe("por índice de carga", () => {
  const pi = porIndice([
    { id: "i1", valor: "102" }, { id: "i2", valor: "104" }, { id: "i3", valor: "160" }, { id: "i4", valor: "121" },
  ], vista);

  it("dice si se usa de sencillo o de gemelo, y en qué medidas", () => {
    expect(pi.find((x) => x.indice.valor === "102")).toMatchObject({ como: "gemelo", medidas: ["195/70R15"] });
    expect(pi.find((x) => x.indice.valor === "104")).toMatchObject({ como: "sencillo" });
    expect(pi.find((x) => x.indice.valor === "160")).toMatchObject({ como: "sencillo", medidas: ["385/65R22.5"] });
  });

  it("uno que no usa nadie sale sin medidas", () => {
    expect(pi.find((x) => x.indice.valor === "121")).toMatchObject({ como: null, medidas: [] });
  });

  it("ordenados de menos a más carga", () => {
    expect(pi.map((x) => x.indice.valor)).toEqual(["102", "104", "121", "160"]);
  });
});

describe("por velocidad", () => {
  const pv = porVelocidad([
    { id: "v1", valor: "H", km_h: 210 }, { id: "v2", valor: "R", km_h: 170 }, { id: "v3", valor: "K", km_h: 110 },
  ], vista);

  it("ordenadas por km/h, no por letra", () => {
    expect(pv.map((x) => x.velocidad.valor)).toEqual(["K", "R", "H"]);
  });

  it("con sus medidas y sus modelos, aunque la combinación la escribiera en minúscula", () => {
    const r = pv.find((x) => x.velocidad.valor === "R")!;
    expect(r.medidas).toEqual(["195/70R15"]);
    expect(r.modelos).toEqual(["Hankook RA18", "Hankook RA58", "Michelin AGILIS 3"]);
  });
});

describe("del modelo", () => {
  it("sus combinaciones, y de ahí sus medidas y velocidades", () => {
    const m = delModelo("ra58", vista, refs);
    expect(m.combos.map((c) => c.id)).toEqual(["c1"]);
    expect(m.medidas).toEqual(["195/70R15"]);
    expect(m.velocidades).toEqual(["R"]);
  });

  it("un modelo sin combinaciones sale vacío", () => {
    expect(delModelo("nada", vista, refs)).toEqual({ combos: [], medidas: [], velocidades: [] });
  });
});

describe("el índice del neumático", () => {
  it("se parte y se junta sin perder nada", () => {
    expect(partirIndice("104/102")).toEqual({ simple: "104", doble: "102" });
    expect(partirIndice("158")).toEqual({ simple: "158", doble: "" });
    expect(partirIndice(null)).toEqual({ simple: "", doble: "" });
    expect(juntarIndice("104", "102")).toBe("104/102");
    expect(juntarIndice("158", "")).toBe("158");
    expect(juntarIndice("", "102")).toBe("");
  });
});
