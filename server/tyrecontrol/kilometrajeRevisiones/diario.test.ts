import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../integration-hub/infrastructure/repositories.ts", () => ({
  listTenantsWithConnectors: vi.fn(),
  getSyncState: vi.fn(),
  upsertSyncState: vi.fn(async () => undefined),
}));
vi.mock("../../integration-hub/connectors/ConnectorRegistry.ts", () => ({
  knownTelematicsConnectorKeys: () => ["movertis", "webfleet"],
}));
vi.mock("./worker.ts", () => ({
  estadoRellenoRevisiones: vi.fn(),
  iniciarRellenoRevisiones: vi.fn(),
}));

const { listTenantsWithConnectors, getSyncState, upsertSyncState } = await import(
  "../../integration-hub/infrastructure/repositories.ts"
);
const { estadoRellenoRevisiones, iniciarRellenoRevisiones } = await import("./worker.ts");
const { fechaLocal, ventanaDiaria, tocaHoy, tickRellenoDiario, DIAS_ATRAS } = await import("./diario.ts");

// Un jueves de octubre a las 09:00 en Madrid (07:00 UTC).
const MANANA = new Date("2026-10-09T07:00:00Z");

describe("ventanaDiaria", () => {
  it("va desde hace unos días hasta AYER, nunca hoy", () => {
    expect(ventanaDiaria(MANANA)).toEqual({ desde: "2026-10-06", hasta: "2026-10-08" });
    expect(DIAS_ATRAS).toBe(3);
  });

  it("cuenta en fecha LOCAL: a las 00:30 de Madrid ya es otro día aunque en UTC no", () => {
    // 22:30 UTC del 8 son las 00:30 del 9 en Madrid (verano, UTC+2).
    expect(fechaLocal(new Date("2026-10-08T22:30:00Z"))).toBe("2026-10-09");
    expect(ventanaDiaria(new Date("2026-10-08T22:30:00Z")).hasta).toBe("2026-10-08");
  });

  it("cruza el cambio de mes sin inventarse días", () => {
    expect(ventanaDiaria(new Date("2026-11-02T10:00:00Z"))).toEqual({ desde: "2026-10-30", hasta: "2026-11-01" });
  });
});

describe("tocaHoy", () => {
  it("antes de la hora, no: el día de ayer aún no está cerrado para el proveedor", () => {
    expect(tocaHoy(null, new Date("2026-10-09T03:00:00Z"))).toBe(false); // 05:00 Madrid
  });
  it("a la hora y sin haberse lanzado nunca, sí", () => {
    expect(tocaHoy(null, MANANA)).toBe(true);
  });
  it("si ya se lanzó hoy, no se repite por la tarde", () => {
    expect(tocaHoy(MANANA.getTime(), new Date("2026-10-09T21:00:00Z"))).toBe(false);
  });
  it("si lo último fue ayer, toca otra vez", () => {
    expect(tocaHoy(new Date("2026-10-08T07:00:00Z").getTime(), MANANA)).toBe(true);
  });
  it("un servidor reiniciado a las 11 lanza el de hoy si no lo hizo a las 7", () => {
    expect(tocaHoy(new Date("2026-10-08T07:00:00Z").getTime(), new Date("2026-10-09T09:00:00Z"))).toBe(true);
  });
});

