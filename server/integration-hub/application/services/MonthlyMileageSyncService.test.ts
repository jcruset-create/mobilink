/**
 * La sincronización mensual, con el proveedor y la base fingidos.
 *
 * Lo que se fija es lo que separa una sincronización que cuida al proveedor de
 * una que lo tumba: varios vehículos por petición, un mes por ventana, no
 * volver a pedir lo cerrado, seguir tras un lote que falla y PARAR cuando la
 * credencial está rechazada. Y que lo que se guarda es idempotente: la misma
 * fila, no una nueva.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../connectors/ConnectorRegistry.ts", () => ({ resolveTelematicsConnectors: vi.fn() }));
vi.mock("../../infrastructure/repositories.ts", () => ({
  listVehicleMappings: vi.fn(),
  listVehiclesWithClosedMonth: vi.fn(),
  nextCorrelationId: vi.fn(async () => "COR-1"),
  upsertMonthlyMileage: vi.fn(),
  upsertSyncState: vi.fn(),
}));
vi.mock("../../infrastructure/ritmo.ts", () => {
  const turnos: number[] = [];
  return {
    limitadorDe: () => ({ turno: async () => { turnos.push(Date.now()); } }),
    __turnos: turnos,
  };
});

const { resolveTelematicsConnectors } = await import("../../connectors/ConnectorRegistry.ts");
const { listVehicleMappings, listVehiclesWithClosedMonth, upsertMonthlyMileage, upsertSyncState } =
  await import("../../infrastructure/repositories.ts");
const { IntegrationError } = await import("../../domain/errors.ts");
const { syncMonthlyMileage, mesesQueTocan, entidadSyncDe } = await import("./MonthlyMileageSyncService.ts");

const AHORA = new Date("2026-09-12T10:00:00Z");

/** Enlaces v1..vN ↔ E1..EN. */
function enlaces(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1, tenant_id: "empresa-A", entity_type: "vehicle", system: "movertis", account_key: "buses",
    mobilink_id: `v${i + 1}`, external_code: `E${i + 1}`, active: true, metadata: null,
  }));
}

/** Un conector que resume lo que se le pida, o revienta. */
function cuenta(opciones: {
  config?: Record<string, unknown>;
  responder?: (ids: string[], w: { from: Date; to: Date }) => any[];
  fallo?: unknown;
  sinCapacidad?: boolean;
}) {
  const llamadas: Array<{ ids: string[]; from: Date; to: Date }> = [];
  const connector: any = opciones.sinCapacidad ? {} : {
    getTripSummary: vi.fn(async (_ctx: any, ids: string[], w: { from: Date; to: Date }) => {
      llamadas.push({ ids, from: w.from, to: w.to });
      if (opciones.fallo) throw opciones.fallo;
      return (opciones.responder ?? ((ids2) => ids2.map((id) => ({
        provider: "movertis", accountKey: "buses", providerVehicleId: id, window: w, distanceKm: 100,
      }))))(ids, w);
    }),
  };
  vi.mocked(resolveTelematicsConnectors).mockResolvedValue([{
    key: "movertis", accountKey: "buses", nombre: "Autobuses", usingDefault: false,
    config: opciones.config ?? {}, connector,
  }] as any);
  return llamadas;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listVehiclesWithClosedMonth).mockResolvedValue(new Set());
  vi.mocked(upsertMonthlyMileage).mockResolvedValue(undefined);
  vi.mocked(upsertSyncState).mockResolvedValue(undefined);
});

