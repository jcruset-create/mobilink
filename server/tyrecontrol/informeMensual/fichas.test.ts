import { describe, expect, it } from "vitest";

import {
  TITULO_BANDA, avisosDeListados, filaDeVehiculo, filasDelMes, listaPlanificacion,
  listadosPorBanda, type VehiculoFicha,
} from "./fichas.ts";
import { BANDAS, type RuedaCompleta } from "./matrices.ts";
import { periodoDeMes } from "./armar.ts";

const POS = [1, 2, 3, 4, 5, 6];
const OCT = periodoDeMes("2026-10");

const veh = (id: string, o: Partial<VehiculoFicha> = {}): VehiculoFicha =>
  ({ id, matricula: `M-${id}`, numeroUnidad: id, base: "B.REUS", ...o });

const rueda = (posicion: number, mm: number | null, o: Partial<RuedaCompleta> = {}): RuedaCompleta => ({
  vehiculoId: "v1", posicion, profundidadMm: mm, fecha: "2026-10-10",
  revisionId: "r1", neumaticoId: "n1", estadoVisual: null,
  marca: "HANKOOK", modelo: "AH31", medida: "295/80R22.5",
  reesculturada: false, recauchutada: false, rayada: false, condicionConocida: true,
  ...o,
});

describe("filaDeVehiculo()", () => {
  /*
   * El criterio del original, comprobado contra el PDF: el bus 564 tiene
   * 12-12-8-8-4-7 y aparece en «hasta 4 mm» por ese 4. Ni la media ni la de
   * delante: la peor. Un autobús con cinco ruedas nuevas y una por debajo del
   * límite es un autobús que no sale.
   */
  it("la banda es la de la PEOR rueda, no la media", () => {
    const f = filaDeVehiculo(veh("564"), [
      rueda(1, 12), rueda(2, 12), rueda(3, 8), rueda(4, 8), rueda(5, 4), rueda(6, 7),
    ], POS);
    expect(f.peor).toBe(4);
    expect(f.banda).toBe(BANDAS[0]);
  });

  it("el otro caso del original: 9-11-8-8-8-7 cae en «>6 mm<8 mm»", () => {
    const f = filaDeVehiculo(veh("535"), [
      rueda(1, 9), rueda(2, 11), rueda(3, 8), rueda(4, 8), rueda(5, 8), rueda(6, 7),
    ], POS);
    expect(f.peor).toBe(7);
    expect(TITULO_BANDA[f.banda!]).toBe(">6 mm<8 mm");
  });

  // Correr los números a la izquierda haría parecer medida una rueda que no
  // se midió, y encima en la posición equivocada.
  it("una posición sin medir deja su hueco, no corre las demás", () => {
    const f = filaDeVehiculo(veh("v1"), [rueda(1, 9), rueda(4, 7)], POS);
    expect(f.profundidades).toEqual([9, null, null, 7, null, null]);
  });

  it("sin ninguna profundidad no se inventa una banda", () => {
    const f = filaDeVehiculo(veh("v1"), [rueda(1, null), rueda(2, null)], POS);
    expect(f.peor).toBeNull();
    expect(f.banda).toBeNull();
  });

  it("la medida es la que más ruedas llevan", () => {
    const f = filaDeVehiculo(veh("v1"), [
      rueda(1, 9, { medida: "315/80R22.5" }),
      rueda(2, 9), rueda(3, 9),
    ], POS);
    expect(f.medida).toBe("295/80R22.5");
  });

  it("y a igualdad desempata estable, no al azar", () => {
    const a = filaDeVehiculo(veh("v1"), [
      rueda(1, 9, { medida: "315/80R22.5" }), rueda(2, 9, { medida: "295/80R22.5" }),
    ], POS);
    const b = filaDeVehiculo(veh("v1"), [
      rueda(1, 9, { medida: "295/80R22.5" }), rueda(2, 9, { medida: "315/80R22.5" }),
    ], POS);
    expect(a.medida).toBe(b.medida);
  });

  it("la fecha es la de la revisión más reciente de sus ruedas", () => {
    const f = filaDeVehiculo(veh("v1"), [
      rueda(1, 9, { fecha: "2026-10-02" }), rueda(2, 9, { fecha: "2026-10-28" }),
    ], POS);
    expect(f.ultimaRevision).toBe("2026-10-28");
  });

  // Son columnas de papel: el taller escribe encima. Inventarles un origen
  // llenaría de datos un hueco que existe para escribir a mano.
  it("observaciones y PTE. REPARAR van en blanco, a propósito", () => {
    const f = filaDeVehiculo(veh("v1"), [rueda(1, 9)], POS);
    expect(f.observaciones).toBe("");
    expect(f.pteReparar).toBe("");
  });
});

describe("filasDelMes()", () => {
  const ruedas = [
    rueda(1, 9, { vehiculoId: "a" }), rueda(2, 3, { vehiculoId: "a" }),
    rueda(1, 11, { vehiculoId: "b" }),
  ];

  it("una línea por vehículo con ruedas revisadas", () => {
    const f = filasDelMes([veh("a"), veh("b")], ruedas, POS);
    expect(f.map((x) => x.vehiculoId)).toEqual(["a", "b"]);
  });

  it("un vehículo sin ninguna rueda del mes no tiene línea", () => {
    const f = filasDelMes([veh("a"), veh("b"), veh("c")], ruedas, POS);
    expect(f.map((x) => x.vehiculoId)).not.toContain("c");
  });

  it("agrupa bien aunque las ruedas lleguen mezcladas", () => {
    const mezcladas = [ruedas[2], ruedas[0], ruedas[1]];
    const f = filasDelMes([veh("a"), veh("b")], mezcladas, POS);
    expect(f.find((x) => x.vehiculoId === "a")!.peor).toBe(3);
  });
});

