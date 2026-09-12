/**
 * Año en curso y media mensual, calculados en casa.
 *
 * Lo que se fija: que se suma lo guardado y no se pregunta a nadie; que el mes
 * en curso no entra en la media; que «sin datos» no es cero; y que la media
 * dice sobre cuántos meses está hecha.
 */

import { describe, expect, it } from "vitest";
import { resumirKilometraje } from "./resumen.ts";
import type { MonthlyMileageRow } from "../../integration-hub/infrastructure/repositories.ts";

function fila(year: number, month: number, km: number | null, over: Partial<MonthlyMileageRow> = {}): MonthlyMileageRow {
  return {
    id: month, tenant_id: "A", system: "movertis", account_key: "buses", mobilink_id: "v1", external_code: "E1",
    year, month, period_start_ms: 0, period_end_ms: 0, timezone: "Europe/Madrid",
    distance_km: km, initial_odometer_km: null, final_odometer_km: null, trips: null, source: "summarytrips",
    sync_status: km == null ? "empty" : "ok", closed: true, synced_at_ms: 1, last_error: null, ...over,
  };
}

const SEP_2026 = { year: 2026, month: 9 };

describe("resumirKilometraje()", () => {
  it("el ejemplo del enunciado: suma anual y media sobre los meses completos", () => {
    const r = resumirKilometraje([
      fila(2026, 1, 7842), fila(2026, 2, 8104), fila(2026, 3, 7536), fila(2026, 4, 8421),
    ], { year: 2026, month: 5 });
    expect(r.anioActual).toEqual({ year: 2026, km: 31903, mesesConDato: 4 });
    expect(r.mediaMensual).toEqual({ km: 7976, meses: 4 });
  });

  it("el mes en curso entra en el año pero NO en la media: va a medias", () => {
    const r = resumirKilometraje([fila(2026, 8, 8000), fila(2026, 9, 3824, { closed: false })], SEP_2026);
    expect(r.anioActual.km).toBe(11824);
    expect(r.mediaMensual).toEqual({ km: 8000, meses: 1 });
    expect(r.mesActual?.km).toBe(3824);
  });

  it("un mes «sin datos» no es un mes a cero: no baja la media ni cuenta como dato", () => {
    const r = resumirKilometraje([fila(2026, 7, 8000), fila(2026, 8, null)], SEP_2026);
    expect(r.mediaMensual).toEqual({ km: 8000, meses: 1 });
    expect(r.anioActual.mesesConDato).toBe(1);
  });

  it("un mes con error y sin km tampoco cuenta", () => {
    const r = resumirKilometraje([fila(2026, 8, null, { sync_status: "error", last_error: "503" })], SEP_2026);
    expect(r.mediaMensual.km).toBeNull();
    expect(r.meses[0].error).toBe("503");
  });

  it("el año anterior no entra en el año en curso, pero sí en la media (últimos 12 completos)", () => {
    const r = resumirKilometraje([fila(2025, 12, 6000), fila(2026, 1, 8000)], SEP_2026);
    expect(r.anioActual).toEqual({ year: 2026, km: 8000, mesesConDato: 1 });
    expect(r.mediaMensual).toEqual({ km: 7000, meses: 2 });
  });

  it("la media se queda en los doce últimos meses completos", () => {
    const filas = Array.from({ length: 20 }, (_, i) => fila(2024 + Math.floor((i) / 12), (i % 12) + 1, i < 8 ? 100 : 1000));
    const r = resumirKilometraje(filas, SEP_2026);
    expect(r.mediaMensual.meses).toBe(12);
    expect(r.mediaMensual.km).toBe(1000);
  });

  it("sin filas: nada, sin reventar", () => {
    const r = resumirKilometraje([], SEP_2026);
    expect(r.meses).toEqual([]);
    expect(r.mesActual).toBeNull();
    expect(r.anioActual).toEqual({ year: 2026, km: 0, mesesConDato: 0 });
    expect(r.mediaMensual).toEqual({ km: null, meses: 0 });
  });

  it("los meses salen del más reciente al más antiguo", () => {
    const r = resumirKilometraje([fila(2026, 1, 1), fila(2026, 3, 3), fila(2026, 2, 2)], SEP_2026);
    expect(r.meses.map((m) => m.month)).toEqual([3, 2, 1]);
  });
});
