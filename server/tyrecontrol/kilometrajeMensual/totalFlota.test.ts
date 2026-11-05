import { describe, expect, it } from "vitest";
import {
  dentroDelRango, mesesDelRango, ordenarRango, totalDeFlota, type RangoMeses,
} from "./totalFlota.ts";
import type { MonthlyMileageRow } from "../../integration-hub/infrastructure/repositories.ts";

const fila = (p: Partial<MonthlyMileageRow> & { year: number; month: number }): MonthlyMileageRow => ({
  id: 1, tenant_id: "e1", system: "movertis", account_key: "a", mobilink_id: "v1",
  external_code: "x", period_start_ms: 0, period_end_ms: 0, timezone: "Europe/Madrid",
  distance_km: 1000, initial_odometer_km: null, final_odometer_km: null, trips: null,
  source: "api", sync_status: "ok", closed: true, synced_at_ms: 0, last_error: null, ...p,
});

const r = (d: string, h: string): RangoMeses => ({
  desde: { year: +d.slice(0, 4), month: +d.slice(5) },
  hasta: { year: +h.slice(0, 4), month: +h.slice(5) },
});

describe("el rango", () => {
  it("los dos extremos entran", () => {
    expect(dentroDelRango(2026, 1, r("2026-01", "2026-09"))).toBe(true);
    expect(dentroDelRango(2026, 9, r("2026-01", "2026-09"))).toBe(true);
    expect(dentroDelRango(2025, 12, r("2026-01", "2026-09"))).toBe(false);
    expect(dentroDelRango(2026, 10, r("2026-01", "2026-09"))).toBe(false);
  });

  it("cruza el año sin perderse", () => {
    expect(dentroDelRango(2026, 2, r("2025-11", "2026-03"))).toBe(true);
    expect(dentroDelRango(2025, 10, r("2025-11", "2026-03"))).toBe(false);
    expect(mesesDelRango(r("2025-11", "2026-03"))).toBe(5);
  });

  it("un solo mes es un rango de uno", () => {
    expect(mesesDelRango(r("2026-05", "2026-05"))).toBe(1);
  });

  /**
   * Pasa de verdad: «de enero de 2026 a septiembre de 2025». Devolver vacío
   * sería técnicamente correcto e inútil; se entiende lo que quiso decir.
   */
  it("al revés se endereza en vez de devolver vacío", () => {
    expect(ordenarRango(r("2026-01", "2025-09"))).toEqual(r("2025-09", "2026-01"));
    expect(ordenarRango(r("2025-09", "2026-01"))).toEqual(r("2025-09", "2026-01"));
  });
});

describe("el total", () => {
  it("suma lo que hay dentro y deja fuera lo de fuera", () => {
    const t = totalDeFlota([
      fila({ year: 2025, month: 12, distance_km: 999 }),
      fila({ year: 2026, month: 1, distance_km: 100 }),
      fila({ year: 2026, month: 2, distance_km: 200 }),
      fila({ year: 2026, month: 10, distance_km: 999 }),
    ], r("2026-01", "2026-09"));
    expect(t.km).toBe(300);
    expect(t.filasOk).toBe(2);
    expect(t.porMes.map((m) => m.month)).toEqual([1, 2]);
  });

  /**
   * La regla que comparte con el ranking y la ficha. Si esto cambiara, el
   * total de una pantalla y el de otra dejarían de cuadrar.
   */
  it("un mes vacío o con error NO cuenta como cero: cuenta como que falta", () => {
    const t = totalDeFlota([
      fila({ year: 2026, month: 1, distance_km: 1000 }),
      fila({ year: 2026, month: 2, sync_status: "empty", distance_km: null }),
      fila({ year: 2026, month: 3, sync_status: "error", distance_km: null }),
    ], r("2026-01", "2026-03"));
    expect(t.km).toBe(1000);
    expect(t.filasOk).toBe(1);
    expect(t.filasVacias).toBe(1);
    expect(t.filasConError).toBe(1);
    // Y la media se calcula sobre el mes que SÍ tiene dato, no sobre tres.
    expect(t.mediaVehiculoMes).toBe(1000);
  });

  it("un cero de verdad sí cuenta: un autobús parado hizo cero kilómetros", () => {
    const t = totalDeFlota([
      fila({ year: 2026, month: 1, distance_km: 1000 }),
      fila({ year: 2026, month: 2, distance_km: 0 }),
    ], r("2026-01", "2026-02"));
    expect(t.km).toBe(1000);
    expect(t.filasOk).toBe(2);
    expect(t.mediaVehiculoMes).toBe(500);   // sobre DOS meses, no uno
  });

  it("agrupa por vehículo y los ordena por kilómetros", () => {
    const t = totalDeFlota([
      fila({ year: 2026, month: 1, mobilink_id: "a", distance_km: 100 }),
      fila({ year: 2026, month: 2, mobilink_id: "a", distance_km: 150 }),
      fila({ year: 2026, month: 1, mobilink_id: "b", distance_km: 900 }),
    ], r("2026-01", "2026-02"));
    expect(t.vehiculosConDato).toBe(2);
    expect(t.porVehiculo).toEqual([
      { vehiculoId: "b", km: 900, meses: 1 },
      { vehiculoId: "a", km: 250, meses: 2 },
    ]);
  });

  it("el desglose por mes lleva su cobertura", () => {
    const t = totalDeFlota([
      fila({ year: 2026, month: 1, mobilink_id: "a", distance_km: 100 }),
      fila({ year: 2026, month: 1, mobilink_id: "b", sync_status: "error" }),
      fila({ year: 2026, month: 1, mobilink_id: "c", sync_status: "empty" }),
    ], r("2026-01", "2026-01"));
    expect(t.porMes[0]).toEqual({ year: 2026, month: 1, km: 100, vehiculos: 1, conError: 1, vacios: 1 });
  });

  it("los meses salen en orden, aunque lleguen desordenados", () => {
    const t = totalDeFlota([
      fila({ year: 2026, month: 3 }), fila({ year: 2025, month: 12 }), fila({ year: 2026, month: 1 }),
    ], r("2025-11", "2026-03"));
    expect(t.porMes.map((m) => `${m.year}-${m.month}`)).toEqual(["2025-12", "2026-1", "2026-3"]);
  });
});