describe("lotes y ventanas", () => {
  it("agrupa varios vehículos en UNA petición, según el tamaño configurado", async () => {
    const llamadas = cuenta({ config: { unidadesPorPeticion: 10 } });
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(23) as any);

    const r = await syncMonthlyMileage({
      tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA,
    });

    expect(llamadas.map((l) => l.ids.length)).toEqual([10, 10, 3]);
    expect(r.cuentas[0].peticiones).toBe(3);
    expect(r.cuentas[0].lotes).toBe(3);
    expect(r.cuentas[0].vehiculosProcesados).toBe(23);
  });

  it("sin configurar, 25 por petición; con un valor absurdo, tope de 100", async () => {
    const l1 = cuenta({});
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(30) as any);
    await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });
    expect(l1.map((l) => l.ids.length)).toEqual([25, 5]);

    const l2 = cuenta({ config: { unidadesPorPeticion: 5000 } });
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(150) as any);
    await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });
    expect(l2.map((l) => l.ids.length)).toEqual([100, 50]);
  });

  it("cada mes es UNA ventana, cortada en la zona de la cuenta", async () => {
    const llamadas = cuenta({});
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(1) as any);

    await syncMonthlyMileage({
      tenantId: "empresa-A", forzar: true,
      meses: [{ year: 2026, month: 1 }, { year: 2026, month: 2 }, { year: 2026, month: 3 }], ahora: AHORA,
    });

    expect(llamadas).toHaveLength(3);
    expect(llamadas[0].from.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(llamadas[0].to.toISOString()).toBe("2026-01-31T23:00:00.000Z");
    // Nunca un rango de tres meses: cada llamada dura como mucho un mes.
    for (const l of llamadas) {
      expect(l.to.getTime() - l.from.getTime()).toBeLessThanOrEqual(31 * 24 * 3_600_000 + 3_600_000);
    }
  });

  it("respeta la zona horaria de la config de la cuenta", async () => {
    const llamadas = cuenta({ config: { zonaHoraria: "UTC" } });
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(1) as any);
    await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });
    expect(llamadas[0].from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("pide turno al limitador antes de CADA petición", async () => {
    cuenta({ config: { unidadesPorPeticion: 1 } });
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(4) as any);
    const ritmo: any = await import("../../infrastructure/ritmo.ts");
    const antes = ritmo.__turnos.length;
    await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });
    expect(ritmo.__turnos.length - antes).toBe(4);
  });
});

describe("meses cerrados", () => {
  it("un mes terminado no se vuelve a pedir a quien ya lo tiene cerrado", async () => {
    const llamadas = cuenta({});
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(3) as any);
    vi.mocked(listVehiclesWithClosedMonth).mockResolvedValue(new Set(["v1", "v2"]));

    await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 8 }], ahora: AHORA });

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].ids).toEqual(["E3"]);
  });

  it("si todos lo tienen cerrado, no se hace ninguna petición", async () => {
    const llamadas = cuenta({});
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(2) as any);
    vi.mocked(listVehiclesWithClosedMonth).mockResolvedValue(new Set(["v1", "v2"]));
    const r = await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 8 }], ahora: AHORA });
    expect(llamadas).toHaveLength(0);
    expect(r.cuentas[0].peticiones).toBe(0);
  });

  it("el mes en curso se pide siempre y NO se marca cerrado", async () => {
    cuenta({});
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(1) as any);
    vi.mocked(listVehiclesWithClosedMonth).mockResolvedValue(new Set(["v1"]));

    await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });

    expect(listVehiclesWithClosedMonth).not.toHaveBeenCalled();
    expect(vi.mocked(upsertMonthlyMileage).mock.calls[0][0]).toMatchObject({ year: 2026, month: 9, closed: false });
  });

  it("un mes terminado, pedido después del margen, se guarda cerrado", async () => {
    cuenta({});
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(1) as any);
    await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 8 }], ahora: AHORA });
    expect(vi.mocked(upsertMonthlyMileage).mock.calls[0][0]).toMatchObject({ month: 8, closed: true, syncStatus: "ok" });
  });

  it("con `forzar` se vuelve a pedir aunque esté cerrado", async () => {
    const llamadas = cuenta({});
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(1) as any);
    vi.mocked(listVehiclesWithClosedMonth).mockResolvedValue(new Set(["v1"]));
    await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 8 }], forzar: true, ahora: AHORA });
    expect(llamadas).toHaveLength(1);
  });

  it("mesesQueTocan(): el en curso, el anterior y el histórico, en ese orden", () => {
    const m = mesesQueTocan(AHORA, "Europe/Madrid", 3);
    expect(m).toEqual([
      { year: 2026, month: 9 }, { year: 2026, month: 8 }, { year: 2026, month: 7 }, { year: 2026, month: 6 },
    ]);
  });
});

