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
const {
  elegirKilometraje,
  kilometrajeEnOperacion,
  kilometrajeSiSigueParado,
  ESCALERA_TOLERANCIA,
} = await import("./VehicleOdometerService.ts");

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

/**
 * `kilometrajeSiSigueParado` — el kilometraje de un instante pasado cuando el
 * proveedor no guarda odómetro histórico.
 *
 * Lo que se fija aquí no es el cálculo —eso está en
 * `domain/inmovilidad.test.ts`— sino que la orquestación distingue los cinco
 * casos, y en particular que «se movió» no se confunde con «no había lectura».
 * Los dos acaban en un `null` para quien llame, y no significan lo mismo: uno
 * es una negativa razonada y el otro una ausencia.
 */
describe("kilometrajeSiSigueParado()", () => {
  const ctx = { tenantId: "empresa-1", correlationId: "COR-20260912-000001" };
  const PASO = new Date("2026-09-10T18:00:00Z");
  const AHORA = new Date("2026-09-12T09:00:00Z");

  const cuenta = (key: string, accountKey: string, connector: unknown) => ({
    key, accountKey, connector, usingDefault: false, config: {},
  });

  // La base de Plana en Vila-seca, que es de donde salen las posiciones reales.
  const BASE = { lat: 41.1299667358, lng: 1.18569278717 };
  const pos = (minDesdePaso: number, desviacionM = 0): VehicleTelemetry => ({
    provider: "movertis",
    accountKey: "default",
    providerVehicleId: "26134116",
    capturedAt: new Date(PASO.getTime() + minDesdePaso * 60_000),
    latitude: BASE.lat + desviacionM / 111_320,
    longitude: BASE.lng,
  });

  /** Un conector que contesta lo que se le diga a cada una de las dos llamadas. */
  const conector = (actual: VehicleTelemetry | null, historico: VehicleTelemetry[]) => ({
    getCurrentTelemetry: vi.fn().mockResolvedValue(actual),
    getTelemetryHistory: vi.fn().mockResolvedValue(historico),
  });

  const actualCon = (km: number | undefined, capturadoMin: number): VehicleTelemetry => ({
    provider: "movertis",
    accountKey: "default",
    providerVehicleId: "26134116",
    capturedAt: new Date(PASO.getTime() + capturadoMin * 60_000),
    ...(km === undefined ? {} : { odometerKm: km, odometerSource: "vehicle" as const }),
  });

  beforeEach(() => {
    vi.mocked(resolveTelematicsConnectors).mockReset();
    vi.mocked(findExternalCode).mockReset();
  });

  it("parado desde el paso: el odómetro de ahora vale para entonces", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "default", conector(actualCon(809052, 600), [pos(10), pos(300, 40)])),
    ] as any);
    vi.mocked(findExternalCode).mockResolvedValue("26134116");

    const r = await kilometrajeSiSigueParado(ctx, "veh-1", PASO, { ahora: AHORA });
    expect(r.estado).toBe("encontrado");
    if (r.estado === "encontrado") {
      expect(r.kilometraje.odometerKm).toBe(809052);
      expect(r.kilometraje.deltaMinutos).toBe(600);
      expect(r.kilometraje.odometerSource).toBe("vehicle");
      expect(r.kilometraje.prueba.estado).toBe("quieto");
      expect(r.kilometraje.providerVehicleId).toBe("26134116");
    }
  });

  it("salió después del paso: NO da número, y lo llama por su nombre", async () => {
    // El caso que hay que no equivocar: el odómetro de ahora lleva los km de
    // una jornada que el neumático no había hecho cuando se le midió.
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "default", conector(actualCon(809500, 900), [pos(10), pos(800, 30_000)])),
    ] as any);
    vi.mocked(findExternalCode).mockResolvedValue("26134116");

    const r = await kilometrajeSiSigueParado(ctx, "veh-1", PASO, { ahora: AHORA });
    expect(r.estado).toBe("se_movio");
    if (r.estado === "se_movio") {
      expect(r.motivo).toContain("movertis/default");
      expect(r.motivo).toMatch(/\d+ m/);
      expect(r.cuentasConsultadas).toEqual(["movertis/default"]);
    }
  });

  it("el equipo dormido desde antes del paso: vale, con el desfase en negativo", async () => {
    // Lo normal en esta flota. Una lectura ANTERIOR al arco no puede llevar
    // kilómetros posteriores a él.
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "default", conector(actualCon(809052, -25), [])),
    ] as any);
    vi.mocked(findExternalCode).mockResolvedValue("26134116");

    const r = await kilometrajeSiSigueParado(ctx, "veh-1", PASO, { ahora: AHORA });
    expect(r.estado).toBe("encontrado");
    if (r.estado === "encontrado") {
      expect(r.kilometraje.deltaMinutos).toBe(-25);
      expect(r.kilometraje.prueba.estado).toBe("sin_emisiones");
    }
  });

  it("lectura posterior al paso sin ninguna posición: no se cuela como exacta", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "default", conector(actualCon(809052, 120), [])),
    ] as any);
    vi.mocked(findExternalCode).mockResolvedValue("26134116");

    const r = await kilometrajeSiSigueParado(ctx, "veh-1", PASO, { ahora: AHORA });
    expect(r.estado).toBe("sin_lectura");
  });

  it("lectura sin odómetro: no hay kilometraje que atribuir, por mucha prueba que haya", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "default", conector(actualCon(undefined, 60), [pos(10), pos(300)])),
    ] as any);
    vi.mocked(findExternalCode).mockResolvedValue("26134116");

    const r = await kilometrajeSiSigueParado(ctx, "veh-1", PASO, { ahora: AHORA });
    expect(r.estado).toBe("sin_lectura");
  });

  it("sin cuentas: 'sin_telematica', que no es un fallo", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([]);
    expect((await kilometrajeSiSigueParado(ctx, "veh-1", PASO)).estado).toBe("sin_telematica");
  });

  it("vehículo sin enlazar en ninguna cuenta: tampoco es un fallo", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "default", conector(actualCon(1, 0), [])),
    ] as any);
    vi.mocked(findExternalCode).mockResolvedValue(null);

    expect((await kilometrajeSiSigueParado(ctx, "veh-1", PASO)).estado).toBe("sin_telematica");
  });

  it("proveedor caído: 'no_disponible', que sí merece reintento", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "default", {
        getCurrentTelemetry: vi.fn().mockRejectedValue(new Error("HTTP 503")),
        getTelemetryHistory: vi.fn().mockResolvedValue([]),
      }),
    ] as any);
    vi.mocked(findExternalCode).mockResolvedValue("26134116");

    const r = await kilometrajeSiSigueParado(ctx, "veh-1", PASO, { ahora: AHORA });
    expect(r.estado).toBe("no_disponible");
    if (r.estado === "no_disponible") expect(r.motivo).toContain("503");
  });

  it("una cuenta caída no cancela a la que sí contesta", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "auxiliar", {
        getCurrentTelemetry: vi.fn().mockRejectedValue(new Error("HTTP 503")),
        getTelemetryHistory: vi.fn().mockResolvedValue([]),
      }),
      cuenta("movertis", "default", conector(actualCon(809052, 30), [pos(5), pos(200, 20)])),
    ] as any);
    vi.mocked(findExternalCode).mockResolvedValue("26134116");

    const r = await kilometrajeSiSigueParado(ctx, "veh-1", PASO, { ahora: AHORA });
    expect(r.estado).toBe("encontrado");
  });

  it("con dos cuentas que valen, gana la de menor desfase", async () => {
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "lejana", conector(actualCon(111, 900), [pos(10), pos(500, 10)])),
      cuenta("movertis", "cercana", conector(actualCon(222, 20), [pos(5), pos(15, 10)])),
    ] as any);
    vi.mocked(findExternalCode).mockResolvedValue("26134116");

    const r = await kilometrajeSiSigueParado(ctx, "veh-1", PASO, { ahora: AHORA });
    expect(r.estado).toBe("encontrado");
    if (r.estado === "encontrado") expect(r.kilometraje.odometerKm).toBe(222);
  });

  it("se pide la ventana que va del instante a ahora, no una de ±60 min", async () => {
    // Es la diferencia con `kilometrajeEnOperacion`: aquí lo que interesa es
    // TODO lo que ha pasado desde entonces, porque cualquier salida invalida.
    const c = conector(actualCon(809052, 30), [pos(5)]);
    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "default", c),
    ] as any);
    vi.mocked(findExternalCode).mockResolvedValue("26134116");

    await kilometrajeSiSigueParado(ctx, "veh-1", PASO, { ahora: AHORA });
    expect(c.getTelemetryHistory).toHaveBeenCalledWith(ctx, "26134116", { from: PASO, to: AHORA });
  });

  it("el radio se puede estrechar por si alguna base es pequeña", async () => {
    const historico = [pos(10), pos(300, 250)];
    vi.mocked(findExternalCode).mockResolvedValue("26134116");

    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "default", conector(actualCon(809052, 600), historico)),
    ] as any);
    expect((await kilometrajeSiSigueParado(ctx, "veh-1", PASO, { ahora: AHORA })).estado)
      .toBe("encontrado");

    vi.mocked(resolveTelematicsConnectors).mockResolvedValue([
      cuenta("movertis", "default", conector(actualCon(809052, 600), historico)),
    ] as any);
    expect(
      (await kilometrajeSiSigueParado(ctx, "veh-1", PASO, { ahora: AHORA, radioM: 100 })).estado,
    ).toBe("se_movio");
  });
});
