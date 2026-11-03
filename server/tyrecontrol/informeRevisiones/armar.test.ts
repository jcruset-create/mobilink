import { describe, expect, it } from "vitest";
import {
  armarInforme, estadoRueda, mesDe,
  type MedicionFila, type OpcionesInforme, type RevisionFila,
} from "./armar.ts";

/**
 * Lo que se fija aquí:
 *
 *  · Que el informe del CLIENTE no lleve nombres de técnico ni códigos
 *    internos, y que los borradores no se cuelen. Un borrador es trabajo a
 *    medias; enseñarlo como revisión hecha es mentir por omisión.
 *  · Que cuando se deja algo fuera, el informe lo DICE. Un total que no
 *    cuadra y nadie sabe por qué es peor que un total más pequeño.
 *  · Que «bajo mínimo» se decide con el mínimo de ESA rueda, no con 1,6 fijo.
 */

const rev = (p: Partial<RevisionFila> & { id: string }): RevisionFila => ({
  fecha: "2026-03-10", matricula: "1234ABC", numero_unidad: null, km_vehiculo: null,
  estado: "completada", tecnico: null, tipo_revision: null, observaciones: null, ...p,
});

const med = (p: Partial<MedicionFila> & { revision_id: string }): MedicionFila => ({
  posicion: "Eje 1 izq", orden: 1, profundidad_mm: 8, presion_bar: 8.5,
  minimo_mm: 1.6, aviso_mm: 3, no_accesible: false, neumatico_ausente: false,
  marca: "Hankook", medida: "295/80R22.5", codigo_interno: "NT-1", ...p,
});

const op = (p: Partial<OpcionesInforme> = {}): OpcionesInforme => ({
  empresa: "e", desde: "2026-01-01", hasta: "2026-12-31",
  formato: "resumen", ambito: "interno", ...p,
});

describe("estadoRueda", () => {
  it("por debajo o igual al mínimo está bajo mínimo", () => {
    expect(estadoRueda(med({ revision_id: "r", profundidad_mm: 1.6 }))).toBe("bajo_minimo");
    expect(estadoRueda(med({ revision_id: "r", profundidad_mm: 1.5 }))).toBe("bajo_minimo");
  });

  it("el mínimo es el de ESA rueda, no un 1,6 fijo", () => {
    // Una medida con mínimo propio de 4 mm: 3 mm ya está por debajo.
    expect(estadoRueda(med({ revision_id: "r", profundidad_mm: 3, minimo_mm: 4, aviso_mm: 6 })))
      .toBe("bajo_minimo");
  });

  it("entre el mínimo y el aviso, avisa", () => {
    expect(estadoRueda(med({ revision_id: "r", profundidad_mm: 2.5 }))).toBe("aviso");
  });

  it("por encima del aviso, bien", () => {
    expect(estadoRueda(med({ revision_id: "r", profundidad_mm: 9 }))).toBe("ok");
  });

  it("un aviso por DEBAJO del mínimo no se inventa: manda el mínimo", () => {
    const e = estadoRueda(med({ revision_id: "r", profundidad_mm: 2, minimo_mm: 3, aviso_mm: 1 }));
    expect(e).toBe("bajo_minimo");
  });

  it("sin aviso configurado no hay estado de aviso", () => {
    expect(estadoRueda(med({ revision_id: "r", profundidad_mm: 2.5, aviso_mm: null }))).toBe("ok");
  });

  it("sin profundidad, no accesible o sin neumático: sin medir, nunca «bien»", () => {
    expect(estadoRueda(med({ revision_id: "r", profundidad_mm: null }))).toBe("sin_medir");
    expect(estadoRueda(med({ revision_id: "r", no_accesible: true }))).toBe("sin_medir");
    expect(estadoRueda(med({ revision_id: "r", neumatico_ausente: true }))).toBe("sin_medir");
  });

  it("sin mínimo configurado se usa 1,6, que es el legal", () => {
    expect(estadoRueda(med({ revision_id: "r", profundidad_mm: 1.6, minimo_mm: null, aviso_mm: null })))
      .toBe("bajo_minimo");
    expect(estadoRueda(med({ revision_id: "r", profundidad_mm: 1.7, minimo_mm: null, aviso_mm: null })))
      .toBe("ok");
  });
});

