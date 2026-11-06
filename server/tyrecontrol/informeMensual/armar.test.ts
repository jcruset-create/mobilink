import { describe, expect, it } from "vitest";

import {
  MesInvalido, avisosDelMes, enPeriodo, neumaticosRevisados, periodoDeMes,
  recuentos, revisionCuenta, ruedasDelMes,
  type MedicionRef, type RevisionRef, type VehiculoRef,
} from "./armar.ts";

const OCT = periodoDeMes("2026-10");

const veh = (id: string, o: Partial<VehiculoRef> = {}): VehiculoRef => ({
  id, matricula: `M-${id}`, numeroUnidad: id, activo: true,
  tipoId: "autobus", baseId: "reus", base: "B.REUS", ...o,
});

const rev = (id: string, vehiculoId: string, fecha: string, estado = "completada"): RevisionRef =>
  ({ id, vehiculoId, fecha, estado });

const med = (revisionId: string, vehiculoId: string, posicion: number | null,
             o: Partial<MedicionRef> = {}): MedicionRef =>
  ({ revisionId, vehiculoId, posicion, profundidadMm: 8, ausente: false, ...o });

describe("periodoDeMes()", () => {
  it("da los dos extremos del mes, inclusive", () => {
    expect(periodoDeMes("2026-10")).toEqual({
      mes: "2026-10", desde: "2026-10-01", hasta: "2026-10-31", etiqueta: "OCTUBRE 2026",
    });
  });

  it("acierta con febrero, y con el bisiesto", () => {
    expect(periodoDeMes("2026-02").hasta).toBe("2026-02-28");
    expect(periodoDeMes("2024-02").hasta).toBe("2024-02-29");
  });

  it("el título va en castellano y en mayúsculas, como el original", () => {
    expect(periodoDeMes("2023-12").etiqueta).toBe("DICIEMBRE 2023");
    expect(periodoDeMes("2026-01").etiqueta).toBe("ENERO 2026");
  });

  it("no se inventa un mes cuando le dan basura", () => {
    for (const malo of ["", "2026", "2026-13", "2026-00", "octubre", "2026-1", null as any]) {
      expect(() => periodoDeMes(malo), `«${malo}» debería rechazarse`).toThrow(MesInvalido);
    }
  });
});

describe("enPeriodo()", () => {
  it("incluye el primer día y el último", () => {
    expect(enPeriodo("2026-10-01", OCT)).toBe(true);
    expect(enPeriodo("2026-10-31", OCT)).toBe(true);
  });

  it("deja fuera el día anterior y el siguiente", () => {
    expect(enPeriodo("2026-09-30", OCT)).toBe(false);
    expect(enPeriodo("2026-11-01", OCT)).toBe(false);
  });

  it("tolera una fecha con hora, que es como vienen algunas", () => {
    expect(enPeriodo("2026-10-15T23:30:00Z", OCT)).toBe(true);
  });

  it("sin fecha no está dentro de nada", () => {
    expect(enPeriodo(null, OCT)).toBe(false);
    expect(enPeriodo(undefined, OCT)).toBe(false);
  });
});

describe("revisionCuenta()", () => {
  // Las tres variantes de «completada» que hay en la base. Que acabara con
  // incidencia no quita que el vehículo se mirara, que es lo que cuenta.
  it("cuentan las completadas, con incidencia o sin ella", () => {
    expect(revisionCuenta("completada")).toBe(true);
    expect(revisionCuenta("completada_con_incidencias")).toBe(true);
    expect(revisionCuenta("completada_incidencia_pendiente")).toBe(true);
  });

  it("no cuentan ni el borrador ni la anulada", () => {
    expect(revisionCuenta("borrador")).toBe(false);
    expect(revisionCuenta("anulada")).toBe(false);
    expect(revisionCuenta(null)).toBe(false);
  });
});

