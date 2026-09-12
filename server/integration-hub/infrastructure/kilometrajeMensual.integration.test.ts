/**
 * Kilómetros mensuales contra PostgreSQL de verdad.
 *
 * Lo que solo se puede probar con la base: que la UNIQUE deja una fila por
 * vehículo y mes se escriba las veces que se escriba, que un error no pisa un
 * dato bueno, y que «cerrado» se consulta como se espera.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../../db.ts").default;
let repo: typeof import("./repositories.ts");

const TENANT = "test-km-mensual";

function fila(over: Partial<import("./repositories.ts").MonthlyMileageUpsert> = {}): import("./repositories.ts").MonthlyMileageUpsert {
  return {
    tenantId: TENANT, system: "movertis", accountKey: "buses", mobilinkId: "veh-1", externalCode: "E1",
    year: 2026, month: 9, periodStartMs: 1788213600000, periodEndMs: 1790805600000, timezone: "Europe/Madrid",
    distanceKm: 3824, source: "summarytrips", syncStatus: "ok", closed: false, ...over,
  };
}

describe.skipIf(!RUN)("Kilómetros mensuales", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    const { initDb } = await import("../../db.ts");
    await initDb();
    const { initIntegrationHub } = await import("../index.ts");
    await initIntegrationHub();
    repo = await import("./repositories.ts");
    await db.query(`DELETE FROM integration_vehicle_monthly_mileage WHERE tenant_id = $1`, [TENANT]);
  });

  afterAll(async () => {
    if (!RUN) return;
    await db.query(`DELETE FROM integration_vehicle_monthly_mileage WHERE tenant_id = $1`, [TENANT]).catch(() => {});
  });

  it("sincronizar septiembre tres veces deja UNA fila con el último valor", async () => {
    await repo.upsertMonthlyMileage(fila({ distanceKm: 3824 }));
    await repo.upsertMonthlyMileage(fila({ distanceKm: 6734 }));
    await repo.upsertMonthlyMileage(fila({ distanceKm: 9218 }));

    const filas = await repo.listMonthlyMileage({ tenantId: TENANT, mobilinkId: "veh-1" });
    expect(filas).toHaveLength(1);
    expect(filas[0].distance_km).toBe(9218);
    expect(filas[0].sync_status).toBe("ok");
  });

  it("un error posterior NO pisa el dato bueno: se anota aparte", async () => {
    await repo.upsertMonthlyMileage(fila({ distanceKm: 9218, closed: true }));
    await repo.upsertMonthlyMileage(fila({ distanceKm: null, syncStatus: "error", closed: false, lastError: "HTTP 503" }));

    const [f] = await repo.listMonthlyMileage({ tenantId: TENANT, mobilinkId: "veh-1" });
    expect(f.distance_km).toBe(9218);
    expect(f.sync_status).toBe("ok");
    expect(f.closed).toBe(true);
    expect(f.last_error).toBe("HTTP 503");
  });

  it("un dato bueno después de un error limpia el error", async () => {
    await repo.upsertMonthlyMileage(fila({ distanceKm: 9300, lastError: null }));
    const [f] = await repo.listMonthlyMileage({ tenantId: TENANT, mobilinkId: "veh-1" });
    expect(f.distance_km).toBe(9300);
    expect(f.last_error).toBeNull();
  });

  it("otra cuenta del mismo vehículo es otra fila; otro cliente ni se ve", async () => {
    await repo.upsertMonthlyMileage(fila({ accountKey: "auxiliar", distanceKm: 1 }));
    await repo.upsertMonthlyMileage(fila({ tenantId: "otro-cliente", distanceKm: 99 }));

    const filas = await repo.listMonthlyMileage({ tenantId: TENANT, mobilinkId: "veh-1" });
    expect(filas.map((f) => [f.account_key, f.distance_km]).sort()).toEqual([["auxiliar", 1], ["buses", 9300]]);
    await db.query(`DELETE FROM integration_vehicle_monthly_mileage WHERE tenant_id = 'otro-cliente'`);
  });

  it("los meses salen del más reciente al más antiguo", async () => {
    await repo.upsertMonthlyMileage(fila({ mobilinkId: "veh-2", year: 2026, month: 1, distanceKm: 1 }));
    await repo.upsertMonthlyMileage(fila({ mobilinkId: "veh-2", year: 2025, month: 12, distanceKm: 2 }));
    await repo.upsertMonthlyMileage(fila({ mobilinkId: "veh-2", year: 2026, month: 3, distanceKm: 3 }));
    const filas = await repo.listMonthlyMileage({ tenantId: TENANT, mobilinkId: "veh-2" });
    expect(filas.map((f) => `${f.year}-${f.month}`)).toEqual(["2026-3", "2026-1", "2025-12"]);
  });

  it("listVehiclesWithClosedMonth() devuelve solo los cerrados de ESE mes y cuenta", async () => {
    await repo.upsertMonthlyMileage(fila({ mobilinkId: "veh-3", month: 8, closed: true }));
    await repo.upsertMonthlyMileage(fila({ mobilinkId: "veh-4", month: 8, closed: false }));
    await repo.upsertMonthlyMileage(fila({ mobilinkId: "veh-5", month: 7, closed: true }));
    await repo.upsertMonthlyMileage(fila({ mobilinkId: "veh-6", month: 8, closed: true, accountKey: "auxiliar" }));

    const cerrados = await repo.listVehiclesWithClosedMonth({
      tenantId: TENANT, system: "movertis", accountKey: "buses", year: 2026, month: 8,
    });
    expect([...cerrados].sort()).toEqual(["veh-3"]);
  });

  it("un mes fuera de 1..12 lo rechaza la base", async () => {
    await expect(repo.upsertMonthlyMileage(fila({ month: 13 }))).rejects.toThrow(/check|month/i);
  });
});