describe("lo que se guarda", () => {
  it("una fila por vehículo y mes, con la unidad de la que salió", async () => {
    cuenta({
      responder: (ids, w) => [{
        provider: "movertis", accountKey: "buses", providerVehicleId: "E1", window: w,
        distanceKm: 7842.1234, initialOdometerKm: 512480, finalOdometerKm: 520322, trips: 41,
      }],
    });
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(1) as any);

    await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });

    expect(upsertMonthlyMileage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "empresa-A", system: "movertis", accountKey: "buses", mobilinkId: "v1", externalCode: "E1",
      year: 2026, month: 9, distanceKm: 7842.123, initialOdometerKm: 512480, finalOdometerKm: 520322, trips: 41,
      source: "summarytrips", syncStatus: "ok", timezone: "Europe/Madrid",
      periodStartMs: 1788213600000, periodEndMs: 1790805600000,
    }));
  });

  it("un vehículo del que el proveedor no dice nada queda como «sin datos», NO como 0 km", async () => {
    cuenta({ responder: () => [] });
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(1) as any);

    const r = await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });

    expect(upsertMonthlyMileage).toHaveBeenCalledWith(expect.objectContaining({ distanceKm: null, syncStatus: "empty" }));
    expect(r.cuentas[0].vehiculosSinDatos).toBe(1);
    expect(r.cuentas[0].vehiculosConKm).toBe(0);
  });

  it("solo los vehículos pedidos, cuando se acota", async () => {
    const llamadas = cuenta({});
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(5) as any);
    await syncMonthlyMileage({
      tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], mobilinkIds: ["v2", "v4"], ahora: AHORA,
    });
    expect(llamadas[0].ids).toEqual(["E2", "E4"]);
  });

  it("los enlaces desactivados no se preguntan", async () => {
    const llamadas = cuenta({});
    vi.mocked(listVehicleMappings).mockResolvedValue([
      ...enlaces(1), { ...enlaces(2)[1], active: false },
    ] as any);
    await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });
    expect(llamadas[0].ids).toEqual(["E1"]);
  });

  it("suma los km de la flota y lo deja en la auditoría, sin tokens", async () => {
    cuenta({});
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(3) as any);

    const r = await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });

    expect(r.cuentas[0].kmTotales).toBe(300);
    const audit = vi.mocked(upsertSyncState).mock.calls[0][0];
    expect(audit.entity).toBe(entidadSyncDe("movertis", "buses"));
    expect(audit.status).toBe("ok");
    const detalle = JSON.parse(audit.detail!);
    expect(detalle).toMatchObject({ vehiculosEnlazados: 3, peticiones: 1, kmTotales: 300, errores: 0 });
    expect(JSON.stringify(detalle)).not.toMatch(/token|secret/i);
  });
});

