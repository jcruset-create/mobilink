import { describe, it, expect } from "vitest";
import {
  cuadrosDelInventario, montajesDeCondicion, operacionesDeTipo, operacionesSePuedenFiltrar, presionesDeEstado,
  tablasDelInventario, tecnicosPorMetrica, vehiculosDeEstado,
} from "./cuadrosInformes";
import type {
  CeldaInventario, OperacionesInforme, PresionNeumatico, ProductividadTecnico, VehiculoFlota,
} from "../types/informes";

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

describe("inventario: las tablas salen de las celdas", () => {
  const c = (p: Partial<CeldaInventario>): CeldaInventario =>
    ({ estado: "montado", marca: "Hankook", modelo: "AH51", medida: "295/80R22.5", de_lote: false, rango: null, n: 1, ...p });
  const celdas = [
    c({ rango: "r8_10", n: 40 }),
    c({ rango: "r0_2", n: 3 }),
    c({ n: 7 }),                                             // montadas sin ninguna medición
    c({ de_lote: true, rango: "r4_6", n: 10 }),              // del histórico, y medidas
    c({ marca: "Insa", modelo: "K25", rango: "r2_4", n: 5 }),
    c({ estado: "almacen", marca: "Michelin", modelo: "X", medida: "315/80R22.5", n: 20 }),
    c({ estado: "descartado", marca: "—", modelo: "—", medida: "—", n: 2 }),
    c({ estado: "pendiente_clasificacion", marca: "Insa", modelo: "K25", n: 9 }),
  ];

  it("los cuadros cuentan todos los neumáticos, los del histórico también", () => {
    expect(cuadrosDelInventario(celdas)).toEqual({ total: 96, montado: 65, almacen: 20, reparacion: 0, descartado: 2 });
  });

  it("un estado sin cuadro cuenta en el total y en ningún otro", () => {
    const n = cuadrosDelInventario([c({ estado: "pendiente_reciclaje", n: 4 }), c({ estado: "total", n: 1 })]);
    expect(n).toEqual({ total: 5, montado: 0, almacen: 0, reparacion: 0, descartado: 0 });
  });

  it("sin filtro: las tablas por marca y por estado no cuentan las fichas del histórico", () => {
    const t = tablasDelInventario(celdas, null);
    expect(t.porMarca).toEqual([
      { etiqueta: "Hankook", total: 50 }, { etiqueta: "Michelin", total: 20 }, { etiqueta: "Insa", total: 14 }, { etiqueta: "—", total: 2 },
    ]);
    expect(t.porEstado.find((x) => x.etiqueta === "montado")?.total).toBe(55);
    expect(t.enElFiltro).toBe(96);
    expect(t.delHistorico).toBe(10);
  });

  it("la profundidad sí cuenta las del histórico, y solo las que tienen medida", () => {
    const t = tablasDelInventario(celdas, null);
    expect(t.profundidad).toEqual([
      { marca: "Hankook", r0_2: 3, r2_4: 0, r4_6: 10, r6_8: 0, r8_10: 40, r10: 0, total: 53 },
      { marca: "Insa", r0_2: 0, r2_4: 5, r4_6: 0, r6_8: 0, r8_10: 0, r10: 0, total: 5 },
    ]);
  });

  it("con un cuadro pulsado, todas las tablas se quedan en ese estado", () => {
    const t = tablasDelInventario(celdas, "almacen");
    expect(t.porMarca).toEqual([{ etiqueta: "Michelin", total: 20 }]);
    expect(t.porMedida).toEqual([{ etiqueta: "315/80R22.5", total: 20 }]);
    expect(t.porEstado).toEqual([{ etiqueta: "almacen", total: 20 }]);
    expect(t.marcaMedida).toEqual([{ marca: "Michelin", medida: "315/80R22.5", total: 20 }]);
    expect(t.profundidad).toEqual([]);
  });

  it("dice cuántas del filtro son del histórico: es lo que separa el cuadro de la tabla", () => {
    const t = tablasDelInventario(celdas, "montado");
    expect(t.enElFiltro).toBe(65);
    expect(t.delHistorico).toBe(10);
    expect(t.porEstado).toEqual([{ etiqueta: "montado", total: 55 }]);
    expect(t.enElFiltro - t.delHistorico).toBe(t.porEstado[0].total);
  });

  it("marca + medida no mezcla dos marcas que comparten medida", () => {
    const t = tablasDelInventario(celdas, "montado");
    expect(t.marcaMedida).toEqual([
      { marca: "Hankook", medida: "295/80R22.5", total: 50 }, { marca: "Insa", medida: "295/80R22.5", total: 5 },
    ]);
  });

  it("un estado sin neumáticos deja las tablas vacías, no un error", () => {
    const t = tablasDelInventario(celdas, "reparacion");
    expect(t.porMarca).toEqual([]);
    expect(t.enElFiltro).toBe(0);
  });
});

