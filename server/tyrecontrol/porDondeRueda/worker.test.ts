import { describe, expect, it, vi } from "vitest";

vi.mock("../../supabase.ts", () => ({ supabase: {} }));
vi.mock("./servicio.ts", () => ({ analizarDia: vi.fn() }));

const { diasAMirar, pendientes } = await import("./worker.ts");

describe("diasAMirar", () => {
  it("de ayer hacia atrás, en hora de Madrid", () => {
    // 23:30 UTC del 24 ya es día 25 en Madrid.
    expect(diasAMirar(new Date("2026-11-24T23:30:00Z"), "Europe/Madrid", 3)).toEqual(["2026-11-24", "2026-11-23", "2026-11-22"]);
    expect(diasAMirar(new Date("2026-12-01T08:00:00Z"), "Europe/Madrid", 2)).toEqual(["2026-11-30", "2026-11-29"]);
  });
});

describe("pendientes", () => {
  const ahora = new Date("2026-11-25T07:00:00Z");
  const v = [{ vehiculo_id: "a", empresa_id: "e" }, { vehiculo_id: "b", empresa_id: "e" }];
  it("salta lo hecho y los errores recientes; reintenta los viejos", () => {
    const hechos = [
      { vehiculo_id: "a", fecha: "2026-11-24", estado: "ok", procesado_at: "2026-11-25T06:00:00Z" },
      { vehiculo_id: "b", fecha: "2026-11-24", estado: "error", procesado_at: "2026-11-25T06:00:00Z" },
      { vehiculo_id: "a", fecha: "2026-11-23", estado: "error", procesado_at: "2026-11-24T06:00:00Z" },
      { vehiculo_id: "b", fecha: "2026-11-23", estado: "sin_puntos", procesado_at: "2026-11-24T06:00:00Z" },
    ];
    expect(pendientes(v, ["2026-11-24", "2026-11-23", "2026-11-22"], hechos, ahora).map((p) => `${p.vehiculo_id} ${p.fecha}`))
      .toEqual(["a 2026-11-23", "a 2026-11-22", "b 2026-11-22"]);
  });
});
