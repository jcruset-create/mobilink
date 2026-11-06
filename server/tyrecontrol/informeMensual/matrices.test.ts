import { describe, expect, it } from "vitest";

import {
  BANDAS, COLUMNAS_MM, SIN_DATO, avisosDeCondicion, bandaDe, completar, esRayada,
  condicionPorPosicion, llantaDe, marcaPorPosicion, matriz, medidaPorMarca,
  medidaPorMilimetro, medidaPorPosicion, milimetroDe, profundidadPorPosicion,
  normalizarMarca, type NeumaticoRef, type RuedaCompleta,
} from "./matrices.ts";
import type { RuedaDelMes } from "./armar.ts";

const rueda = (o: Partial<RuedaCompleta> = {}): RuedaCompleta => ({
  vehiculoId: "v1", posicion: 1, profundidadMm: 8, fecha: "2026-10-10",
  revisionId: "r1", neumaticoId: "n1", estadoVisual: null,
  marca: "HANKOOK", modelo: "AH31", medida: "295/80R22.5",
  reesculturada: false, recauchutada: false, rayada: false, condicionConocida: true,
  ...o,
});

describe("matriz()", () => {
  const items = [
    { f: "A", c: "x" }, { f: "A", c: "x" }, { f: "A", c: "y" },
    { f: "B", c: "y" },
  ];
  const m = () => matriz(items, (i) => i.f, (i) => i.c, ["x", "y", "z"]);

  it("cuenta en la celda que toca", () => {
    expect(m().filas.find((f) => f.etiqueta === "A")!.celdas).toEqual([2, 1, 0]);
    expect(m().filas.find((f) => f.etiqueta === "B")!.celdas).toEqual([0, 1, 0]);
  });

  it("da totales por fila, por columna y general", () => {
    const r = m();
    expect(r.filas.map((f) => f.total)).toEqual([3, 1]);
    expect(r.totalPorColumna).toEqual([2, 2, 0]);
    expect(r.total).toBe(4);
  });

  it("y porcentajes con dos decimales, sobre el total de la matriz", () => {
    expect(m().filas.map((f) => f.pct)).toEqual([75, 25]);
  });

  // Una columna vacía es información: esa posición no se midió. Deducir las
  // columnas de los datos la haría desaparecer y descolocaría las de al lado.
  it("mantiene las columnas que se le dan, aunque estén vacías", () => {
    expect(m().columnas).toEqual(["x", "y", "z"]);
  });

  it("ordena las filas por total descendente, como el original", () => {
    expect(m().filas.map((f) => f.etiqueta)).toEqual(["A", "B"]);
  });

  it("y a igualdad de total, por etiqueta: dos ejecuciones dan lo mismo", () => {
    const empate = [{ f: "Z", c: "x" }, { f: "A", c: "x" }];
    const uno = matriz(empate, (i) => i.f, (i) => i.c, ["x"]);
    const dos = matriz([...empate].reverse(), (i) => i.f, (i) => i.c, ["x"]);
    expect(uno.filas.map((f) => f.etiqueta)).toEqual(["A", "Z"]);
    expect(uno).toEqual(dos);
  });

  it("descarta lo que cae en una columna que no existe, sin romperse", () => {
    const r = matriz([{ f: "A", c: "fuera" }], (i) => i.f, (i) => i.c, ["x"]);
    expect(r.total).toBe(0);
  });

  it("con orden fijo, respeta ese orden y conserva las filas vacías", () => {
    const r = matriz([{ f: "media", c: "x" }], (i) => i.f, (i) => i.c, ["x"],
                     ["baja", "media", "alta"]);
    expect(r.filas.map((f) => f.etiqueta)).toEqual(["baja", "media", "alta"]);
    expect(r.filas[0].total).toBe(0);
  });

  it("sin nada que contar, una matriz vacía y no una división por cero", () => {
    const r = matriz([], (i: any) => i.f, (i: any) => i.c, ["x"]);
    expect(r).toEqual({ columnas: ["x"], filas: [], totalPorColumna: [0], total: 0 });
  });
});