describe("recuentos()", () => {
  it("controlada, revisada y pendientes, con sus porcentajes", () => {
    const vs = [veh("a"), veh("b"), veh("c"), veh("d")];
    const rs = [rev("r1", "a", "2026-10-05"), rev("r2", "b", "2026-10-20")];
    expect(recuentos(vs, rs, OCT)).toEqual({
      flotaControlada: 4, flotaRevisada: 2, pendientes: 2,
      pctRevisada: 50, pctPendientes: 50,
    });
  });

  it("un vehículo revisado dos veces en el mes cuenta una", () => {
    const vs = [veh("a"), veh("b")];
    const rs = [rev("r1", "a", "2026-10-05"), rev("r2", "a", "2026-10-25")];
    expect(recuentos(vs, rs, OCT).flotaRevisada).toBe(1);
  });

  it("una revisión de otro mes no cuenta", () => {
    const vs = [veh("a")];
    expect(recuentos(vs, [rev("r1", "a", "2026-09-30")], OCT).flotaRevisada).toBe(0);
  });

  it("un borrador no es una revisión", () => {
    const vs = [veh("a")];
    const rs = [rev("r1", "a", "2026-10-05", "borrador")];
    expect(recuentos(vs, rs, OCT).flotaRevisada).toBe(0);
  });

  it("por defecto los de baja quedan fuera de la flota", () => {
    const vs = [veh("a"), veh("b", { activo: false })];
    expect(recuentos(vs, [], OCT).flotaControlada).toBe(1);
    expect(recuentos(vs, [], OCT, true).flotaControlada).toBe(2);
  });

  /*
   * El caso que haría quedar mal al informe: un autobús dado de baja en
   * noviembre, revisado en octubre. Sin el filtro saldrían 1 de 1 revisados
   * sobre una flota de 1 que no lo incluye, o peor, más revisados que flota.
   */
  it("la revisión de un vehículo que no se cuenta tampoco se cuenta", () => {
    const vs = [veh("a"), veh("baja", { activo: false })];
    const rs = [rev("r1", "a", "2026-10-05"), rev("r2", "baja", "2026-10-06")];
    const r = recuentos(vs, rs, OCT);
    expect(r.flotaControlada).toBe(1);
    expect(r.flotaRevisada).toBe(1);
    expect(r.flotaRevisada).toBeLessThanOrEqual(r.flotaControlada);
  });

  it("y con los de baja incluidos, los dos cuentan", () => {
    const vs = [veh("a"), veh("baja", { activo: false })];
    const rs = [rev("r1", "a", "2026-10-05"), rev("r2", "baja", "2026-10-06")];
    expect(recuentos(vs, rs, OCT, true).flotaRevisada).toBe(2);
  });

  it("una flota vacía no divide entre cero", () => {
    expect(recuentos([], [], OCT)).toEqual({
      flotaControlada: 0, flotaRevisada: 0, pendientes: 0, pctRevisada: 0, pctPendientes: 0,
    });
  });

  it("los porcentajes llevan dos decimales, como el original", () => {
    const vs = Array.from({ length: 3 }, (_, i) => veh(`v${i}`));
    const r = recuentos(vs, [rev("r", "v0", "2026-10-01")], OCT);
    expect(r.pctRevisada).toBe(33.33);
    expect(r.pctPendientes).toBe(66.67);
  });
});

