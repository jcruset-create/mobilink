/**
 * Pruebas de la orquestación de la conciliación.
 *
 * La clasificación en sí se prueba aparte, sobre la función pura
 * (`domain/reconciliation.test.ts`). Lo que se fija aquí es lo que solo se ve
 * al juntar varias cuentas: que un fallo de una no contamine a las otras, que
 * `last_seen_at` no se toque cuando no se debe, y que los vehículos de una
 * cuenta caída se aparten en vez de acabar en la lista de candidatos a baja.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ProviderVehicle } from "../../domain/telematics.ts";

vi.mock("../../connectors/ConnectorRegistry.ts", () => ({
  resolveTelematicsConnectors: vi.fn(),
}));
vi.mock("../../infrastructure/repositories.ts", () => ({
  listVehicleMappings: vi.fn(),
  listIgnoredExternals: vi.fn(),
  touchVehiclesLastSeen: vi.fn(),
}));

const { resolveTelematicsConnectors } = await import("../../connectors/ConnectorRegistry.ts");
const { listVehicleMappings, listIgnoredExternals, touchVehiclesLastSeen } = await import(
  "../../infrastructure/repositories.ts"
);
const { conciliarFlota, msDeBigint } = await import("./VehicleReconciliationService.ts");
const { normalizarMatricula } = await import("../../../tyrecontrol/matricula.ts");

const CTX = { tenantId: "empresa-A", correlationId: "COR-1" };

/** Una cuenta que contesta con lo que se le diga, o revienta. */
function cuenta(key: string, accountKey: string, respuesta: ProviderVehicle[] | Error) {
  return {
    key,
    accountKey,
    usingDefault: false,
    config: {},
    connector: {
      listVehicles: vi.fn(async () => {
        if (respuesta instanceof Error) throw respuesta;
        return respuesta;
      }),
    },
  };
}

function mapeo(over: Record<string, unknown>) {
  return {
    id: 1,
    tenant_id: "empresa-A",
    entity_type: "vehicle",
    system: "movertis",
    account_key: "buses",
    active: true,
    metadata: null,
    last_seen_at_ms: null,
    ...over,
  };
}

const opciones = (internos: any[]) => ({
  leerFlotaInterna: async () => internos,
  normalizarMatricula,
});

beforeEach(() => {
  // Sin esto, las llamadas se acumulan entre pruebas y «no se ha llamado»
  // pasaría a ser «se llamó en la prueba anterior».
  vi.clearAllMocks();
  vi.mocked(listVehicleMappings).mockResolvedValue([] as any);
  vi.mocked(listIgnoredExternals).mockResolvedValue([] as any);
  vi.mocked(touchVehiclesLastSeen).mockResolvedValue(0);
});