describe("mesDe", () => {
  it("saca el mes de una fecha ISO", () => {
    expect(mesDe("2026-03-10")).toBe("2026-03");
  });
});

describe("armarInforme · lo que ve el cliente", () => {
  const revisiones = [
    rev({ id: "a", tecnico: "Pep", estado: "completada" }),
    rev({ id: "b", tecnico: "Pep", estado: "borrador", fecha: "2026-04-01" }),
  ];
  const mediciones = [med({ revision_id: "a" }), med({ revision_id: "b" })];

  it("no incluye borradores, y lo dice en vez de descuadrar el total", () => {
    const d = armarInforme(revisiones, mediciones, op({ ambito: "cliente" }));
    expect(d.resumen.revisiones).toBe(1);
    expect(d.advertencias.join(" ")).toMatch(/sin terminar/i);
  });

  it("el interno SÍ los incluye y los cuenta aparte", () => {
    const d = armarInforme(revisiones, mediciones, op({ ambito: "interno" }));
    expect(d.resumen.revisiones).toBe(2);
    expect(d.resumen.borradores).toBe(1);
    expect(d.advertencias).toEqual([]);
  });

  it("no lleva el nombre del técnico", () => {
    const d = armarInforme(revisiones, mediciones, op({ ambito: "cliente" }));
    expect(d.revisiones[0].tecnico).toBeNull();
  });

  it("el interno sí lo lleva", () => {
    const d = armarInforme(revisiones, mediciones, op({ ambito: "interno" }));
    expect(d.revisiones[0].tecnico).toBe("Pep");
  });

  it("no lleva el código interno del neumático, pero sí marca y medida", () => {
    const d = armarInforme(revisiones, mediciones, op({ ambito: "cliente" }));
    expect(d.revisiones[0].ruedas[0].detalle).toBe("Hankook · 295/80R22.5");
    const i = armarInforme(revisiones, mediciones, op({ ambito: "interno" }));
    expect(i.revisiones[0].ruedas[0].detalle).toContain("NT-1");
  });
});

describe("armarInforme · recuentos", () => {
  const revisiones = [rev({ id: "a" })];
  const mediciones = [
    med({ revision_id: "a", posicion: "P1", orden: 1, profundidad_mm: 9 }),
    med({ revision_id: "a", posicion: "P2", orden: 2, profundidad_mm: 2.5 }),
    med({ revision_id: "a", posicion: "P3", orden: 3, profundidad_mm: 1.2 }),
    med({ revision_id: "a", posicion: "P4", orden: 4, profundidad_mm: null }),
  ];

  it("cuenta por estado y no mete las no medidas en las medidas", () => {
    const d = armarInforme(revisiones, mediciones, op());
    expect(d.resumen).toMatchObject({ mediciones: 3, bajoMinimo: 1, enAviso: 1, sinMedir: 1 });
    expect(d.revisiones[0].medidas).toBe(3);
  });

  it("las ruedas salen en el orden de revisión del plano", () => {
    const d = armarInforme(revisiones, [
      med({ revision_id: "a", posicion: "P3", orden: 3 }),
      med({ revision_id: "a", posicion: "P1", orden: 1 }),
      med({ revision_id: "a", posicion: "P2", orden: 2 }),
    ], op());
    expect(d.revisiones[0].ruedas.map((r) => r.posicion)).toEqual(["P1", "P2", "P3"]);
  });

  it("las revisiones salen por fecha, y la matrícula desempata", () => {
    const d = armarInforme([
      rev({ id: "b", fecha: "2026-05-01", matricula: "9999ZZZ" }),
      rev({ id: "c", fecha: "2026-05-01", matricula: "1111AAA" }),
      rev({ id: "a", fecha: "2026-01-01" }),
    ], [], op());
    expect(d.revisiones.map((r) => r.matricula)).toEqual(["1234ABC", "1111AAA", "9999ZZZ"]);
  });

  it("una revisión sin mediciones no rompe nada y cuenta como revisión", () => {
    const d = armarInforme([rev({ id: "z" })], [], op());
    expect(d.resumen.revisiones).toBe(1);
    expect(d.resumen.mediciones).toBe(0);
    expect(d.advertencias.join(" ")).toMatch(/mediciones de neum/i);
  });

  it("un periodo sin revisiones no avisa de nada: no hay nada que explicar", () => {
    const d = armarInforme([], [], op());
    expect(d.resumen.revisiones).toBe(0);
    expect(d.advertencias).toEqual([]);
  });
});