describe("bandaDe()", () => {
  // Los cortes del original: «mayor de 4 mm y hasta 6 mm». Un 4,0 clavado cae
  // en la banda que obliga a cambiar, que es la lectura prudente.
  it("el límite va a la banda de abajo", () => {
    expect(bandaDe(4)).toBe(BANDAS[0]);
    expect(bandaDe(4.1)).toBe(BANDAS[1]);
    expect(bandaDe(6)).toBe(BANDAS[1]);
    expect(bandaDe(6.1)).toBe(BANDAS[2]);
    expect(bandaDe(12)).toBe(BANDAS[4]);
    expect(bandaDe(12.1)).toBe(BANDAS[5]);
  });

  it("las seis bandas, de menos a más", () => {
    expect([1, 5, 7, 9, 11, 20].map(bandaDe)).toEqual([...BANDAS]);
  });

  it("sin medida no hay banda, y no se inventa la primera", () => {
    expect(bandaDe(null)).toBeNull();
    expect(bandaDe(undefined)).toBeNull();
    expect(bandaDe(Number.NaN)).toBeNull();
  });
});

describe("llantaDe() y milimetroDe()", () => {
  it("agrupa las llantas como el original", () => {
    expect(llantaDe("295/80R22.5")).toBe('Llanta 22,5"');
    expect(llantaDe("315/80R22.5")).toBe('Llanta 22,5"');
    expect(llantaDe("305/70R19.5")).toBe('Llanta 17,5"-19,5"');
    expect(llantaDe("265/70R17.5")).toBe('Llanta 17,5"-19,5"');
    expect(llantaDe("225/75R16")).toBe('Llanta 16"');
  });

  it("lo que no sabe leer no lo mete donde no es", () => {
    expect(llantaDe(SIN_DATO)).toBe("Otras");
    expect(llantaDe("")).toBe("Otras");
  });

  // Redondear hacia arriba pondría una goma de 3,9 mm en la columna de 4,
  // que es justo el límite legal.
  it("los milímetros se redondean hacia abajo", () => {
    expect(milimetroDe(8.7)).toBe("8mm");
    expect(milimetroDe(3.9)).toBe("3mm");
    expect(milimetroDe(8)).toBe("8mm");
  });

  it("fuera de la rejilla de 17 a 2, ninguna columna", () => {
    expect(milimetroDe(1.5)).toBeNull();
    expect(milimetroDe(18)).toBeNull();
    expect(milimetroDe(null)).toBeNull();
  });

  it("las columnas van de 17 a 2, como el original", () => {
    expect(COLUMNAS_MM[0]).toBe("17mm");
    expect(COLUMNAS_MM.at(-1)).toBe("2mm");
    expect(COLUMNAS_MM).toHaveLength(16);
  });
});

describe("completar()", () => {
  const neumaticos = new Map<string, NeumaticoRef>([
    ["n1", { id: "n1", marca: "HANKOOK", modelo: "AH31", medida: "295/80 R22,5", reesculturado: false }],
    ["n2", { id: "n2", marca: "MICHELIN", modelo: "X", medida: "315/80R22.5", reesculturado: true }],
  ]);
  const base = (o: Partial<RuedaDelMes> = {}): RuedaDelMes => ({
    vehiculoId: "v1", posicion: 1, profundidadMm: 8, fecha: "2026-10-10",
    revisionId: "r1", neumaticoId: "n1", estadoVisual: null, ...o,
  });

  it("junta la rueda con su neumático", () => {
    const [r] = completar([base()], neumaticos, new Map());
    expect(r).toMatchObject({ marca: "HANKOOK", modelo: "AH31", medida: "295/80R22.5" });
  });

  // «295/80 R22,5» y «295/80R22.5» son la misma medida escrita de dos
  // maneras; sin canonizar saldrían dos filas con la mitad cada una.
  it("canoniza la medida, que viene escrita de varias formas", () => {
    const [r] = completar([base()], neumaticos, new Map());
    expect(r.medida).toBe("295/80R22.5");
  });

  it("marca la reesculturada y la recauchutada", () => {
    const rs = completar(
      [base({ neumaticoId: "n2" }), base({ neumaticoId: "n1", posicion: 2 })],
      neumaticos, new Map([["n1", "recauchutada"]]),
    );
    expect(rs[0].reesculturada).toBe(true);
    expect(rs[1].recauchutada).toBe(true);
  });

  it("y distingue «no es recauchutada» de «no se sabe»", () => {
    const rs = completar(
      [base({ neumaticoId: "n1" }), base({ neumaticoId: "n2", posicion: 2 })],
      neumaticos, new Map([["n1", "nueva"]]),
    );
    expect(rs[0]).toMatchObject({ recauchutada: false, condicionConocida: true });
    expect(rs[1]).toMatchObject({ recauchutada: false, condicionConocida: false });
  });

  // Tirarla descuadraría el total contra los recuentos de la cabecera.
  it("una rueda sin neumático conocido NO se pierde", () => {
    const rs = completar([base({ neumaticoId: null })], neumaticos, new Map());
    expect(rs).toHaveLength(1);
    expect(rs[0].marca).toBe(SIN_DATO);
    expect(rs[0].medida).toBe(SIN_DATO);
  });
});

