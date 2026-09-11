/**
 * Pruebas del kilometraje trazable.
 *
 * La parte que decide —`elegirKilometraje`— es pura y se prueba entera: es la
 * que dice a qué km se montó un neumático, y equivocarse ahí no da un error,
 * da un número creíble y falso. La orquestación se prueba aparte, con
 * conectores de mentira, porque lo que hay que fijar de ella no es la red sino
 * que distingue las cuatro respuestas.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { VehicleTelemetry } from "../../domain/telematics.ts";

vi.mock("../../connectors/ConnectorRegistry.ts", () => ({
  resolveTelematicsConnectors: vi.fn(),
}));
vi.mock("../../infrastructure/repositories.ts", () => ({
  findExternalCode: vi.fn(),
}));

const { resolveTelematicsConnectors } = await import("../../connectors/ConnectorRegistry.ts");
const { findExternalCode } = await import("../../infrastructure/repositories.ts");
const { elegirKilometraje, kilometrajeEnOperacion, ESCALERA_TOLERANCIA } = await import(
  "./VehicleOdometerService.ts"
);

const T = new Date("2026-07-15T09:40:00Z");

function lectura(iso: string, km?: number, extra: Partial<VehicleTelemetry> = {}): VehicleTelemetry {
  return {
    provider: "webfleet",
    accountKey: "autobuses",
    providerVehicleId: "001",
    capturedAt: new Date(iso),
    ...(km === undefined ? {} : { odometerKm: km }),
    ...extra,
  };
}

describe("elegirKilometraje()", () => {
  it("elige la lectura más próxima al instante de la operación", () => {
    const r = elegirKilometraje(
      [
        lectura("2026-07-15T09:00:00Z", 100),
        lectura("2026-07-15T09:39:00Z", 140),
        lectura("2026-07-15T10:30:00Z", 180),
      ],
      T,
    );
    expect(r?.lectura.odometerKm).toBe(140);
  });

  it("descarta las lecturas SIN odómetro aunque sean más cercanas", () => {
    // El caso que justifica no usar getTelemetryAt: la más próxima no trae
    // kilometraje, y un kilometraje es justo lo que se viene a buscar.
    const r = elegirKilometraje(
      [
        lectura("2026-07-15T09:39:00Z", undefined), // más cerca, pero sin km
        lectura("2026-07-15T09:42:00Z", 512480),
      ],
      T,
    );
    expect(r?.lectura.odometerKm).toBe(512480);
    expect(r?.deltaMinutos).toBe(2);
  });

  it("informa del peldaño de la escalera en que cayó", () => {
    const peldaño = (min: number) =>
      elegirKilometraje([lectura(new Date(T.getTime() + min * 60_000).toISOString(), 1)], T)
        ?.toleranciaMin;

    expect(peldaño(3)).toBe(5);
    expect(peldaño(12)).toBe(15);
    expect(peldaño(22)).toBe(30);
    expect(peldaño(47)).toBe(60);
  });

  it("conserva el SIGNO del desfase", () => {
    // Una lectura posterior a un desmontaje puede traer km que el neumático ya
    // no hizo. Con valor absoluto, ese caso sería indistinguible del contrario.
    const antes = elegirKilometraje([lectura("2026-07-15T09:30:00Z", 1)], T);
    const despues = elegirKilometraje([lectura("2026-07-15T09:50:00Z", 1)], T);
    expect(antes?.deltaMinutos).toBe(-10);
    expect(despues?.deltaMinutos).toBe(10);
  });

  it("una lectura de hace 20 segundos es Δ 0 minutos", () => {
    const r = elegirKilometraje([lectura("2026-07-15T09:39:40Z", 1)], T);
    expect(r?.deltaMinutos).toBe(0);
    expect(r?.toleranciaMin).toBe(5);
  });

  it("ante un empate exacto gana la lectura ANTERIOR", () => {
    // Ante la duda no se atribuyen al neumático kilómetros posteriores.
    const r = elegirKilometraje(
      [lectura("2026-07-15T09:50:00Z", 200), lectura("2026-07-15T09:30:00Z", 100)],
      T,
    );
    expect(r?.lectura.odometerKm).toBe(100);
  });

  it("devuelve null fuera de la escalera: un taller no emite lecturas", () => {
    // Respuesta legítima y frecuente, no un fallo.
    expect(elegirKilometraje([lectura("2026-07-15T07:00:00Z", 100)], T)).toBeNull();
    expect(elegirKilometraje([], T)).toBeNull();
  });

  it("no interpola entre dos lecturas", () => {
    const r = elegirKilometraje(
      [lectura("2026-07-15T09:20:00Z", 100), lectura("2026-07-15T10:00:00Z", 200)],
      T,
    );
    expect([100, 200]).toContain(r?.lectura.odometerKm);
  });

  it("la escalera es la que declara telematics.ts", () => {
    expect([...ESCALERA_TOLERANCIA]).toEqual([5, 15, 30, 60]);
  });
});

describe("kilometrajeEnOperacion()", () => {
  const ctx = { tenantId: "empresa-1", correlationId: "COR-20260715-000001" };

  const cuenta = (key: string, accountKey: string, connector: unknown) => ({
    key, accountKey, connector, usingDefault: false, config: {},
  });

  beforeEach(() => {
    vi.mocked(resolveTelematicsConnectors).mockReset();
    vi.mocked(findExternalCode).mockReset();
  });

  it("sin cuentas de telemática no es un fallo, es 'sin_telematica'", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([]);
    const r = await kilometrajeEnOperacion(ctx, "veh-1", T);
    expect(r.estado).toBe("sin_telematica");
  });

  it("vehículo sin enlazar en ninguna cuenta → 'sin_telematica'", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("webfleet", "default", { getTelemetryHistory: vi.fn() }),
    ] as never);
    vi.mocked(findExternalCode).mockResolvedValue(null);

    const r = await kilometrajeEnOperacion(ctx, "veh-1", T);
    expect(r.estado).toBe("sin_telematica");
  });

  it("se preguntó y no había nada → 'sin_lectura', no 'no_disponible'", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("webfleet", "autobuses", { getTelemetryHistory: vi.fn().mockResolvedValue([]) }),
    ] as never);
    vi.mocked(findExternalCode).mockResolvedValue("001");

    const r = await kilometrajeEnOperacion(ctx, "veh-1", T);
    expect(r.estado).toBe("sin_lectura");
    if (r.estado === "sin_lectura") expect(r.cuentasConsultadas).toEqual(["webfleet/autobuses"]);
  });

  it("si NADIE pudo contestar → 'no_disponible', que sí merece reintento", async () => {
    // La distinción que importa: no es lo mismo no encontrar nada que no haber
    // podido mirar. Un null para ambos casos los haría indistinguibles.
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "default", {
        getTelemetryHistory: vi.fn().mockRejectedValue(new Error("Movertis no disponible (HTTP 503)")),
      }),
    ] as never);
    vi.mocked(findExternalCode).mockResolvedValue("TSVETAN2");

    const r = await kilometrajeEnOperacion(ctx, "veh-1", T);
    expect(r.estado).toBe("no_disponible");
    if (r.estado === "no_disponible") expect(r.motivo).toContain("503");
  });

  it("una cuenta caída no cancela a la que sí responde", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "auxiliar", {
        getTelemetryHistory: vi.fn().mockRejectedValue(new Error("caído")),
      }),
      cuenta("webfleet", "autobuses", {
        getTelemetryHistory: vi.fn().mockResolvedValue([
          lectura("2026-07-15T09:38:00Z", 512480, { provider: "webfleet", accountKey: "autobuses" }),
        ]),
      }),
    ] as never);
    vi.mocked(findExternalCode).mockResolvedValue("001");

    const r = await kilometrajeEnOperacion(ctx, "veh-1", T);
    expect(r.estado).toBe("encontrado");
    if (r.estado === "encontrado") {
      expect(r.kilometraje.odometerKm).toBe(512480);
      expect(r.kilometraje.provider).toBe("webfleet");
      expect(r.kilometraje.deltaMinutos).toBe(-2);
      expect(r.kilometraje.toleranciaMin).toBe(5);
    }
  });

  it("con dos cuentas que responden, gana la lectura más próxima", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("webfleet", "auxiliar", {
        getTelemetryHistory: vi.fn().mockResolvedValue([
          lectura("2026-07-15T09:10:00Z", 111, { accountKey: "auxiliar" }),
        ]),
      }),
      cuenta("webfleet", "autobuses", {
        getTelemetryHistory: vi.fn().mockResolvedValue([
          lectura("2026-07-15T09:39:00Z", 222, { accountKey: "autobuses" }),
        ]),
      }),
    ] as never);
    vi.mocked(findExternalCode).mockResolvedValue("001");

    const r = await kilometrajeEnOperacion(ctx, "veh-1", T);
    expect(r.estado).toBe("encontrado");
    if (r.estado === "encontrado") {
      expect(r.kilometraje.odometerKm).toBe(222);
      expect(r.kilometraje.accountKey).toBe("autobuses");
    }
  });

  it("pide una sola ventana de ±60 por cuenta, no cuatro llamadas", async () => {
    const getTelemetryHistory = vi.fn().mockResolvedValue([]);
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("webfleet", "default", { getTelemetryHistory }),
    ] as never);
    vi.mocked(findExternalCode).mockResolvedValue("001");

    await kilometrajeEnOperacion(ctx, "veh-1", T);

    expect(getTelemetryHistory).toHaveBeenCalledTimes(1);
    const ventana = getTelemetryHistory.mock.calls[0][2];
    expect(ventana.from.toISOString()).toBe("2026-07-15T08:40:00.000Z");
    expect(ventana.to.toISOString()).toBe("2026-07-15T10:40:00.000Z");
  });

  it("arrastra la procedencia del odómetro para que se pueda guardar", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("webfleet", "default", {
        getTelemetryHistory: vi.fn().mockResolvedValue([
          lectura("2026-07-15T09:40:00Z", 512480.4, { odometerSource: "vehicle", accountKey: "default" }),
        ]),
      }),
    ] as never);
    vi.mocked(findExternalCode).mockResolvedValue("001");

    const r = await kilometrajeEnOperacion(ctx, "veh-1", T);
    if (r.estado === "encontrado") {
      // Sin redondear: el decimal es el que la fase 7 recuperó de Webfleet.
      expect(r.kilometraje.odometerKm).toBe(512480.4);
      expect(r.kilometraje.odometerSource).toBe("vehicle");
      expect(r.kilometraje.providerVehicleId).toBe("001");
    }
  });
});
