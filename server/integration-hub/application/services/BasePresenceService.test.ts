/**
 * Pruebas del barrido de presencia en bases.
 *
 * La clasificación en sí se prueba aparte, sobre la función pura
 * (`domain/presencia.test.ts`). Lo que se fija aquí es lo que solo se ve al
 * juntar las piezas: que una cuenta caída no convierta su flota en «no se
 * sabe» borrando lo último conocido, que sin bases configuradas no se escriba
 * nada, y que un vehículo sin enlace se distinga de uno que el proveedor
 * simplemente no menciona.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { VehicleTelemetry } from "../../domain/telematics.ts";

vi.mock("../../connectors/ConnectorRegistry.ts", () => ({
  resolveTelematicsConnectors: vi.fn(),
}));
vi.mock("../../infrastructure/repositories.ts", () => ({
  listVehicleMappings: vi.fn(),
}));

const { resolveTelematicsConnectors } = await import("../../connectors/ConnectorRegistry.ts");
const { listVehicleMappings } = await import("../../infrastructure/repositories.ts");
const { barrerPresenciaBases } = await import("./BasePresenceService.ts");
const { ESTADOS_PRESENCIA } = await import("../../domain/presencia.ts");

const CTX = { tenantId: "plana", correlationId: "COR-1" };
const AHORA = new Date("2026-09-12T12:00:00Z");

const M_POR_GRADO = 111_320;
const distanciaMetros = (laA: number, lnA: number, laB: number, lnB: number) =>
  Math.hypot((laA - laB) * M_POR_GRADO, (lnA - lnB) * M_POR_GRADO * 0.75);
const alNorte = (lat: number, metros: number) => lat + metros / M_POR_GRADO;

const REUS = {
  id: "base-reus",
  nombre: "Reus",
  empresaId: "plana",
  lat: 41.128928,
  lng: 1.186083,
  radioM: 300,
};

/** Una cuenta que barre la flota, o revienta al intentarlo. */
function cuenta(
  key: string,
  accountKey: string,
  respuesta: VehicleTelemetry[] | Error,
  config: Record<string, unknown> = {},
) {
  return {
    key,
    accountKey,
    nombre: accountKey,
    usingDefault: false,
    config,
    connector: {
      getFleetPositions: vi.fn(async () => {
        if (respuesta instanceof Error) throw respuesta;
        return respuesta;
      }),
    },
  };
}

/** Una cuenta cuyo conector no sabe barrer la flota (Webfleet, hoy). */
function cuentaSinBarrido(key: string, accountKey: string) {
  return {
    key,
    accountKey,
    nombre: accountKey,
    usingDefault: false,
    config: {},
    connector: { listVehicles: vi.fn() },
  };
}

function posicion(externo: string, over: Partial<VehicleTelemetry> = {}): VehicleTelemetry {
  return {
    provider: "movertis",
    accountKey: "buses",
    providerVehicleId: externo,
    capturedAt: AHORA,
    latitude: alNorte(REUS.lat, 100),
    longitude: REUS.lng,
    positionAt: AHORA,
    ...over,
  };
}

function mapeo(mobilinkId: string, externo: string, over: Record<string, unknown> = {}) {
  return {
    id: 1,
    tenant_id: "plana",
    entity_type: "vehicle",
    system: "movertis",
    account_key: "buses",
    external_code: externo,
    mobilink_id: mobilinkId,
    active: true,
    metadata: null,
    last_seen_at_ms: null,
    ...over,
  };
}

const opciones = (over: Record<string, unknown> = {}) => ({
  leerBases: async () => [REUS],
  leerFlota: async () => [
    { id: "v1", matricula: "1234ABC", delegacionId: "base-reus", activo: true },
  ],
  distanciaMetros,
  ahora: AHORA,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listVehicleMappings).mockResolvedValue([] as any);
});