describe("normalizarMarca()", () => {
  // En la base conviven «Hankook» y «HANKOOK»: sin esto saldrían dos filas
  // con la mitad del recuento cada una.
  it("agrupa la misma marca escrita de varias maneras", () => {
    expect(normalizarMarca("Hankook")).toBe("HANKOOK");
    expect(normalizarMarca("  hankook ")).toBe("HANKOOK");
    expect(normalizarMarca("HANKOOK")).toBe("HANKOOK");
  });

  it("sin marca, «(sin dato)» y no una celda muda", () => {
    expect(normalizarMarca(null)).toBe(SIN_DATO);
    expect(normalizarMarca("   ")).toBe(SIN_DATO);
  });

  // Unificar «Insa» con «INSATURBO» es una decisión sobre el catálogo, y
  // tomarla aquí la escondería donde nadie la va a buscar.
  it("pero NO unifica marcas distintas que podrían ser la misma", () => {
    expect(normalizarMarca("Insa")).not.toBe(normalizarMarca("Insaturbo"));
  });
});

describe("esRayada()", () => {
  it("cuenta el daño, no el desgaste irregular", () => {
    expect(esRayada("dano_lateral")).toBe(true);
    expect(esRayada("corte")).toBe(true);
    // Desgaste irregular es otra cosa: la goma se come por un lado. Meterla
    // aquí inflaría la fila con un problema que no es el que nombra.
    expect(esRayada("desgaste_irregular")).toBe(false);
    expect(esRayada("correcto")).toBe(false);
    expect(esRayada(null)).toBe(false);
  });
});

describe("las rejillas por posición", () => {
  const posiciones = [1, 2, 3];
  const ruedas = [
    rueda({ posicion: 1, marca: "HANKOOK", profundidadMm: 3 }),
    rueda({ posicion: 1, marca: "HANKOOK", vehiculoId: "v2", profundidadMm: 9 }),
    rueda({ posicion: 2, marca: "MICHELIN", profundidadMm: 13, medida: "315/80R22.5" }),
  ];

  it("marca por posición", () => {
    const m = marcaPorPosicion(ruedas, posiciones);
    expect(m.columnas).toEqual(["Posicion 1", "Posicion 2", "Posicion 3"]);
    expect(m.filas.find((f) => f.etiqueta === "HANKOOK")!.celdas).toEqual([2, 0, 0]);
    expect(m.total).toBe(3);
  });

  it("medida por posición", () => {
    const m = medidaPorPosicion(ruedas, posiciones);
    expect(m.filas.map((f) => f.etiqueta)).toEqual(["295/80R22.5", "315/80R22.5"]);
  });

  it("profundidad por posición, con las seis bandas siempre", () => {
    const m = profundidadPorPosicion(ruedas, posiciones);
    expect(m.filas).toHaveLength(6);
    expect(m.filas[0].etiqueta).toBe(BANDAS[0]);
    expect(m.filas[0].celdas).toEqual([1, 0, 0]);
    expect(m.filas[5].celdas).toEqual([0, 1, 0]);
  });

  it("una rueda sin profundidad no cae en ninguna banda", () => {
    const m = profundidadPorPosicion([rueda({ profundidadMm: null })], posiciones);
    expect(m.total).toBe(0);
    expect(m.filas).toHaveLength(6);
  });
});

