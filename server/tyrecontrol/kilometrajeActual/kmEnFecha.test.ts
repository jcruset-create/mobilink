import { describe, expect, it } from "vitest";

import { descartarIncoherentes, kmEnFecha, kmRodadosEntre, odometroNoFiable, lecturasDeMeses, ultimoConocido, type LecturaKm, type MesTelematica } from "./kmEnFecha.ts";

const rev = (fecha: string, km: number): LecturaKm => ({ km, fecha, fuente: "revision", detalle: `revisión del ${fecha}` });
const sept: MesTelematica = { year: 2026, month: 9, inicial: 143_709, final: 151_988, distancia: 8_279, cerrado: true };
const nov: MesTelematica = { year: 2026, month: 11, inicial: 161_069, final: 164_000, distancia: 3_143, cerrado: false };

describe("ultimoConocido", () => {
  it("el mayor de todos, venga de donde venga", () => {
    const u = ultimoConocido([rev("2026-11-24", 163_904), rev("2026-10-01", 152_000), ...lecturasDeMeses([sept])]);
    expect(u?.km).toBe(163_904);
    expect(u?.fecha).toBe("2026-11-24");
  });
  it("sin lecturas válidas (un 0 de la importación no lo es), nada", () => {
    expect(ultimoConocido([{ km: 0, fecha: "2026-01-01", fuente: "vehiculo", detalle: "ficha" }])).toBeNull();
  });
});

describe("lecturasDeMeses", () => {
  it("del mes cerrado, inicio y cierre; del mes en curso, solo el inicio", () => {
    const l = lecturasDeMeses([sept, nov]);
    expect(l.map((x) => [x.fecha, x.km])).toEqual([
      ["2026-09-01", 143_709], ["2026-09-30", 151_988], ["2026-11-01", 161_069],
    ]);
  });
});

describe("kmEnFecha", () => {
  it("una lectura de ese día manda", () => {
    const r = kmEnFecha("2026-09-24", [rev("2026-09-24", 149_760)], [sept]);
    expect(r).toMatchObject({ tipo: "lectura", km: 149_760 });
  });

  it("entre dos lecturas cercanas, en línea recta por días", () => {
    const r = kmEnFecha("2026-09-24", [rev("2026-09-20", 148_950), rev("2026-09-28", 151_050)], []);
    expect(r.tipo).toBe("interpolado");
    expect((r as { km: number }).km).toBe(150_000);
  });

  it("con solo la telemática del mes cerrado, interpola entre el día 1 y el 30", () => {
    const r = kmEnFecha("2026-09-24", [], [sept]);
    expect(r.tipo).toBe("interpolado");
    // 143.709 + 8.279 × 23/29
    expect((r as { km: number }).km).toBe(150_275);
  });

  it("del mes en curso (sin cierre), estimado con lo que lleva rodado", () => {
    const r = kmEnFecha("2026-11-15", [], [nov]);
    expect(r).toMatchObject({ tipo: "estimado", km: Math.round(161_069 + 3_143 * 15 / 30) });
  });

  it("lecturas demasiado lejos no se usan para interpolar", () => {
    const r = kmEnFecha("2026-06-15", [rev("2026-01-10", 100_000), rev("2026-12-10", 170_000)], []);
    expect(r.tipo).toBe("sin_datos");
  });

  it("si la de después es menor (cambio de equipo, dedazo), no se inventa una recta", () => {
    const r = kmEnFecha("2026-09-24", [rev("2026-09-20", 150_000), rev("2026-09-28", 140_000)], []);
    expect(r.tipo).toBe("sin_datos");
  });
});

describe("descartarIncoherentes", () => {
  const op = (fecha: string, km: number): LecturaKm => ({ km, fecha, fuente: "operacion", detalle: `montaje del ${fecha}` });

  it("el caso del 8378NBC: un montaje con 92.748 km entre lecturas de 150.000 se aparta", () => {
    const { buenas, descartadas } = descartarIncoherentes([
      rev("2026-09-10", 147_000), op("2026-09-24", 92_748), rev("2026-10-05", 153_000),
    ]);
    expect(descartadas.map((l) => l.km)).toEqual([92_748]);
    expect(buenas.map((l) => l.km)).toEqual([147_000, 153_000]);
  });

  it("ya no da la lectura mala como «lectura real» de ese día", () => {
    const r = kmEnFecha("2026-09-24", [rev("2026-09-20", 148_950), op("2026-09-24", 92_748), rev("2026-09-28", 151_050)], []);
    expect(r).toMatchObject({ tipo: "interpolado", km: 150_000 });
  });

  it("con empate, se aparta la tecleada y no la de la telemática", () => {
    const { descartadas } = descartarIncoherentes([
      { km: 150_000, fecha: "2026-09-01", fuente: "telematica_mes", detalle: "telemática" }, op("2026-09-24", 92_748),
    ]);
    expect(descartadas[0].fuente).toBe("operacion");
  });

  it("un km tecleado de más tampoco se cuela como último conocido", () => {
    const u = ultimoConocido([rev("2026-09-10", 147_000), op("2026-09-24", 1_500_000), rev("2026-10-05", 153_000), rev("2026-11-20", 163_000)]);
    expect(u?.km).toBe(163_000);
  });
});

describe("odómetro de la telemática parado (8378NBC: clavado en 66.690 desde el 30/05)", () => {
  const mayo: MesTelematica = { year: 2026, month: 5, inicial: 59_597, final: 66_690, distancia: 7_090, cerrado: true };
  const septSinOdo: MesTelematica = { year: 2026, month: 9, inicial: null, final: null, distancia: 8_279, cerrado: true };
  const octSinOdo: MesTelematica = { year: 2026, month: 10, inicial: null, final: null, distancia: 9_081, cerrado: true };
  const montaje: LecturaKm = { km: 92_748, fecha: "2026-09-24", fuente: "operacion", detalle: "montaje del 24/09/2026" };

  it("los km rodados entre dos fechas se reparten por días", () => {
    expect(Math.round(kmRodadosEntre("2026-08-31", "2026-09-30", [septSinOdo]))).toBe(8_279);
    expect(Math.round(kmRodadosEntre("2026-09-15", "2026-09-30", [septSinOdo]))).toBe(Math.round(8_279 * 15 / 30));
  });

  it("menor que una lectura buena anterior: no fiable", () => {
    const m = odometroNoFiable(66_690, "2026-10-10", [montaje], [mayo, septSinOdo, octSinOdo]);
    expect(m).toContain("menos que el montaje del 24/09/2026");
  });

  it("sin lecturas por medio, pero los viajes dicen que rodó: no fiable", () => {
    const m = odometroNoFiable(66_690, "2026-09-24", [], [mayo, septSinOdo]);
    expect(m).toContain("parece parado");
  });

  it("un odómetro que sube al ritmo de los viajes es fiable", () => {
    expect(odometroNoFiable(66_690 + 6_500, "2026-09-24", [], [mayo, septSinOdo])).toBeNull();
  });

  it("si el vehículo no rodó (verano sin viajes), que no suba es normal", () => {
    const junio: MesTelematica = { year: 2026, month: 6, inicial: null, final: null, distancia: null, cerrado: true };
    expect(odometroNoFiable(66_690, "2026-06-20", [], [mayo, junio])).toBeNull();
  });
});
