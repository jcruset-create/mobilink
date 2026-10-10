import { describe, expect, it, vi } from "vitest";

vi.mock("../../supabase.ts", () => ({ supabase: {} }));
const listMonthlyMileage = vi.fn();
vi.mock("../../integration-hub/infrastructure/repositories.ts", () => ({
  listMonthlyMileage: (...a: any[]) => listMonthlyMileage(...a),
}));

const { cotasDelMes } = await import("./datos.ts");

const FILA_OCTUBRE = { year: 2026, month: 10, sync_status: "ok", initial_odometer_km: 809524, final_odometer_km: 809910 };

describe("cotasDelMes", () => {
  it("del mes EN CURSO no da cota: su «final» es el de la última sincronización, no el del día 31", async () => {
    listMonthlyMileage.mockResolvedValue([FILA_OCTUBRE]);
    // 10 de octubre de 2026: octubre está abierto.
    const r = await cotasDelMes("plana", "v1", 2026, 10, new Date("2026-10-10T12:00:00Z"));
    expect(r).toBeNull();
    // Ni siquiera se pregunta al Hub.
    expect(listMonthlyMileage).not.toHaveBeenCalled();
  });

  it("de un mes cerrado sí, con sus dos extremos", async () => {
    listMonthlyMileage.mockResolvedValue([FILA_OCTUBRE]);
    const r = await cotasDelMes("plana", "v1", 2026, 10, new Date("2026-11-05T12:00:00Z"));
    expect(r).toEqual({ inicial: 809524, final: 809910 });
  });

  it("recién cambiado el mes todavía no: el proveedor cierra con retraso", async () => {
    listMonthlyMileage.mockResolvedValue([FILA_OCTUBRE]);
    // 00:30 de Madrid del 1 de noviembre (23:30 UTC del 31 de octubre).
    const r = await cotasDelMes("plana", "v1", 2026, 10, new Date("2026-10-31T23:30:00Z"));
    expect(r).toBeNull();
  });
});