describe("operaciones: motivo y evolución de un tipo", () => {
  const data: OperacionesInforme = {
    total: 12,
    por_tipo: [{ tipo: "montaje", n: 7 }, { tipo: "reparacion", n: 5 }],
    por_motivo: [{ motivo: "desgaste", n: 8 }, { motivo: "pinchazo", n: 4 }],
    evolucion: [{ mes: "2026-09", n: 3 }, { mes: "2026-10", n: 4 }, { mes: "2026-11", n: 5 }],
    por_tipo_motivo: [
      { tipo: "montaje", motivo: "desgaste", n: 7 }, { tipo: "reparacion", motivo: "pinchazo", n: 4 }, { tipo: "reparacion", motivo: "desgaste", n: 1 },
    ],
    evolucion_tipo: [
      { mes: "2026-09", tipo: "montaje", n: 3 }, { mes: "2026-10", tipo: "montaje", n: 4 }, { mes: "2026-11", tipo: "reparacion", n: 5 },
    ],
  };

  it("sin tipo, lo de todas", () => {
    const r = operacionesDeTipo(data, null);
    expect(r.por_motivo).toBe(data.por_motivo);
    expect(r.evolucion).toBe(data.evolucion);
  });

  it("con un tipo, sus motivos, del que más al que menos", () => {
    expect(operacionesDeTipo(data, "reparacion").por_motivo).toEqual([{ motivo: "pinchazo", n: 4 }, { motivo: "desgaste", n: 1 }]);
  });

  it("los meses sin ninguna de ese tipo salen a cero, no desaparecen", () => {
    expect(operacionesDeTipo(data, "reparacion").evolucion).toEqual([
      { mes: "2026-09", n: 0 }, { mes: "2026-10", n: 0 }, { mes: "2026-11", n: 5 },
    ]);
  });

  it("un tipo sin operaciones deja todo a cero", () => {
    const r = operacionesDeTipo(data, "rotacion");
    expect(r.por_motivo).toEqual([]);
    expect(r.evolucion.every((e) => e.n === 0)).toBe(true);
  });

  it("si la base no manda el reparto, no se puede filtrar y se enseña lo de todas", () => {
    const vieja: OperacionesInforme = { total: 12, por_tipo: data.por_tipo, por_motivo: data.por_motivo, evolucion: data.evolucion };
    expect(operacionesSePuedenFiltrar(vieja)).toBe(false);
    expect(operacionesSePuedenFiltrar(data)).toBe(true);
    expect(operacionesDeTipo(vieja, "reparacion").por_motivo).toBe(vieja.por_motivo);
  });
});

describe("estado de flota: los vehículos de un semáforo", () => {
  const v = (matricula: string, estado: VehiculoFlota["estado"], prof_min: number | null): VehiculoFlota =>
    ({ vehiculo_id: matricula, matricula, numero_unidad: null, estado, prof_min, fecha_revision: prof_min == null ? null : "2026-11-10" });
  const lista = [
    v("CORRECTO1", "correcto", 9.2), v("REVISAR2", "revisar", 2.8), v("PENDIENTE", "pendiente", null),
    v("URGENTE", "urgente", 1.2), v("REVISAR1", "revisar", 2.1), v("SINPROF", "revisar", null), v("REVISAR0", "revisar", 2.1),
  ];
  const m = (e: Parameters<typeof vehiculosDeEstado>[1]) => vehiculosDeEstado(lista, e).map((x) => x.matricula);

  it("sin filtro, todos, con lo peor primero", () => {
    expect(m(null)).toEqual(["URGENTE", "REVISAR0", "REVISAR1", "REVISAR2", "SINPROF", "PENDIENTE", "CORRECTO1"]);
  });

  it("cada semáforo deja los suyos", () => {
    expect(m("urgente")).toEqual(["URGENTE"]);
    expect(m("pendiente")).toEqual(["PENDIENTE"]);
    expect(m("correcto")).toEqual(["CORRECTO1"]);
  });

  it("dentro del estado, la profundidad más baja delante, sin dato al final y a igualdad por matrícula", () => {
    expect(m("revisar")).toEqual(["REVISAR0", "REVISAR1", "REVISAR2", "SINPROF"]);
  });

  it("no desordena la lista que le pasan", () => {
    vehiculosDeEstado(lista, null);
    expect(lista[0].matricula).toBe("CORRECTO1");
  });
});
