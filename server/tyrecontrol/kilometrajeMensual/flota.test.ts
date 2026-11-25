import { describe, expect, it } from "vitest";

import { resumenDeFlota, type FilaMes } from "./flota.ts";

const fila = (p: Partial<FilaMes>): FilaMes => ({
  mobilink_id: "v1", system: "movertis", account_key: "default", year: 2026, month: 9,
  distance_km: 1000, initial_odometer_km: 10000, final_odometer_km: 11000, sync_status: "ok", closed: true, ...p,
});
const flota = new Set(["v1", "v2", "v3", "v4"]);
const NOV = { year: 2026, month: 11 };

describe("resumenDeFlota", () => {
  it("suma solo lo cerrado y creíble; lo demás va aparte", () => {
    const r = resumenDeFlota([
      fila({ mobilink_id: "v1" }),
      fila({ mobilink_id: "v2", distance_km: 500, closed: false }),                         // provisional
      fila({ mobilink_id: "v3", distance_km: 50000 }),                                       // incoherente
      fila({ mobilink_id: "v4", distance_km: null, sync_status: "error" }),                  // sin dato
    ], flota, NOV);
    expect(r.meses[0]).toMatchObject({
      kmAutenticos: 1000, vehiculosAutenticos: 1, kmProvisionales: 500, vehiculosProvisionales: 1,
      descartados: 1, kmDescartados: 50000, sinDato: 1, estado: "incompleto",
    });
    expect(r.meses[0].cuentasSinCerrar).toEqual([{ connectorKey: "movertis", accountKey: "default" }]);
  });

  it("sin odómetro que avance no se juzga: cuenta como auténtico", () => {
    const r = resumenDeFlota([fila({ initial_odometer_km: null, final_odometer_km: null, distance_km: 9000 })], flota, NOV);
    expect(r.meses[0].kmAutenticos).toBe(9000);
  });

  it("los vehículos que no son de la flota activa no cuentan", () => {
    const r = resumenDeFlota([fila({ mobilink_id: "otro" })], flota, NOV);
    expect(r.meses).toEqual([]);
  });

  it("el mismo vehículo y mes en dos cuentas se cuenta una vez, con la mejor fila", () => {
    const r = resumenDeFlota([
      fila({ account_key: "a", closed: false, distance_km: 300 }),
      fila({ account_key: "b", closed: true, distance_km: 1000 }),
    ], flota, NOV);
    expect(r.meses[0]).toMatchObject({ kmAutenticos: 1000, vehiculosAutenticos: 1, kmProvisionales: 0 });
  });

  it("el mes en curso es «en curso» y el año suma y promedia solo los cerrados", () => {
    const r = resumenDeFlota([
      fila({ month: 8, distance_km: 2000, final_odometer_km: 13000 }),
      fila({ month: 9, distance_km: 1000 }),
      fila({ month: 10, closed: false, distance_km: 400 }),
      fila({ month: 11, closed: false, distance_km: 700 }),
    ], flota, NOV);
    expect(r.meses.map((m) => m.estado)).toEqual(["cerrado", "cerrado", "incompleto", "en_curso"]);
    expect(r.meses[3].cuentasSinCerrar).toEqual([]);
    expect(r.anos).toEqual([{ year: 2026, kmAutenticos: 3000, mesesCerrados: 2, mediaMensual: 1500, kmProvisionales: 1100 }]);
  });
});
