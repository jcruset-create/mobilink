import { describe, expect, it, vi } from "vitest";
vi.mock("./supabase", () => ({ supabase: {} }));
import { agruparRendimiento, calcularRendimiento, pendiente, type DatosRendimiento } from "./rendimiento";

// El caso real del 7523NNB: gomas de origen, 35.471 km, X COACH Z de 14,3 mm.
const base = {
  km_actual_vehiculo: 35471, km_vehiculo_inicio: 0, profundidad_inicial_mm: 14.3, minimo_mm: 3,
};

describe("rendimiento de un neumático", () => {
  it("7523NNB eje 1: 14,3 → 11 mm en 35.471 km", () => {
    const r = calcularRendimiento({ ...base, profundidad_actual_mm: 11,
      puntos: [{ km_vehiculo: 35471, mm: 11, fecha: "2026-11-21" }] });
    expect(r.gastadoMm).toBe(3.3);
    expect(r.kmPorMm).toBe(10749);
    expect(r.quedanKm).toBe(85990);
    expect(r.vidaKm).toBe(121461);
    expect(r.metodo).toBe("origen");
  });

  it("7523NNB eje 2: 14,3 → 10 mm", () => {
    const r = calcularRendimiento({ ...base, profundidad_actual_mm: 10, puntos: [] });
    expect(r.kmPorMm).toBe(8249);
    expect(r.vidaKm).toBe(93214);
  });

  it("con 3 o más puntos usa la recta de todos, no la última lectura", () => {
    // Una lectura ruidosa (12 a 40.000 km) no debe disparar la vida.
    const r = calcularRendimiento({ ...base, km_actual_vehiculo: 60000, profundidad_actual_mm: 9,
      puntos: [{ km_vehiculo: 20000, mm: 12.4, fecha: "" }, { km_vehiculo: 40000, mm: 12, fecha: "" }] });
    expect(r.metodo).toBe("recta");
    // El 12 a 40.000 km no ha bajado 1 mm desde el 12,4: se ve, pero no cuenta.
    expect(r.puntos).toHaveLength(3);
    expect(r.descartados).toEqual([{ km: 40000, mm: 12 }]);
    expect(r.kmPorMm).toBeGreaterThan(10000);
    expect(r.kmPorMm).toBeLessThan(14000);
  });

  it("con menos de 1 mm gastado no proyecta", () => {
    const r = calcularRendimiento({ ...base, km_actual_vehiculo: 5000, profundidad_actual_mm: 13.8, puntos: [] });
    expect(r.vidaKm).toBeNull();
    expect(r.sinProyeccion).toMatch(/Poco gasto/);
  });

  it("0039LXV: solo cuenta lo que baja 1 mm; el ruido del calibre no mueve la recta", () => {
    const ini = 502706;
    const lecturas = [[526440, 13.7], [526694, 13.8], [527429, 14.3], [527926, 14], [528547, 13.5],
      [529719, 13.8], [530535, 13.9], [530838, 13.8], [531204, 13.6], [531634, 13.8]]
      .map(([km, mm]) => ({ km_vehiculo: km, mm, fecha: "" }));
    const r = calcularRendimiento({ km_actual_vehiculo: 532519, km_vehiculo_inicio: ini, profundidad_inicial_mm: 16.5,
      profundidad_actual_mm: 13.8, minimo_mm: 3, puntos: lecturas });
    expect(r.puntos).toEqual([{ km: 0, mm: 16.5 }, { km: 23734, mm: 13.7 }]);
    expect(r.descartados).toHaveLength(10); // 9 lecturas + la de hoy
    expect(r.metodo).toBe("origen");
    // Del origen a hoy: 2,7 mm en 29.813 km.
    expect(r.kmPorMm).toBe(Math.round(29813 / 2.7));
    expect(r.vidaKm).toBe(29813 + r.quedanKm!);
  });

  it("0039LXV eje 1: mismo Hoy y mismo Gastado → mismos km/mm, aunque la primera lectura difiera", () => {
    const ini = 502706;
    const izq = [[23734, 13.1], [23988, 14.1], [24723, 12.7], [25220, 13.8], [25841, 13.7], [27013, 13.6],
      [27829, 13.6], [28132, 13.3], [28498, 13.6], [28928, 13.8]];
    const der = [[23734, 13.7], [23988, 13.8], [24723, 14.3], [25220, 14], [25841, 13.5], [27013, 13.8],
      [27829, 13.9], [28132, 13.8], [28498, 13.6], [28928, 13.8]];
    const de = (l: number[][]) => calcularRendimiento({ km_actual_vehiculo: ini + 29382, km_vehiculo_inicio: ini,
      profundidad_inicial_mm: 16.5, profundidad_actual_mm: 13.8, minimo_mm: 3,
      puntos: l.map(([km, mm]) => ({ km_vehiculo: ini + km, mm, fecha: "" })) });
    expect(de(izq).kmPorMm).toBe(de(der).kmPorMm);
    expect(de(izq).vidaKm).toBe(de(der).vidaKm);
  });

  it("una lectura mala suelta (2,3 mm entre dos de 8,5) no entra en la línea", () => {
    const ini = 467188;
    const l = [[59252, 8.7], [59506, 8.5], [60241, 2.3], [60738, 8.4], [61359, 8.1], [62531, 8.3],
      [63347, 8.7], [63650, 8.4], [64016, 8.3], [64446, 8.1]];
    const r = calcularRendimiento({ km_actual_vehiculo: ini + 64900, km_vehiculo_inicio: ini,
      profundidad_inicial_mm: 16.5, profundidad_actual_mm: 8.1, minimo_mm: 3,
      puntos: l.map(([km, mm]) => ({ km_vehiculo: ini + km, mm, fecha: "" })) });
    expect(r.puntos.some((p) => p.mm < 5)).toBe(false);
    expect(r.kmPorMm).toBe(Math.round(64900 / 8.4));
  });

  it("baja justo 1 mm: entra", () => {
    const r = calcularRendimiento({ ...base, km_actual_vehiculo: 10000, profundidad_actual_mm: 13.3, puntos: [] });
    expect(r.puntos).toHaveLength(2);
    expect(r.kmPorMm).toBe(10000);
  });

  it("sin profundidad de origen lo dice", () => {
    const r = calcularRendimiento({ ...base, profundidad_inicial_mm: null, profundidad_actual_mm: 10, puntos: [] });
    expect(r.sinProyeccion).toMatch(/origen/);
  });

  it("cuenta desde el km de inicio si no son de origen", () => {
    const r = calcularRendimiento({ ...base, km_vehiculo_inicio: 30000, km_actual_vehiculo: 50000,
      profundidad_actual_mm: 12.3, puntos: [{ km_vehiculo: 20000, mm: 5, fecha: "" }] });
    expect(r.kmGoma).toBe(20000);
    expect(r.kmPorMm).toBe(10000);
    // La lectura anterior al inicio no cuenta.
    expect(r.puntos.every((p) => p.km >= 0)).toBe(true);
  });

  it("la pendiente de una recta exacta", () => {
    expect(pendiente([{ km: 0, mm: 14 }, { km: 10000, mm: 13 }, { km: 20000, mm: 12 }])).toBeCloseTo(-0.0001);
  });
});