describe("conciliarFlota()", () => {
  it("con una cuenta que responde, clasifica y marca completa", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", [{ providerVehicleId: "E1", plate: "1234ABC" }]),
    ] as any);

    const r = await conciliarFlota(CTX, opciones([
      { id: "v1", matricula: "1234ABC", activo: true, neumaticosMontados: 0 },
    ]));

    expect(r.resumen.status).toBe("complete");
    expect(r.resumen.bajasPermitidas).toBe(true);
    expect(r.resumen.providerVehicleCount).toBe(1);
    expect(r.resumen.tyrecontrolVehicleCount).toBe(1);
    expect(r.soloProveedor[0].propuesta?.id).toBe("v1");
  });

  it("sin cuentas configuradas devuelve error, no la flota como solo-TyreControl", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([] as any);

    const r = await conciliarFlota(CTX, opciones([
      { id: "v1", matricula: "1234ABC", activo: true, neumaticosMontados: 0 },
      { id: "v2", matricula: "5678DEF", activo: true, neumaticosMontados: 0 },
    ]));

    expect(r.resumen.status).toBe("error");
    // Lo importante: NO salen dos vehículos «solo en TyreControl».
    expect(r.soloTyreControl).toHaveLength(0);
    expect(r.resumen.tyrecontrolUnknownCount).toBe(2);
    expect(r.resumen.bajasPermitidas).toBe(false);
  });

  it("si la única cuenta falla, no se concluye nada sobre la flota", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", new Error("Movertis no disponible (HTTP 503)")),
    ] as any);
    vi.mocked(listVehicleMappings).mockResolvedValue([
      mapeo({ mobilink_id: "v1", external_code: "E1" }),
    ] as any);

    const r = await conciliarFlota(CTX, opciones([
      { id: "v1", matricula: "1234ABC", activo: true, neumaticosMontados: 6 },
    ]));

    expect(r.resumen.status).toBe("error");
    expect(r.resumen.cuentas[0].error).toContain("503");
    expect(r.soloTyreControl).toHaveLength(0);
    expect(r.discrepancias).toHaveLength(0);
    expect(r.resumen.tyrecontrolUnknownCount).toBe(1);
  });

  it("una cuenta de dos falla: la buena se concilia y la caída se aparta", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", [{ providerVehicleId: "E1", plate: "1234ABC" }]),
      cuenta("movertis", "auxiliar", new Error("timeout")),
    ] as any);
    vi.mocked(listVehicleMappings).mockImplementation(async ({ accountKey }: any) =>
      accountKey === "buses"
        ? ([mapeo({ mobilink_id: "v1", external_code: "E1" })] as any)
        : ([mapeo({ account_key: "auxiliar", mobilink_id: "v2", external_code: "E2" })] as any),
    );

    const r = await conciliarFlota(CTX, opciones([
      { id: "v1", matricula: "1234ABC", activo: true, neumaticosMontados: 0 },
      { id: "v2", matricula: "9999ZZZ", activo: true, neumaticosMontados: 4 },
    ]));

    expect(r.resumen.status).toBe("incomplete");
    expect(r.resumen.bajasPermitidas).toBe(false);
    // v1, de la cuenta buena, se concilia bien.
    expect(r.enlazados.map((f) => f.interno.id)).toEqual(["v1"]);
    // v2, de la cuenta caída, NO aparece como desaparecido ni como candidato.
    expect(r.soloTyreControl).toHaveLength(0);
    expect(r.discrepancias).toHaveLength(0);
    expect(r.resumen.tyrecontrolUnknownCount).toBe(1);
  });

  it("con la única cuenta caída, NINGÚN vehículo cae en solo-TyreControl", async () => {
    // El fallo visto en producción: primera conciliación de una flota de 719
    // vehículos sin enlazar, Movertis sin contestar, y los 719 salían como
    // «solo en TyreControl» con su botón de baja al lado.
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "default", new Error("No se pudo hablar con Movertis: fetch failed")),
    ] as any);

    const flota = Array.from({ length: 719 }, (_, i) => ({
      id: `v${i}`, matricula: `${1000 + i}ABC`, activo: true, neumaticosMontados: 6,
    }));
    const r = await conciliarFlota(CTX, opciones(flota));

    expect(r.resumen.status).toBe("error");
    expect(r.soloTyreControl).toHaveLength(0);
    expect(r.resumen.tyrecontrolOnlyCount).toBe(0);
    expect(r.resumen.tyrecontrolUnknownCount).toBe(719);
    expect(r.resumen.bajasPermitidas).toBe(false);
  });

  it("un vehículo sin enlace tampoco se juzga si OTRA cuenta ha fallado", async () => {
    // v3 no tiene enlace en ninguna cuenta, pero podría estar perfectamente en
    // la cuenta que no contestó. Afirmar que solo está en TyreControl sería
    // decir que ha desaparecido, y lo único que ha pasado es que no se ha
    // podido preguntar.
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", []),
      cuenta("movertis", "auxiliar", new Error("timeout")),
    ] as any);

    const r = await conciliarFlota(CTX, opciones([
      { id: "v3", matricula: "0000XXX", activo: true, neumaticosMontados: 2 },
    ]));

    expect(r.soloTyreControl).toHaveLength(0);
    expect(r.resumen.tyrecontrolUnknownCount).toBe(1);
    expect(r.resumen.bajasPermitidas).toBe(false);
  });

  it("una respuesta vacía válida no es lo mismo que un fallo", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", []),
    ] as any);

    const r = await conciliarFlota(CTX, opciones([]));

    expect(r.resumen.status).toBe("complete");
    expect(r.resumen.cuentas[0].ok).toBe(true);
    expect(r.resumen.cuentas[0].error).toBeUndefined();
    expect(r.resumen.bajasPermitidas).toBe(true);
  });
});