describe("tickRellenoDiario", () => {
  beforeEach(() => {
    vi.mocked(listTenantsWithConnectors).mockReset();
    vi.mocked(getSyncState).mockReset();
    vi.mocked(upsertSyncState).mockClear();
    vi.mocked(estadoRellenoRevisiones).mockReset();
    vi.mocked(iniciarRellenoRevisiones).mockReset();
  });

  it("lanza el relleno de siempre, acotado a la ventana y marcado como diario", async () => {
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["plana"]);
    vi.mocked(getSyncState).mockResolvedValue(null as never);
    vi.mocked(estadoRellenoRevisiones).mockReturnValue(null);
    vi.mocked(iniciarRellenoRevisiones).mockResolvedValue({ estado: "en_curso", totalAlEmpezar: 42 } as never);

    const r = await tickRellenoDiario(MANANA);
    expect(r.lanzadas).toEqual(["plana"]);
    expect(iniciarRellenoRevisiones).toHaveBeenCalledWith({
      empresaId: "plana", desde: "2026-10-06", hasta: "2026-10-08", origen: "diario",
    });
    expect(upsertSyncState).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "plana", entity: "km_revisiones_diario", status: "lanzado",
    }));
  });

  it("no se repite el mismo día", async () => {
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["plana"]);
    vi.mocked(getSyncState).mockResolvedValue({ last_sync_ms: MANANA.getTime() } as never);

    const r = await tickRellenoDiario(new Date("2026-10-09T15:00:00Z"));
    expect(r.alDia).toBe(1);
    expect(iniciarRellenoRevisiones).not.toHaveBeenCalled();
  });

  it("si hay un relleno a mano en marcha, se espera en vez de pisarlo", async () => {
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["plana"]);
    vi.mocked(getSyncState).mockResolvedValue(null as never);
    vi.mocked(estadoRellenoRevisiones).mockReturnValue({ estado: "en_curso" } as never);

    const r = await tickRellenoDiario(MANANA);
    expect(r.ocupadas).toEqual(["plana"]);
    expect(iniciarRellenoRevisiones).not.toHaveBeenCalled();
    // Sin guardar nada: en la siguiente vuelta se vuelve a intentar.
    expect(upsertSyncState).not.toHaveBeenCalled();
  });

  it("sin nada que rellenar, cuenta como hecho y no gasta ni una petición más", async () => {
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["sinarco"]);
    vi.mocked(getSyncState).mockResolvedValue(null as never);
    vi.mocked(estadoRellenoRevisiones).mockReturnValue(null);
    vi.mocked(iniciarRellenoRevisiones).mockResolvedValue({ estado: "terminada", totalAlEmpezar: 0 } as never);

    const r = await tickRellenoDiario(MANANA);
    expect(r.vacias).toEqual(["sinarco"]);
    expect(upsertSyncState).toHaveBeenCalledWith(expect.objectContaining({ status: "sin_pendientes" }));
  });

  it("una empresa que falla no deja sin relleno a las demás", async () => {
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["rota", "plana"]);
    vi.mocked(getSyncState).mockResolvedValue(null as never);
    vi.mocked(estadoRellenoRevisiones).mockReturnValue(null);
    vi.mocked(iniciarRellenoRevisiones)
      .mockRejectedValueOnce(new Error("proveedor caído"))
      .mockResolvedValueOnce({ estado: "en_curso", totalAlEmpezar: 3 } as never);

    const r = await tickRellenoDiario(MANANA);
    expect(r.lanzadas).toEqual(["plana"]);
  });
});

describe("estadoRellenoDiario", () => {
  it("dice que el reloj se quedó esperando por otro relleno, y por qué", async () => {
    const { estadoRellenoDiario, olvidarVueltasDiario } = await import("./diario.ts");
    olvidarVueltasDiario();
    vi.mocked(listTenantsWithConnectors).mockResolvedValue(["plana"]);
    vi.mocked(getSyncState).mockResolvedValue(null);
    vi.mocked(estadoRellenoRevisiones).mockReturnValue({ estado: "en_curso", origen: "manual", escritas: 0, totalAlEmpezar: 3989 } as any);

    await tickRellenoDiario(MANANA);
    const e = await estadoRellenoDiario("plana", MANANA);
    expect(e.lanzadoHoy).toBe(false);
    expect(e.ultimoLanzamientoMs).toBeNull();
    expect(e.ultimaVuelta?.resultado).toBe("ocupada");
    expect(e.ultimaVuelta?.detalle).toContain("del histórico");
    expect(e.ultimaVuelta?.detalle).toContain("3989");
  });

  it("lee de la base el último lanzamiento y su ventana", async () => {
    const { estadoRellenoDiario } = await import("./diario.ts");
    vi.mocked(getSyncState).mockResolvedValue({
      last_sync_ms: MANANA.getTime(), detail: JSON.stringify({ desde: "2026-10-06", hasta: "2026-10-08", pendientes: 42 }),
    } as any);
    const e = await estadoRellenoDiario("plana", new Date(MANANA.getTime() + 3600_000));
    expect(e.lanzadoHoy).toBe(true);
    expect(e.ventana).toEqual({ desde: "2026-10-06", hasta: "2026-10-08" });
    expect(e.pendientesAlLanzar).toBe(42);
  });
});
