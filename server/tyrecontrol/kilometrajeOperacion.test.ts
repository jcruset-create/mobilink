/**
 * Pruebas del puente entre el Telematics Hub y TyreControl.
 *
 * Lo que se fija aquí no es el cálculo —eso está probado en la fase 8— sino
 * las dos promesas que este puente hace a quien lo llama:
 *
 *  1. Nunca lanza. Una sustitución de neumático no puede fallar porque la
 *     telemática esté caída.
 *  2. Siempre explica. Haya kilometraje o no, la nota dice de dónde salió o
 *     por qué falta, porque un número sin procedencia y un null sin motivo son
 *     igual de inútiles para quien audite la operación después.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../integration-hub/application/services/VehicleOdometerService.ts", () => ({
  kilometrajeEnOperacion: vi.fn(),
}));

const { kilometrajeEnOperacion } = await import(
  "../integration-hub/application/services/VehicleOdometerService.ts"
);
const { kilometrajeParaMontaje } = await import("./kilometrajeOperacion.ts");

const PARAMS = {
  tcEmpresaId: "empresa-1",
  tcVehicleId: "veh-1",
  correlationId: "assist:1234:tc:sustitucion",
  at: new Date("2026-07-15T09:40:00Z"),
};

beforeEach(() => {
  vi.mocked(kilometrajeEnOperacion).mockReset();
});

describe("kilometrajeParaMontaje()", () => {
  it("devuelve el km y cuenta de dónde salió y con cuánto desfase", async () => {
    vi.mocked(kilometrajeEnOperacion).mockResolvedValue({
      estado: "encontrado",
      kilometraje: {
        odometerKm: 512480.4,
        provider: "webfleet",
        accountKey: "autobuses",
        providerVehicleId: "001",
        capturedAt: new Date("2026-07-15T09:38:00Z"),
        deltaMinutos: -2,
        toleranciaMin: 5,
        odometerSource: "vehicle",
      },
    });

    const r = await kilometrajeParaMontaje(PARAMS);
    expect(r.km).toBe(512480.4);
    expect(r.nota).toContain("512480.4 km");
    expect(r.nota).toContain("webfleet/autobuses");
    expect(r.nota).toContain("2 min antes");
    expect(r.nota).toContain("±5 min");
  });

  it("avisa cuando el odómetro viene del GPS y no del salpicadero", async () => {
    // Un odómetro por GPS es distancia acumulada: no cuadra con el cuadro de
    // mandos, y quien compare los dos números tiene que saberlo.
    vi.mocked(kilometrajeEnOperacion).mockResolvedValue({
      estado: "encontrado",
      kilometraje: {
        odometerKm: 1000, provider: "movertis", accountKey: "default",
        providerVehicleId: "X", capturedAt: new Date(), deltaMinutos: 0,
        toleranciaMin: 5, odometerSource: "gps",
      },
    });

    const r = await kilometrajeParaMontaje(PARAMS);
    expect(r.nota).toContain("GPS");
  });

  it("un desfase de 0 se lee 'en el mismo minuto', no '0 min antes'", async () => {
    vi.mocked(kilometrajeEnOperacion).mockResolvedValue({
      estado: "encontrado",
      kilometraje: {
        odometerKm: 1, provider: "webfleet", accountKey: "default",
        providerVehicleId: "001", capturedAt: new Date(), deltaMinutos: 0, toleranciaMin: 5,
      },
    });
    const r = await kilometrajeParaMontaje(PARAMS);
    expect(r.nota).toContain("en el mismo minuto");
  });

  it("sin lectura: km null y el motivo, que es el caso del taller", async () => {
    vi.mocked(kilometrajeEnOperacion).mockResolvedValue({
      estado: "sin_lectura",
      cuentasConsultadas: ["webfleet/autobuses"],
    });

    const r = await kilometrajeParaMontaje(PARAMS);
    expect(r.km).toBeNull();
    expect(r.nota).toContain("webfleet/autobuses");
    expect(r.nota).toContain("parado en el taller");
  });

  it("vehículo sin enlazar: lo dice, no lo confunde con un fallo", async () => {
    vi.mocked(kilometrajeEnOperacion).mockResolvedValue({ estado: "sin_telematica" });
    const r = await kilometrajeParaMontaje(PARAMS);
    expect(r.km).toBeNull();
    expect(r.nota).toContain("no está enlazado");
  });

  it("proveedor caído: lo distingue de 'no había lectura'", async () => {
    vi.mocked(kilometrajeEnOperacion).mockResolvedValue({
      estado: "no_disponible",
      motivo: "movertis/default: HTTP 503",
    });
    const r = await kilometrajeParaMontaje(PARAMS);
    expect(r.km).toBeNull();
    expect(r.nota).toContain("no se pudo consultar");
    expect(r.nota).toContain("503");
  });

  it("NUNCA lanza: un fallo del Hub no puede tumbar la sustitución", async () => {
    // La promesa que sostiene todo lo demás. Si esto lanzara, cambiar una rueda
    // dependería de que Webfleet conteste.
    vi.mocked(kilometrajeEnOperacion).mockRejectedValue(new Error("explotó el hub"));

    const r = await kilometrajeParaMontaje(PARAMS);
    expect(r.km).toBeNull();
    expect(r.nota).toContain("explotó el hub");
  });

  it("pregunta por la empresa y el vehículo de TyreControl", async () => {
    vi.mocked(kilometrajeEnOperacion).mockResolvedValue({ estado: "sin_telematica" });
    await kilometrajeParaMontaje(PARAMS);

    const [ctx, vehiculo, at] = vi.mocked(kilometrajeEnOperacion).mock.calls[0];
    // El tenant del Hub ES la empresa: el gestor de secretos y los mapeos de
    // telemática ya son por empresa, así que no hay traducción que hacer.
    expect(ctx.tenantId).toBe("empresa-1");
    expect(ctx.correlationId).toBe("assist:1234:tc:sustitucion");
    expect(vehiculo).toBe("veh-1");
    expect(at).toEqual(PARAMS.at);
  });
});