describe("errores", () => {
  it("un lote que falla se anota en sus vehículos y se sigue con el siguiente", async () => {
    let n = 0;
    cuenta({ config: { unidadesPorPeticion: 2 } });
    const conector: any = (await vi.mocked(resolveTelematicsConnectors).mock.results[0]?.value) ?? null;
    void conector;
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([{
      key: "movertis", accountKey: "buses", nombre: null, usingDefault: false, config: { unidadesPorPeticion: 2 },
      connector: {
        getTripSummary: vi.fn(async (_c: any, ids: string[], w: any) => {
          if (++n === 1) throw IntegrationError.transient("MOVERTIS_UNAVAILABLE", "HTTP 503");
          return ids.map((id) => ({ provider: "movertis", accountKey: "buses", providerVehicleId: id, window: w, distanceKm: 1 }));
        }),
      },
    }] as any);
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(4) as any);

    const r = await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });

    expect(r.cuentas[0].peticiones).toBe(2);
    expect(r.cuentas[0].errores).toBe(2);           // dos vehículos del lote caído
    expect(r.cuentas[0].vehiculosConKm).toBe(2);
    expect(r.cuentas[0].abandonada).toBeUndefined();
    const errores = vi.mocked(upsertMonthlyMileage).mock.calls.filter((c) => c[0].syncStatus === "error");
    expect(errores).toHaveLength(2);
    expect(errores[0][0].lastError).toContain("503");
    expect(errores[0][0].closed).toBe(false);
    expect(vi.mocked(upsertSyncState).mock.calls[0][0].status).toBe("partial");
  });

  it("cinco lotes seguidos rechazados: se abandona la pasada en vez de martillear", async () => {
    // Lo visto en producción: «Core Error: 4» a todo. Sin cortacircuito, las
    // 400 peticiones restantes habrían salido igual, fallando todas.
    const llamadas = cuenta({
      config: { unidadesPorPeticion: 1 },
      fallo: IntegrationError.permanent("MOVERTIS_PETICION", "Movertis rechazó la petición: Core Error: 4"),
    });
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(40) as any);

    const r = await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });

    expect(llamadas).toHaveLength(5);
    expect(r.cuentas[0].abandonada).toContain("5 lotes seguidos");
    expect(r.cuentas[0].abandonada).toContain("Core Error: 4");
    expect(r.cuentas[0].vehiculosProcesados).toBe(5);
    expect(vi.mocked(upsertSyncState).mock.calls[0][0].status).toBe("error");
  });

  it("un lote bueno entre medias reinicia la cuenta de fallos seguidos", async () => {
    let n = 0;
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([{
      key: "movertis", accountKey: "buses", nombre: null, usingDefault: false, config: { unidadesPorPeticion: 1 },
      connector: {
        getTripSummary: vi.fn(async (_c: any, ids: string[], w: any) => {
          // Falla 4, acierta 1, falla 4, acierta 1: nunca cinco seguidos.
          if (++n % 5 !== 0) throw IntegrationError.permanent("MOVERTIS_PETICION", "Core Error: 4");
          return ids.map((id) => ({ provider: "movertis", accountKey: "buses", providerVehicleId: id, window: w, distanceKm: 1 }));
        }),
      },
    }] as any);
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(10) as any);

    const r = await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });

    expect(r.cuentas[0].abandonada).toBeUndefined();
    expect(r.cuentas[0].peticiones).toBe(10);
    expect(r.cuentas[0].vehiculosConKm).toBe(2);
  });

  it("con la credencial rechazada se abandona la cuenta: seguir es quemar cupo", async () => {
    const llamadas = cuenta({ config: { unidadesPorPeticion: 1 }, fallo: IntegrationError.auth("MOVERTIS_AUTH", "HTTP 401") });
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(5) as any);

    const r = await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });

    expect(llamadas).toHaveLength(1);
    expect(r.cuentas[0].abandonada).toContain("401");
    expect(vi.mocked(upsertSyncState).mock.calls[0][0].status).toBe("error");
  });

  it("una cuenta sin capacidad de resumen se salta y lo dice", async () => {
    cuenta({ sinCapacidad: true });
    vi.mocked(listVehicleMappings).mockResolvedValue(enlaces(1) as any);
    const r = await syncMonthlyMileage({ tenantId: "empresa-A", meses: [{ year: 2026, month: 9 }], ahora: AHORA });
    expect(r.cuentas[0].abandonada).toContain("trip-summary");
    expect(upsertMonthlyMileage).not.toHaveBeenCalled();
  });

  it("sin enlaces no hay peticiones", async () => {
    const llamadas = cuenta({});
    vi.mocked(listVehicleMappings).mockResolvedValue([]);
    const r = await syncMonthlyMileage({ tenantId: "empresa-A", ahora: AHORA });
    expect(llamadas).toHaveLength(0);
    expect(r.cuentas[0].vehiculosEnlazados).toBe(0);
  });

  it("acotar a una cuenta deja fuera a las demás", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      { key: "movertis", accountKey: "buses", nombre: null, config: {}, connector: { getTripSummary: vi.fn(async () => []) } },
      { key: "movertis", accountKey: "auxiliar", nombre: null, config: {}, connector: { getTripSummary: vi.fn(async () => []) } },
    ] as any);
    vi.mocked(listVehicleMappings).mockResolvedValue([]);
    const r = await syncMonthlyMileage({ tenantId: "empresa-A", connectorKey: "movertis", accountKey: "auxiliar", ahora: AHORA });
    expect(r.cuentas.map((c) => c.accountKey)).toEqual(["auxiliar"]);
  });
});