describe("condicionPorPosicion()", () => {
  it("las tres filas salen siempre, aunque estén a cero", () => {
    const m = condicionPorPosicion([rueda()], [1]);
    expect(m.filas.map((f) => f.etiqueta)).toEqual(["RAYADAS", "RECAUCHUTADAS", "REESCULTURADAS"]);
    expect(m.total).toBe(0);
  });

  /*
   * Una rueda puede ser varias cosas a la vez, y entonces suma en varias
   * filas. Por eso el total de esta matriz NO es el número de ruedas: es el
   * de marcas puestas, y mezclar las dos cosas sería invitar a sumar
   * columnas que no se pueden sumar.
   */
  it("una rueda recauchutada Y rayada cuenta en las dos filas", () => {
    const m = condicionPorPosicion([rueda({ rayada: true, recauchutada: true })], [1]);
    expect(m.filas[0].celdas).toEqual([1]);
    expect(m.filas[1].celdas).toEqual([1]);
    expect(m.total, "dos marcas sobre una sola rueda").toBe(2);
  });
});

describe("las tablas grandes", () => {
  it("medida por milímetro reparte en las columnas de mm", () => {
    const m = medidaPorMilimetro([
      rueda({ profundidadMm: 8.7 }), rueda({ profundidadMm: 8.1, vehiculoId: "v2" }),
      rueda({ profundidadMm: 12.4, medida: "315/80R22.5" }),
    ]);
    const f = m.filas.find((x) => x.etiqueta === "295/80R22.5")!;
    expect(f.celdas[COLUMNAS_MM.indexOf("8mm")]).toBe(2);
    expect(m.filas.find((x) => x.etiqueta === "315/80R22.5")!
      .celdas[COLUMNAS_MM.indexOf("12mm")]).toBe(1);
  });

  it("medida por marca, con una columna por marca", () => {
    const m = medidaPorMarca([
      rueda({ marca: "HANKOOK" }),
      rueda({ marca: "MICHELIN", medida: "315/80R22.5", vehiculoId: "v2" }),
    ]);
    expect(m.columnas).toEqual(["HANKOOK", "MICHELIN"]);
    expect(m.filas.find((f) => f.etiqueta === "295/80R22.5")!.celdas).toEqual([1, 0]);
  });
});

describe("avisosDeCondicion()", () => {
  it("dice de cuántas ruedas no consta la condición de la goma", () => {
    const rs = [rueda({ condicionConocida: false }), rueda({ vehiculoId: "v2" })];
    expect(avisosDeCondicion(rs).some((t) => t.includes("De 1 de las 2 ruedas"))).toBe(true);
  });

  // Un cero sin explicación se lee como «no hay ninguna rayada».
  it("explica que el cero de rayadas significa «no se apunta», no «no hay»", () => {
    const a = avisosDeCondicion([rueda()]);
    expect(a.some((t) => t.includes("«no se apunta»"))).toBe(true);
  });

  it("y si alguna consta como rayada, deja de decirlo", () => {
    const a = avisosDeCondicion([rueda({ rayada: true })]);
    expect(a.some((t) => t.includes("«no se apunta»"))).toBe(false);
  });

  it("cuenta las ruedas sin neumático y las que se midieron sin profundidad", () => {
    const rs = [rueda({ marca: SIN_DATO }), rueda({ profundidadMm: null, vehiculoId: "v2" })];
    const a = avisosDeCondicion(rs);
    expect(a.some((t) => t.includes("no tienen neumático identificado"))).toBe(true);
    expect(a.some((t) => t.includes("sin apuntar la profundidad"))).toBe(true);
  });

  it("avisa de las profundidades que se salen de la rejilla de milímetros", () => {
    const a = avisosDeCondicion([rueda({ profundidadMm: 19 })]);
    expect(a.some((t) => t.includes("fuera de la rejilla de 17 a 2 mm"))).toBe(true);
  });

  it("sin ruedas, ningún aviso que no venga a cuento", () => {
    expect(avisosDeCondicion([])).toEqual([]);
  });
});
