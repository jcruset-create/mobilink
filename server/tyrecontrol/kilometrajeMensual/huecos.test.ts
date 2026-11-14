import { describe, expect, it } from "vitest";
import { contarPorClase, mesesQueFaltan, proveedorDe } from "./huecos.ts";
import type { MonthlyMileageRow } from "../../integration-hub/infrastructure/repositories.ts";

/**
 * Lo que se fija aquí es a quién se le pide qué, que es cupo del proveedor:
 *
 *  · Que la ventana empieza en el PRIMER MES DEL VEHÍCULO y no en el de la
 *    flota. A un autobús que entró en junio no se le piden enero a mayo: no
 *    existía para el proveedor y la respuesta sería «sin datos» para siempre.
 *  · Que el mes EN CURSO nunca se pide: está a medias y volver a pedirlo no
 *    lo completa, solo gasta.
 *  · Que un mes ausente cuenta igual que uno con error. Son tres clases
 *    distintas y las tres son «falta».
 */

const ACTUAL = { year: 2026, month: 11 };

function fila(
  year: number, month: number,
  estado: MonthlyMileageRow["sync_status"] = "ok",
  extra: Partial<MonthlyMileageRow> = {},
): MonthlyMileageRow {
  return {
    id: 1, tenant_id: "e", system: "movertis", account_key: "plana",
    mobilink_id: "v", external_code: "1", year, month,
    period_start_ms: 0, period_end_ms: 0, timezone: "Europe/Madrid",
    distance_km: estado === "ok" ? 1000 : null,
    initial_odometer_km: null, final_odometer_km: null, trips: null,
    source: "summarytrips", sync_status: estado, closed: true,
    synced_at_ms: 0, last_error: null, ...extra,
  };
}

describe("mesesQueFaltan", () => {
  it("sin filas no hay nada que pedir: no se inventa una ventana", () => {
    expect(mesesQueFaltan([], { mesActual: ACTUAL })).toEqual([]);
  });

  it("un mes con error es un hueco, y arrastra lo que contestó el proveedor", () => {
    const h = mesesQueFaltan([
      fila(2026, 1), fila(2026, 2, "error", { last_error: "timeout" }), fila(2026, 3),
    ], { mesActual: { year: 2026, month: 4 } });
    expect(h).toEqual([{ year: 2026, month: 2, clase: "error", error: "timeout" }]);
  });

  it("un mes que no tiene ni fila también falta", () => {
    const h = mesesQueFaltan([fila(2026, 1), fila(2026, 3)], { mesActual: { year: 2026, month: 4 } });
    expect(h).toEqual([{ year: 2026, month: 2, clase: "ausente" }]);
  });

  it("«sin datos» cuenta por defecto, y se puede dejar fuera", () => {
    const filas = [fila(2026, 1), fila(2026, 2, "empty"), fila(2026, 3)];
    const op = { mesActual: { year: 2026, month: 4 } };
    expect(mesesQueFaltan(filas, op)).toEqual([{ year: 2026, month: 2, clase: "sin_dato" }]);
    expect(mesesQueFaltan(filas, { ...op, incluirSinDato: false })).toEqual([]);
  });

  it("la ventana empieza en el primer mes DEL VEHÍCULO, no antes", () => {
    // Entró en junio. Enero a mayo no se piden: no existía para el proveedor.
    const h = mesesQueFaltan([fila(2026, 6), fila(2026, 8)], { mesActual: { year: 2026, month: 10 } });
    expect(h.map((x) => x.month)).toEqual([7, 9]);
  });

  it("el mes EN CURSO no se pide: está a medias", () => {
    const h = mesesQueFaltan([fila(2026, 9)], { mesActual: { year: 2026, month: 11 } });
    // Falta octubre, que ya está cerrado; noviembre no.
    expect(h.map((x) => x.month)).toEqual([10]);
  });

  it("si el vehículo solo tiene el mes en curso, no hay nada que pedir", () => {
    expect(mesesQueFaltan([fila(2026, 11)], { mesActual: { year: 2026, month: 11 } })).toEqual([]);
  });

  it("la ventana cruza el año sin saltarse diciembre ni repetir enero", () => {
    const h = mesesQueFaltan([fila(2025, 11), fila(2026, 2)], { mesActual: { year: 2026, month: 3 } });
    expect(h.map((x) => `${x.year}-${x.month}`)).toEqual(["2025-12", "2026-1"]);
  });

  it("van del más viejo al más nuevo, lleguen las filas como lleguen", () => {
    const h = mesesQueFaltan([
      fila(2026, 5, "error"), fila(2026, 2), fila(2026, 1, "error"),
      fila(2026, 4), fila(2026, 3, "error"),
    ], { mesActual: { year: 2026, month: 6 } });
    expect(h.map((x) => x.month)).toEqual([1, 3, 5]);
  });

  it("las tres clases conviven y salen todas, en orden", () => {
    // 1 con error, 2 sin fila, 3 sin datos, 4 bien.
    const h = mesesQueFaltan([
      fila(2026, 1, "error"), fila(2026, 3, "empty"), fila(2026, 4),
    ], { mesActual: { year: 2026, month: 5 } });
    expect(h.map((x) => [x.month, x.clase])).toEqual([[1, "error"], [2, "ausente"], [3, "sin_dato"]]);
  });

  it("el tope corta dejando los MÁS VIEJOS, que son los que llevan más sin arreglarse", () => {
    const filas = [1, 2, 3, 4, 5].map((m) => fila(2026, m, "error"));
    const h = mesesQueFaltan(filas, { mesActual: { year: 2026, month: 6 }, maximo: 2 });
    expect(h.map((x) => x.month)).toEqual([1, 2]);
  });

  it("un vehículo sin huecos devuelve lista vacía, no un mes cualquiera", () => {
    const filas = [1, 2, 3].map((m) => fila(2026, m));
    expect(mesesQueFaltan(filas, { mesActual: { year: 2026, month: 4 } })).toEqual([]);
  });
});

describe("proveedorDe", () => {
  it("sale de las filas del propio vehículo: no se le pregunta al usuario", () => {
    expect(proveedorDe([fila(2026, 1)])).toEqual({ system: "movertis", accountKey: "plana" });
  });

  it("si cambió de proveedor manda el de la fila MÁS RECIENTE", () => {
    expect(proveedorDe([
      fila(2026, 1, "ok", { system: "webfleet", account_key: "vieja" }),
      fila(2026, 7, "ok", { system: "movertis", account_key: "plana" }),
    ])).toEqual({ system: "movertis", accountKey: "plana" });
  });

  it("sin filas no se adivina un proveedor", () => {
    expect(proveedorDe([])).toBeNull();
  });
});

describe("contarPorClase", () => {
  it("cuenta las tres clases por separado", () => {
    expect(contarPorClase([
      { year: 2026, month: 1, clase: "error" },
      { year: 2026, month: 2, clase: "error" },
      { year: 2026, month: 3, clase: "ausente" },
      { year: 2026, month: 4, clase: "sin_dato" },
    ])).toEqual({ error: 2, sin_dato: 1, ausente: 1 });
  });

  it("sin huecos, tres ceros", () => {
    expect(contarPorClase([])).toEqual({ error: 0, sin_dato: 0, ausente: 0 });
  });
});
