/**
 * Cuándo dispara el job diario.
 *
 * Lo que se fija: nunca pasado → ya; hace poco → no; hace un día → solo de
 * madrugada en hora de Madrid; y que un cliente que falla no deja sin pasada
 * a los siguientes ni mueve su marca.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../infrastructure/repositories.ts", () => ({
  getSyncState: vi.fn(),
  listTenantsWithConnectors: vi.fn(),
  upsertSyncState: vi.fn(),
}));
vi.mock("../connectors/ConnectorRegistry.ts", () => ({ knownTelematicsConnectorKeys: () => ["movertis"] }));
vi.mock("../application/services/MonthlyMileageSyncService.ts", () => ({ syncMonthlyMileage: vi.fn() }));

const { getSyncState, listTenantsWithConnectors, upsertSyncState } = await import("../infrastructure/repositories.ts");
const { syncMonthlyMileage } = await import("../application/services/MonthlyMileageSyncService.ts");
const { tocaAhora, tickMonthlyMileage, ENTIDAD_JOB } = await import("./MonthlyMileageWorker.ts");

const DIA = 24 * 3_600_000;
/** 03:30 de Madrid en verano = 01:30 UTC. */
const MADRUGADA = new Date("2026-09-12T01:30:00Z");
/** 12:00 de Madrid. */
const MEDIODIA = new Date("2026-09-12T10:00:00Z");

describe("tocaAhora()", () => {
  it("nunca se ha pasado: ya, sea la hora que sea", () => {
    expect(tocaAhora(null, MEDIODIA)).toBe(true);
  });

  it("hace menos de 20 h: no, ni de madrugada", () => {
    expect(tocaAhora(MADRUGADA.getTime() - 3 * 3_600_000, MADRUGADA)).toBe(false);
  });

  it("hace un día y es de madrugada en Madrid: sí", () => {
    expect(tocaAhora(MADRUGADA.getTime() - DIA, MADRUGADA)).toBe(true);
  });

  it("hace un día pero es mediodía: no, se espera a la madrugada", () => {
    expect(tocaAhora(MEDIODIA.getTime() - DIA, MEDIODIA)).toBe(false);
  });

  it("la ventana es en hora LOCAL: a la 01:30 UTC de invierno son las 02:30, dentro", () => {
    const invierno = new Date("2026-01-12T01:30:00Z");
    expect(tocaAhora(invierno.getTime() - DIA, invierno)).toBe(true);
    // Pero a las 00:30 UTC de invierno es la 01:30: fuera.
    const antes = new Date("2026-01-12T00:30:00Z");
    expect(tocaAhora(antes.getTime() - DIA, antes)).toBe(false);
  });
});

describe("tickMonthlyMileage()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(upsertSyncState).mockResolvedValue(undefined);
    vi.mocked(syncMonthlyMileage).mockResolvedValue({ correlationId: "COR-1", cuentas: [] });
  });

  it("pasa a quien le toca y le mueve la marca", async () => {
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["A"]);
    vi.mocked(getSyncState).mockResolvedValue(null);

    const r = await tickMonthlyMileage(MEDIODIA);

    expect(r.pasados).toEqual(["A"]);
    expect(syncMonthlyMileage).toHaveBeenCalledWith({ tenantId: "A", ahora: MEDIODIA });
    expect(upsertSyncState).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "A", entity: ENTIDAD_JOB, lastSyncMs: MEDIODIA.getTime(), status: "ok",
    }));
  });

  it("omite a quien se pasó hace poco sin llamar al proveedor", async () => {
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["A"]);
    vi.mocked(getSyncState).mockResolvedValue({ last_sync_ms: MEDIODIA.getTime() - 3_600_000 } as any);

    const r = await tickMonthlyMileage(MEDIODIA);

    expect(r).toEqual({ pasados: [], omitidos: 1 });
    expect(syncMonthlyMileage).not.toHaveBeenCalled();
  });

  it("un cliente que revienta no deja sin pasada a los siguientes ni mueve su marca", async () => {
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["mala", "buena"]);
    vi.mocked(getSyncState).mockResolvedValue(null);
    vi.mocked(syncMonthlyMileage).mockImplementation(async ({ tenantId }) => {
      if (tenantId === "mala") throw new Error("se cayó la base");
      return { correlationId: "COR-1", cuentas: [] };
    });

    const r = await tickMonthlyMileage(MEDIODIA);

    expect(r.pasados).toEqual(["buena"]);
    const marcas = vi.mocked(upsertSyncState).mock.calls.map((c) => c[0].tenantId);
    expect(marcas).toEqual(["buena"]);
  });

  it("una cuenta abandonada deja la marca en error, pero la marca se mueve: no se martillea", async () => {
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["A"]);
    vi.mocked(getSyncState).mockResolvedValue(null);
    vi.mocked(syncMonthlyMileage).mockResolvedValue({
      correlationId: "COR-1",
      cuentas: [{ abandonada: "AUTH: HTTP 401", connectorKey: "movertis", accountKey: "buses" } as any],
    });

    await tickMonthlyMileage(MEDIODIA);

    expect(upsertSyncState).toHaveBeenCalledWith(expect.objectContaining({ status: "error", lastSyncMs: MEDIODIA.getTime() }));
  });
});