describe("barrerPresenciaBases()", () => {
  it("un vehículo enlazado con posición dentro de su base sale IN_BASE", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", [posicion("E1")]),
    ] as any);
    vi.mocked(listVehicleMappings).mockResolvedValue([mapeo("v1", "E1")] as any);

    const r = await barrerPresenciaBases(CTX, opciones());

    expect(r.estado).toBe("completo");
    expect(r.porEstado.IN_BASE).toBe(1);
    expect(r.filas[0].baseNombre).toBe("Reus");
    expect(r.filas[0].esSuBase).toBe(true);
    expect(r.filas[0].proveedor).toBe("movertis");
    expect(r.filas[0].externo).toBe("E1");
  });

  it("pregunta UNA vez por cuenta, no una por vehículo", async () => {
    const c = cuenta("movertis", "buses", [posicion("E1"), posicion("E2")]);
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([c] as any);
    vi.mocked(listVehicleMappings).mockResolvedValue([
      mapeo("v1", "E1"),
      mapeo("v2", "E2", { id: 2 }),
    ] as any);

    await barrerPresenciaBases(
      CTX,
      opciones({
        leerFlota: async () => [
          { id: "v1", matricula: "1234ABC", delegacionId: null, activo: true },
          { id: "v2", matricula: "5678DEF", delegacionId: null, activo: true },
        ],
      }),
    );

    expect(c.connector.getFleetPositions).toHaveBeenCalledTimes(1);
  });

  it("una cuenta caída NO borra el último estado de su flota: se omite", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", new Error("502 de la pasarela")),
    ] as any);
    vi.mocked(listVehicleMappings).mockResolvedValue([mapeo("v1", "E1")] as any);

    const r = await barrerPresenciaBases(CTX, opciones());

    expect(r.estado).toBe("incompleto");
    expect(r.omitidos).toBe(1);
    expect(r.filas).toHaveLength(0);
    expect(r.cuentas[0].error).toContain("502");
  });

  it("un conector que no sabe barrer la flota se aparta, no se consulta vehículo a vehículo", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuentaSinBarrido("webfleet", "default"),
    ] as any);
    vi.mocked(listVehicleMappings).mockResolvedValue([
      mapeo("v1", "E1", { system: "webfleet", account_key: "default" }),
    ] as any);

    const r = await barrerPresenciaBases(CTX, opciones());

    expect(r.estado).toBe("incompleto");
    expect(r.omitidos).toBe(1);
    expect(r.cuentas[0].error).toContain("no sabe dar la posición");
  });

  it("sin bases configuradas no se escribe nada ni se llama al proveedor", async () => {
    const c = cuenta("movertis", "buses", [posicion("E1")]);
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([c] as any);
    const guardar = vi.fn();

    const r = await barrerPresenciaBases(CTX, opciones({ leerBases: async () => [], guardar }));

    expect(r.estado).toBe("sin_bases");
    expect(guardar).not.toHaveBeenCalled();
    expect(c.connector.getFleetPositions).not.toHaveBeenCalled();
  });

  it("las bases de otra empresa no cuentan, ni para situar ni para existir", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", [posicion("E1")]),
    ] as any);
    vi.mocked(listVehicleMappings).mockResolvedValue([mapeo("v1", "E1")] as any);

    const r = await barrerPresenciaBases(
      CTX,
      opciones({ leerBases: async () => [{ ...REUS, empresaId: "otra-empresa" }] }),
    );

    expect(r.estado).toBe("sin_bases");
  });

  it("distingue el vehículo sin enlace del que el proveedor no menciona", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", []),
    ] as any);
    vi.mocked(listVehicleMappings).mockResolvedValue([mapeo("v1", "E1")] as any);

    const r = await barrerPresenciaBases(
      CTX,
      opciones({
        leerFlota: async () => [
          { id: "v1", matricula: "1234ABC", delegacionId: null, activo: true },
          { id: "v2", matricula: "5678DEF", delegacionId: null, activo: true },
        ],
      }),
    );

    expect(r.porEstado.NO_POSITION).toBe(2);
    expect(r.filas.find((f) => f.vehiculoId === "v1")?.motivo).toBe("proveedor_sin_dato");
    expect(r.filas.find((f) => f.vehiculoId === "v2")?.motivo).toBe("sin_enlace");
  });

  it("los vehículos inactivos no se barren", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", [posicion("E1")]),
    ] as any);
    vi.mocked(listVehicleMappings).mockResolvedValue([mapeo("v1", "E1")] as any);

    const r = await barrerPresenciaBases(
      CTX,
      opciones({
        leerFlota: async () => [
          { id: "v1", matricula: "1234ABC", delegacionId: null, activo: false },
        ],
      }),
    );

    expect(r.filas).toHaveLength(0);
  });

  it("un enlace desactivado no vale: el vehículo queda sin enlace", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", [posicion("E1")]),
    ] as any);
    vi.mocked(listVehicleMappings).mockResolvedValue([
      mapeo("v1", "E1", { active: false }),
    ] as any);

    const r = await barrerPresenciaBases(CTX, opciones());

    expect(r.porEstado.NO_POSITION).toBe(1);
    expect(r.filas[0].motivo).toBe("sin_enlace");
  });

  it("una cuenta puede apretar el umbral de antigüedad en su propia config", async () => {
    const hace30 = posicion("E1", {
      positionAt: new Date(AHORA.getTime() - 30 * 60_000),
      capturedAt: new Date(AHORA.getTime() - 30 * 60_000),
    });
    vi.mocked(listVehicleMappings).mockResolvedValue([mapeo("v1", "E1")] as any);

    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", [hace30]),
    ] as any);
    expect((await barrerPresenciaBases(CTX, opciones())).porEstado.IN_BASE).toBe(1);

    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", [hace30], { antiguedadMaxMin: 15 }),
    ] as any);
    const r = await barrerPresenciaBases(CTX, opciones());
    expect(r.porEstado.STALE_POSITION).toBe(1);
    expect(r.filas[0].estado).toBe(ESTADOS_PRESENCIA.STALE_POSITION);
  });

  it("guarda solo si se le da un escritor", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", [posicion("E1")]),
    ] as any);
    vi.mocked(listVehicleMappings).mockResolvedValue([mapeo("v1", "E1")] as any);

    const sinEscritor = await barrerPresenciaBases(CTX, opciones());
    expect(sinEscritor.filas).toHaveLength(1);

    const guardar = vi.fn();
    await barrerPresenciaBases(CTX, opciones({ guardar }));
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(guardar.mock.calls[0][0][0].tenantId).toBe("plana");
  });
});