describe("armarInforme · los meses", () => {
  it("agrupa por mes y cuenta vehículos distintos, no revisiones", () => {
    const d = armarInforme([
      rev({ id: "a", fecha: "2026-03-02", matricula: "AAA" }),
      rev({ id: "b", fecha: "2026-03-20", matricula: "AAA" }),
      rev({ id: "c", fecha: "2026-04-01", matricula: "BBB" }),
    ], [], op());
    expect(d.meses).toEqual([
      { mes: "2026-03", revisiones: 2, vehiculos: 1, bajoMinimo: 0 },
      { mes: "2026-04", revisiones: 1, vehiculos: 1, bajoMinimo: 0 },
    ]);
  });

  it("los meses del cliente no cuentan los borradores", () => {
    const d = armarInforme([
      rev({ id: "a", fecha: "2026-03-02" }),
      rev({ id: "b", fecha: "2026-03-20", estado: "borrador" }),
    ], [], op({ ambito: "cliente" }));
    expect(d.meses).toEqual([{ mes: "2026-03", revisiones: 1, vehiculos: 1, bajoMinimo: 0 }]);
  });
});

describe("armarInforme · formatos", () => {
  const revisiones = [
    rev({ id: "a", matricula: "1111AAA" }),
    rev({ id: "b", matricula: "1111AAA", fecha: "2026-06-01" }),
    rev({ id: "c", matricula: "2222BBB", fecha: "2026-07-01" }),
  ];

  it("resumen y detalle traen el listado plano y ningún vehículo agrupado", () => {
    for (const formato of ["resumen", "detalle"] as const) {
      const d = armarInforme(revisiones, [], op({ formato }));
      expect(d.revisiones).toHaveLength(3);
      expect(d.vehiculos).toEqual([]);
    }
  });

  it("el formato por vehículo agrupa y NO duplica el listado plano", () => {
    const d = armarInforme(revisiones, [], op({ formato: "vehiculo" }));
    expect(d.revisiones).toEqual([]);
    expect(d.vehiculos.map((v) => v.matricula)).toEqual(["1111AAA", "2222BBB"]);
    expect(d.vehiculos[0].revisiones).toHaveLength(2);
  });

  it("los vehículos van por matrícula, leyéndola como una persona", () => {
    const d = armarInforme([
      rev({ id: "a", matricula: "9986CDL" }),
      rev({ id: "b", matricula: "1170NNC" }),
    ], [], op({ formato: "vehiculo" }));
    expect(d.vehiculos.map((v) => v.matricula)).toEqual(["1170NNC", "9986CDL"]);
  });

  it("cada vehículo suma sus ruedas bajo mínimo", () => {
    const d = armarInforme(revisiones, [
      med({ revision_id: "a", profundidad_mm: 1 }),
      med({ revision_id: "b", profundidad_mm: 1, posicion: "P2" }),
    ], op({ formato: "vehiculo" }));
    expect(d.vehiculos.find((v) => v.matricula === "1111AAA")!.bajoMinimo).toBe(2);
  });
});