describe("ruedasDelMes()", () => {
  const rs = [rev("r1", "a", "2026-10-05"), rev("r2", "b", "2026-10-06")];

  it("una rueda por posición y vehículo, con su medición", () => {
    const ms = [med("r1", "a", 1), med("r1", "a", 2), med("r2", "b", 1)];
    const { ruedas } = ruedasDelMes(rs, ms, OCT);
    expect(ruedas).toHaveLength(3);
  });

  /*
   * El caso que descubrieron los datos reales: en octubre de 2026 Plana tiene
   * 24.379 mediciones de 2.116 ruedas, porque el arco de CheckPoint mide cada
   * vez que el autobús pasa. Contar mediciones daría un número once veces
   * mayor que el que el informe tiene que enseñar.
   */
  it("la misma rueda medida once veces sigue siendo UNA rueda", () => {
    const revs: RevisionRef[] = [];
    const ms: MedicionRef[] = [];
    for (let i = 1; i <= 11; i += 1) {
      revs.push(rev(`r${i}`, "a", "2026-10-10"));
      ms.push(med(`r${i}`, "a", 1, { profundidadMm: i }));
    }
    const { ruedas } = ruedasDelMes(revs, ms, OCT);
    expect(ruedas).toHaveLength(1);
  });

  it("y se queda con la medición más reciente, que es la que vale", () => {
    const revs = [rev("r1", "a", "2026-10-02"), rev("r2", "a", "2026-10-28")];
    const ms = [med("r1", "a", 1, { profundidadMm: 12 }), med("r2", "a", 1, { profundidadMm: 7 })];
    expect(ruedasDelMes(revs, ms, OCT).ruedas[0]).toMatchObject({
      profundidadMm: 7, fecha: "2026-10-28",
    });
  });

  it("aunque las mediciones lleguen en el otro orden", () => {
    const revs = [rev("r2", "a", "2026-10-28"), rev("r1", "a", "2026-10-02")];
    const ms = [med("r2", "a", 1, { profundidadMm: 7 }), med("r1", "a", 1, { profundidadMm: 12 })];
    expect(ruedasDelMes(revs, ms, OCT).ruedas[0].profundidadMm).toBe(7);
  });

  // Once pasadas por el arco el mismo día son frecuentes. Sin desempate, dos
  // ejecuciones del informe podrían dar profundidades distintas.
  it("con la misma fecha desempata de forma estable, no al azar", () => {
    const revs = [rev("rA", "a", "2026-10-10"), rev("rB", "a", "2026-10-10")];
    const ms = [med("rA", "a", 1, { profundidadMm: 9 }), med("rB", "a", 1, { profundidadMm: 4 })];
    const uno = ruedasDelMes(revs, ms, OCT).ruedas[0];
    const dos = ruedasDelMes([...revs].reverse(), [...ms].reverse(), OCT).ruedas[0];
    expect(uno).toEqual(dos);
    expect(uno.revisionId).toBe("rB");
  });

  it("una rueda ausente o inaccesible no es una rueda revisada", () => {
    const ms = [
      med("r1", "a", 1),
      med("r1", "a", 2, { ausente: true }),
    ];
    expect(ruedasDelMes(rs, ms, OCT).ruedas).toHaveLength(1);
  });

  it("las mediciones sin posición se cuentan aparte, no se pierden", () => {
    const ms = [med("r1", "a", 1), med("r1", "a", null)];
    const r = ruedasDelMes(rs, ms, OCT);
    expect(r.sinPosicion).toBe(1);
    expect(r.ruedas).toHaveLength(1);
  });

  it("las de un borrador no cuentan", () => {
    const soloBorrador = [rev("r9", "a", "2026-10-05", "borrador")];
    expect(ruedasDelMes(soloBorrador, [med("r9", "a", 1)], OCT).ruedas).toHaveLength(0);
  });

  it("ni las de otro mes", () => {
    const otroMes = [rev("r8", "a", "2026-09-05")];
    expect(ruedasDelMes(otroMes, [med("r8", "a", 1)], OCT).ruedas).toHaveLength(0);
  });

  it("respeta la misma flota que los recuentos", () => {
    const ms = [med("r1", "a", 1), med("r2", "b", 1)];
    expect(ruedasDelMes(rs, ms, OCT, new Set(["a"])).ruedas).toHaveLength(1);
  });
});