describe("la estimación de lo que falta", () => {
  it("es el ritmo de lo medido aplicado a los huecos, y va APARTE del total", () => {
    const t = totalDeFlota([
      fila({ year: 2026, month: 1, mobilink_id: "a", distance_km: 1000 }),
      fila({ year: 2026, month: 1, mobilink_id: "b", distance_km: 3000 }),
      fila({ year: 2026, month: 1, mobilink_id: "c", sync_status: "error" }),
      fila({ year: 2026, month: 1, mobilink_id: "d", sync_status: "error" }),
    ], r("2026-01", "2026-01"));
    expect(t.km).toBe(4000);                  // el total es lo MEDIDO
    expect(t.mediaVehiculoMes).toBe(2000);
    expect(t.kmEstimadosEnHuecos).toBe(4000); // dos huecos × 2.000
  });

  it("sin huecos no se estima nada", () => {
    const t = totalDeFlota([fila({ year: 2026, month: 1 })], r("2026-01", "2026-01"));
    expect(t.kmEstimadosEnHuecos).toBeNull();
  });

  it("sin ningún dato no se inventa una media", () => {
    const t = totalDeFlota([
      fila({ year: 2026, month: 1, sync_status: "error" }),
    ], r("2026-01", "2026-01"));
    expect(t.km).toBe(0);
    expect(t.mediaVehiculoMes).toBeNull();
    expect(t.kmEstimadosEnHuecos).toBeNull();
  });

  it("un rango sin filas devuelve ceros, no un fallo", () => {
    const t = totalDeFlota([], r("2026-01", "2026-09"));
    expect(t.km).toBe(0);
    expect(t.vehiculosConDato).toBe(0);
    expect(t.porMes).toEqual([]);
    expect(t.mesesDelRango).toBe(9);
  });
});

/**
 * Las cifras de producción del 1 de enero al 30 de septiembre de 2026,
 * consultadas el 5/11/2026. Si un cambio las mueve, que salte aquí y no
 * delante del cliente.
 */
describe("las proporciones del caso real", () => {
  it("309 huecos sobre 5.738 filas estiman cerca de un millón de km", () => {
    const filas: MonthlyMileageRow[] = [];
    for (let i = 0; i < 5429; i++) {
      filas.push(fila({ year: 2026, month: (i % 9) + 1, mobilink_id: `v${i % 705}`,
                        distance_km: 19_351_544 / 5429 }));
    }
    for (let i = 0; i < 310; i++) {
      filas.push(fila({ year: 2026, month: (i % 9) + 1, mobilink_id: `x${i}`, sync_status: "error" }));
    }
    const t = totalDeFlota(filas, r("2026-01", "2026-09"));
    expect(Math.round(t.km)).toBe(19_351_544);
    expect(Math.round(t.mediaVehiculoMes!)).toBe(3564);
    expect(Math.round(t.kmEstimadosEnHuecos! / 1000)).toBe(1105);
  });
});

describe("rangoPedido · lo que llega por la URL", () => {
  // Se importa aquí y no arriba porque el router arrastra la base de datos:
  // el resto del fichero tiene que poder correr sin ella.
  const hoy = new Date("2026-11-05T00:00:00Z");

  it("acepta AAAA-MM", async () => {
    const { rangoPedido } = await import("./router.ts");
    expect(rangoPedido("2026-01", "2026-09", hoy))
      .toEqual({ desde: { year: 2026, month: 1 }, hasta: { year: 2026, month: 9 } });
  });

  it("acepta AAAA-MM-DD y se queda con el mes: el día aquí no significa nada", async () => {
    const { rangoPedido } = await import("./router.ts");
    expect(rangoPedido("2026-01-15", "2026-09-30", hoy))
      .toEqual({ desde: { year: 2026, month: 1 }, hasta: { year: 2026, month: 9 } });
  });

  it("sin nada, los doce últimos meses", async () => {
    const { rangoPedido } = await import("./router.ts");
    expect(rangoPedido(null, null, hoy))
      .toEqual({ desde: { year: 2025, month: 12 }, hasta: { year: 2026, month: 11 } });
  });

  it("con un solo extremo, ese mes suelto", async () => {
    const { rangoPedido } = await import("./router.ts");
    expect(rangoPedido("2026-03", null, hoy))
      .toEqual({ desde: { year: 2026, month: 3 }, hasta: { year: 2026, month: 3 } });
  });

  it("lo que no se entiende se rechaza, no se interpreta", async () => {
    const { rangoPedido } = await import("./router.ts");
    for (const malo of ["2026", "01-2026", "2026/01", "2026-13", "2026-00", "ayer"]) {
      expect(rangoPedido(malo, "2026-09", hoy), `debería rechazar ${malo}`).toBeNull();
    }
  });
});