describe("informe de rendimiento", () => {
  const fila = (p: Partial<DatosRendimiento>): DatosRendimiento => ({
    vehiculo_id: "v", matricula: "7523NNB", numero_unidad: "1807", desde_origen: true, fecha_inicio: "",
    posicion_id: "p", posicion: "", orden: 1, neumatico_id: "n", numero_interno: null,
    marca: "Michelin", modelo: "X COACH Z", medida: "295/80R22.5", recauchutado: false, reesculturado: false,
    fuente_inicio: "catalogo", eje: 1, profundidad_actual_mm: 11, puntos: [], ...base, ...p,
  } as DatosRendimiento);

  it("agrupa por modelo y eje, y aparta recauchutadas", () => {
    const g = agruparRendimiento([
      fila({}), fila({}), fila({ eje: 2, profundidad_actual_mm: 10 }), fila({ eje: 2, recauchutado: true, profundidad_actual_mm: 10 }),
    ]);
    expect(g).toHaveLength(3);
    const e1 = g.find((x) => x.eje === 1)!;
    expect(e1.gomas).toBe(2);
    expect(e1.kmPorMm).toBe(10749);
    expect(g.find((x) => x.tipo === "recauchutado")?.gomas).toBe(1);
  });

  it("une por la referencia del catálogo: COACHZ y X COACH Z son el mismo", () => {
    const ref = { ref_marca: "Michelin", ref_modelo: "X COACH Z", ref_medida: "295/80R22.5" };
    const g = agruparRendimiento([fila({ ...ref }), fila({ modelo: "COACHZ", ...ref }), fila({ modelo: "XCOACH" })]);
    expect(g.map((x) => [x.modelo, x.gomas])).toEqual([
      ["Michelin X COACH Z 295/80R22.5", 2],
      ["Michelin XCOACH 295/80R22.5", 1], // sin referencia: por su texto
    ]);
  });
});