describe("last_seen_at", () => {
  it("se escribe solo con los vehículos de las cuentas que respondieron", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", [{ providerVehicleId: "E1" }, { providerVehicleId: "E2" }]),
      cuenta("movertis", "auxiliar", new Error("caída")),
    ] as any);

    await conciliarFlota(CTX, opciones([]));

    expect(touchVehiclesLastSeen).toHaveBeenCalledTimes(1);
    expect(touchVehiclesLastSeen).toHaveBeenCalledWith(
      expect.objectContaining({ accountKey: "buses", externalCodes: ["E1", "E2"] }),
    );
  });

  it("no se toca cuando la cuenta falla", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", new Error("HTTP 503")),
    ] as any);

    await conciliarFlota(CTX, opciones([]));

    expect(touchVehiclesLastSeen).not.toHaveBeenCalled();
  });

  it("se puede desactivar para previsualizar sin dejar rastro", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", [{ providerVehicleId: "E1" }]),
    ] as any);

    await conciliarFlota(CTX, { ...opciones([]), registrarUltimaVez: false });

    expect(touchVehiclesLastSeen).not.toHaveBeenCalled();
  });
});

describe("filtros de conector y cuenta", () => {
  it("acotar a una cuenta deja fuera a las demás", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "buses", [{ providerVehicleId: "E1" }]),
      cuenta("webfleet", "flota", [{ providerVehicleId: "W1" }]),
    ] as any);

    const r = await conciliarFlota(CTX, {
      ...opciones([]),
      connectorKey: "movertis",
      accountKey: "buses",
    });

    expect(r.resumen.cuentas).toHaveLength(1);
    expect(r.resumen.cuentas[0].connectorKey).toBe("movertis");
    expect(r.resumen.providerVehicleCount).toBe(1);
  });
});

/**
 * El BIGINT que llegaba a la pantalla como «Invalid Date».
 *
 * node-postgres devuelve los BIGINT como CADENA para no perder precisión, y
 * `new Date("1789204588796")` no es esa fecha: es Invalid Date, porque a
 * `new Date` una cadena se le parsea como texto de fecha. La conciliación
 * enseñaba «visto: Invalid Date» en todas sus filas por esto, y la guarda
 * `if (!ms)` de la pantalla no lo atrapaba porque una cadena no vacía es
 * truthy.
 */
describe("msDeBigint()", () => {
  it("convierte la cadena que devuelve el driver", () => {
    // Y se comprueba que el resultado SÍ es una fecha, que es lo que falló.
    expect(msDeBigint("1789204588796")).toBe(1789204588796);
    expect(new Date(msDeBigint("1789204588796") as number).toISOString())
      .toBe("2026-09-12T09:16:28.796Z");
  });

  it("deja pasar un número tal cual", () => {
    expect(msDeBigint(1789204588796)).toBe(1789204588796);
  });

  it("la ausencia sigue siendo ausencia, no la época de Unix", () => {
    // `new Date(null)` es el 1 de enero de 1970, que en una columna de «última
    // vez visto» sería una fecha creíble y falsa.
    expect(msDeBigint(null)).toBeNull();
    expect(msDeBigint(undefined)).toBeNull();
  });

  it("lo que no es una marca de tiempo se descarta en vez de propagarse", () => {
    for (const basura of ["", "   ", "ayer", {}, [], NaN, 0, -1]) {
      expect(msDeBigint(basura)).toBeNull();
    }
  });
});
