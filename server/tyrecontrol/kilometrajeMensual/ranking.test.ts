/**
 * El orden del ranking de kilómetros.
 *
 * Lo que se fija aquí es lo que hace que la lista signifique algo:
 *
 *   · Que NO se ordena por total, porque ganaría el que más meses tiene
 *     sincronizados en vez del que más rueda.
 *   · Que un mes `empty` no cuenta como cero. Un equipo apagado no es un
 *     autobús parado, y colarlo como cero hunde justo a los vehículos con
 *     peor cobertura de telemática.
 *   · Que un mes parado DE VERDAD sí cuenta: es `ok` con distancia cero.
 *   · Que un activo sin datos va a su propia sección, porque casi siempre es
 *     conciliación pendiente y no un autobús que no se mueve.
 */

import { describe, expect, it } from "vitest";
import { rankingDeKilometraje, type VehiculoDeFlota } from "./ranking.ts";
import type { MonthlyMileageRow } from "../../integration-hub/infrastructure/repositories.ts";

const ACTUAL = { year: 2026, month: 9 };

function fila(
  mobilinkId: string,
  year: number,
  month: number,
  km: number | null,
  estado: MonthlyMileageRow["sync_status"] = "ok",
): MonthlyMileageRow {
  return {
    id: 1, tenant_id: "emp-1", system: "movertis", account_key: "plana",
    mobilink_id: mobilinkId, external_code: "1", year, month,
    period_start_ms: 0, period_end_ms: 0, timezone: "Europe/Madrid",
    distance_km: km, initial_odometer_km: null, final_odometer_km: null,
    trips: null, source: "summarytrips", sync_status: estado, closed: true,
    synced_at_ms: 0, last_error: null,
  };
}

const bus = (id: string, n?: string): VehiculoDeFlota => ({
  id, matricula: id.toUpperCase(), numeroUnidad: n ?? null,
});

describe("rankingDeKilometraje()", () => {
  it("ordena por km/año, NO por total acumulado", () => {
    // `flojo` suma más kilómetros en total, pero sobre el doble de meses.
    const filas = [
      ...[1, 2, 3].map((m) => fila("fuerte", 2026, m, 10_000)),
      ...[1, 2, 3, 4, 5, 6].map((m) => fila("flojo", 2026, m, 6_000)),
    ];
    const r = rankingDeKilometraje(filas, [bus("fuerte"), bus("flojo")], ACTUAL);
    expect(r.vehiculos.map((v) => v.vehiculoId)).toEqual(["fuerte", "flojo"]);
    expect(r.vehiculos[0].kmAnual).toBe(120_000);
    expect(r.vehiculos[1].kmAnual).toBe(72_000);
    // Y el total, que es donde `flojo` gana, queda a la vista sin mandar.
    expect(r.vehiculos[1].kmAnioActual).toBe(36_000);
  });

  it("los meses que respaldan la cifra van SIEMPRE en la fila", () => {
    const filas = [...[1, 2, 3].map((m) => fila("a", 2026, m, 8_000))];
    const r = rankingDeKilometraje(filas, [bus("a")], ACTUAL);
    expect(r.vehiculos[0].meses).toBe(3);
  });

  it("un mes «sin datos» no es un cero y no hunde la media", () => {
    const conHueco = [
      fila("a", 2026, 1, 10_000),
      fila("a", 2026, 2, null, "empty"),
      fila("a", 2026, 3, 10_000),
    ];
    const r = rankingDeKilometraje(conHueco, [bus("a")], ACTUAL);
    // 20.000 sobre DOS meses, no sobre tres.
    expect(r.vehiculos[0].kmAnual).toBe(120_000);
    expect(r.vehiculos[0].meses).toBe(2);
    expect(r.vehiculos[0].mesesSinDato).toBe(1);
  });

  it("un mes parado de verdad SÍ cuenta: es `ok` con cero", () => {
    const filas = [
      fila("a", 2026, 1, 10_000),
      fila("a", 2026, 2, 0),
      fila("a", 2026, 3, 10_000),
    ];
    const r = rankingDeKilometraje(filas, [bus("a")], ACTUAL);
    expect(r.vehiculos[0].meses).toBe(3);
    expect(r.vehiculos[0].kmAnual).toBe(80_000);
  });

  it("un mes en error se cuenta aparte y no entra en la media", () => {
    const filas = [
      fila("a", 2026, 1, 10_000),
      fila("a", 2026, 2, null, "error"),
    ];
    const r = rankingDeKilometraje(filas, [bus("a")], ACTUAL);
    expect(r.vehiculos[0].meses).toBe(1);
    expect(r.vehiculos[0].mesesConError).toBe(1);
  });

  it("el mes EN CURSO no entra en la media: está a medias", () => {
    const filas = [
      fila("a", 2026, 8, 10_000),
      fila("a", 2026, 9, 1_200), // septiembre, el mes actual
    ];
    const r = rankingDeKilometraje(filas, [bus("a")], ACTUAL);
    expect(r.vehiculos[0].meses).toBe(1);
    expect(r.vehiculos[0].kmAnual).toBe(120_000);
    expect(r.vehiculos[0].kmMesActual).toBe(1_200);
  });

  it("un activo sin ninguna fila va a «sin datos», no como un 0 en la lista", () => {
    const r = rankingDeKilometraje([fila("a", 2026, 1, 10_000)], [bus("a"), bus("huerfano", "1352")], ACTUAL);
    expect(r.vehiculos.map((v) => v.vehiculoId)).toEqual(["a"]);
    expect(r.sinDatos).toEqual([{ vehiculoId: "huerfano", matricula: "HUERFANO", numeroUnidad: "1352" }]);
  });

  it("con filas pero sin ningún mes completo con dato, también va a «sin datos»", () => {
    const r = rankingDeKilometraje([fila("a", 2026, 1, null, "empty")], [bus("a")], ACTUAL);
    expect(r.vehiculos).toEqual([]);
    expect(r.sinDatos.map((v) => v.vehiculoId)).toEqual(["a"]);
  });

  it("a igual km/año, delante el que lo tiene medido sobre más meses", () => {
    const filas = [
      ...[1, 2, 3, 4, 5, 6].map((m) => fila("solido", 2026, m, 5_000)),
      ...[1].map((m) => fila("endeble", 2026, m, 5_000)),
    ];
    const r = rankingDeKilometraje(filas, [bus("endeble"), bus("solido")], ACTUAL);
    expect(r.vehiculos.map((v) => v.vehiculoId)).toEqual(["solido", "endeble"]);
  });

  it("los totales salen de los que tienen dato, no de la flota entera", () => {
    const filas = [
      ...[1, 2].map((m) => fila("a", 2026, m, 10_000)),
      ...[1, 2].map((m) => fila("b", 2026, m, 5_000)),
    ];
    const r = rankingDeKilometraje(filas, [bus("a"), bus("b"), bus("c")], ACTUAL);
    expect(r.totales).toEqual({ vehiculosConDato: 2, kmAnualTotal: 180_000, kmAnualMedio: 90_000 });
    expect(r.sinDatos).toHaveLength(1);
  });

  it("una flota vacía no revienta", () => {
    expect(rankingDeKilometraje([], [], ACTUAL)).toEqual({
      vehiculos: [], sinDatos: [],
      totales: { vehiculosConDato: 0, kmAnualTotal: 0, kmAnualMedio: null },
    });
  });
});