describe("neumaticosRevisados()", () => {
  const rs = [rev("r1", "a", "2026-10-05"), rev("r2", "b", "2026-10-06")];
  const rejilla = (ms: MedicionRef[], revs = rs) =>
    neumaticosRevisados(ruedasDelMes(revs, ms, OCT));

  it("cuenta por posición y da el total", () => {
    const n = rejilla([
      med("r1", "a", 1), med("r1", "a", 2), med("r1", "a", 3),
      med("r2", "b", 1), med("r2", "b", 2),
    ]);
    expect(n.posiciones).toEqual([1, 2, 3]);
    expect(n.porPosicion).toEqual([2, 2, 1]);
    expect(n.total).toBe(5);
  });

  // Una columna vacía en medio es información: esa rueda no se midió.
  it("deja el hueco cuando una posición intermedia no tiene nada", () => {
    const n = rejilla([med("r1", "a", 1), med("r1", "a", 4)]);
    expect(n.posiciones).toEqual([1, 2, 3, 4]);
    expect(n.porPosicion).toEqual([1, 0, 0, 1]);
  });

  it("la rejilla llega hasta donde hay ruedas, no hasta un 10 fijo", () => {
    expect(rejilla([med("r1", "a", 1), med("r1", "a", 6)]).posiciones).toHaveLength(6);
  });

  /*
   * La forma que tienen los datos de verdad: seis ruedas en casi toda la
   * flota y dos más en los de tres ejes. Si el total saliera un múltiplo de
   * las pasadas por el arco, esto lo cazaría.
   */
  it("con la forma de la flota real, el total son las ruedas y no las pasadas", () => {
    const revs: RevisionRef[] = [];
    const ms: MedicionRef[] = [];
    for (let v = 0; v < 10; v += 1) {
      for (let pasada = 1; pasada <= 11; pasada += 1) {
        const id = `r${v}-${pasada}`;
        revs.push(rev(id, `v${v}`, `2026-10-${String(pasada + 1).padStart(2, "0")}`));
        for (let pos = 1; pos <= 6; pos += 1) ms.push(med(id, `v${v}`, pos));
      }
    }
    const n = rejilla(ms, revs);
    expect(n.total, "10 vehículos × 6 ruedas, no × 11 pasadas").toBe(60);
    expect(n.porPosicion).toEqual([10, 10, 10, 10, 10, 10]);
  });

  it("sin nada medido, una rejilla vacía y no un error", () => {
    const n = rejilla([]);
    expect(n).toEqual({ posiciones: [], porPosicion: [], total: 0, sinPosicion: 0 });
  });
});

describe("avisosDelMes()", () => {
  const sinNada = { posiciones: [], porPosicion: [], total: 0, sinPosicion: 0 };

  it("dice cuántos vehículos no pueden salir en las rejillas por no tener tipo", () => {
    const vs = [veh("a"), veh("b", { tipoId: null }), veh("c", { tipoId: null })];
    const a = avisosDelMes(vs, sinNada, 0, false);
    expect(a.some((t) => t.includes("2 vehículo(s)") && t.includes("no tienen tipo"))).toBe(true);
  });

  it("y no lo dice cuando todos tienen tipo", () => {
    const a = avisosDelMes([veh("a")], sinNada, 0, false);
    expect(a.some((t) => t.includes("no tienen tipo"))).toBe(false);
  });

  it("avisa de las mediciones que no caben en ninguna columna", () => {
    const a = avisosDelMes([veh("a")], { ...sinNada, sinPosicion: 7 }, 0, false);
    expect(a.some((t) => t.includes("7 medición(es)"))).toBe(true);
  });

  it("avisa de las posiciones repetidas, en vez de sumarlas en silencio", () => {
    const a = avisosDelMes([veh("a")], sinNada, 2, false);
    expect(a.some((t) => t.includes("mismo número de orden"))).toBe(true);
  });

  // Lo que el informe NO puede saber, dicho en el propio informe.
  it("siempre dice que la flota es la de hoy, no la del mes", () => {
    const a = avisosDelMes([veh("a")], sinNada, 0, false);
    expect(a.some((t) => t.includes("la de HOY") && t.includes("fecha de baja"))).toBe(true);
  });

  it("dice cuántos de baja se han quedado fuera, y no lo dice si se incluyen", () => {
    const vs = [veh("a"), veh("b", { activo: false })];
    expect(avisosDelMes(vs, sinNada, 0, false).some((t) => t.includes("dados de baja"))).toBe(true);
    expect(avisosDelMes(vs, sinNada, 0, true).some((t) => t.includes("dados de baja"))).toBe(false);
  });
});