describe("listadosPorBanda()", () => {
  const filas = () => filasDelMes(
    [veh("10"), veh("20"), veh("30")],
    [
      rueda(1, 3, { vehiculoId: "10" }),
      rueda(1, 7, { vehiculoId: "20" }),
      rueda(1, 2, { vehiculoId: "30" }),
    ],
    POS,
  );

  // Un listado que no aparece se lee como que no se ha mirado; uno vacío dice
  // que no hay ninguno, que es una noticia distinta y buena.
  it("las seis bandas salen siempre, incluso vacías", () => {
    const l = listadosPorBanda(filas());
    expect(l).toHaveLength(6);
    expect(l.map((x) => x.titulo)).toEqual([
      "hasta 4 mm", ">4 mm<6 mm", ">6 mm<8 mm", ">8 mm<10 mm", ">10 mm<12 mm", ">12 mm",
    ]);
    expect(l[3].filas).toEqual([]);
  });

  it("dentro de cada banda, el peor primero: es el orden de bajar al patio", () => {
    const l = listadosPorBanda(filas());
    expect(l[0].filas.map((f) => f.numeroUnidad)).toEqual(["30", "10"]);
  });

  /*
   * Los seis listados son una PARTICIÓN. Si un autobús saliera en dos, el
   * jefe de taller lo contaría dos veces al planificar la semana.
   */
  it("cada vehículo sale en una sola banda", () => {
    const l = listadosPorBanda(filas());
    const ids = l.flatMap((x) => x.filas.map((f) => f.vehiculoId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
  });

  it("un vehículo sin profundidad no entra en ningún listado", () => {
    const f = filasDelMes([veh("x")], [rueda(1, null, { vehiculoId: "x" })], POS);
    expect(listadosPorBanda(f).every((l) => l.filas.length === 0)).toBe(true);
  });
});

describe("listaPlanificacion()", () => {
  const filas = () => filasDelMes(
    [veh("200"), veh("30"), veh("100")],
    [
      rueda(1, 9, { vehiculoId: "200" }),
      rueda(1, 9, { vehiculoId: "30" }),
      rueda(1, 9, { vehiculoId: "100" }),
    ],
    POS,
  );

  // El informe de diciembre titula «LISTA PLANIFICACION ENERO».
  it("planifica el mes SIGUIENTE al del informe", () => {
    const p = listaPlanificacion(filas(), periodoDeMes("2023-12"), 3);
    expect(p.mes).toBe("2024-01");
    expect(p.etiqueta).toBe("ENERO 2024");
  });

  it("y cruza el año sin perderse", () => {
    expect(listaPlanificacion([], OCT, 0).etiqueta).toBe("NOVIEMBRE 2026");
  });

  // Esta hoja se usa para buscar un autobús concreto; los listados por banda
  // ya están ordenados por lo que corre.
  it("va por número de unidad, y con orden numérico de verdad", () => {
    const p = listaPlanificacion(filas(), OCT, 3);
    expect(p.filas.map((f) => f.numeroUnidad)).toEqual(["30", "100", "200"]);
  });

  it("cuenta los de la flota que no se han revisado", () => {
    expect(listaPlanificacion(filas(), OCT, 717).sinRevisar).toBe(714);
  });

  it("y no da un negativo si la cuenta no cuadra", () => {
    expect(listaPlanificacion(filas(), OCT, 1).sinRevisar).toBe(0);
  });
});

describe("avisosDeListados()", () => {
  it("dice cuántos se revisaron sin apuntar profundidad", () => {
    const f = filasDelMes([veh("x"), veh("y")], [
      rueda(1, null, { vehiculoId: "x" }), rueda(1, 9, { vehiculoId: "y" }),
    ], POS);
    const p = listaPlanificacion(f, OCT, 2);
    const a = avisosDeListados(listadosPorBanda(f), p);
    expect(a.some((t) => t.includes("sin apuntar ninguna profundidad"))).toBe(true);
  });

  it("y cuántos de la flota no se han revisado en el mes", () => {
    const f = filasDelMes([veh("y")], [rueda(1, 9, { vehiculoId: "y" })], POS);
    const p = listaPlanificacion(f, OCT, 717);
    expect(avisosDeListados(listadosPorBanda(f), p).some((t) => t.includes("716"))).toBe(true);
  });

  // La partición tiene que cuadrar, y si algún día deja de hacerlo el informe
  // lo dice en vez de enseñar seis listas que no suman.
  it("avisa si los seis listados no suman los que tienen banda", () => {
    const f = filasDelMes([veh("y")], [rueda(1, 9, { vehiculoId: "y" })], POS);
    const p = listaPlanificacion(f, OCT, 1);
    expect(avisosDeListados([], p).some((t) => t.includes("Descuadre"))).toBe(true);
    expect(avisosDeListados(listadosPorBanda(f), p).some((t) => t.includes("Descuadre"))).toBe(false);
  });
});
