/**
 * Pruebas del puente entre el Telematics Hub y las revisiones del CheckPoint.
 *
 * Lo que se fija aquí no es el cálculo —eso está probado en
 * `domain/inmovilidad.test.ts`— sino las dos promesas que este puente hace:
 *
 *  1. Nunca lanza. Un informe del arco trae presiones y profundidades de toda
 *     la flota, y perderlo porque Movertis no contesta sería cambiar un dato que
 *     falta por un informe entero que se pierde.
 *  2. Siempre explica, y distingue «se movió» de «no había lectura». Los dos
 *     dejan el km en null, y no significan lo mismo: en el primero hay odómetro
 *     y no vale; en el segundo no hay odómetro.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../integration-hub/application/services/VehicleOdometerService.ts", () => ({
  kilometrajeSiSigueParado: vi.fn(),
}));

const { kilometrajeSiSigueParado } = await import(
  "../integration-hub/application/services/VehicleOdometerService.ts"
);
const { kilometrajeParaRevision } = await import("./kilometrajeRevision.ts");

const PARAMS = {
  tcEmpresaId: "empresa-1",
  tcVehicleId: "veh-1",
  medidoAt: new Date("2026-09-10T18:00:00Z"),
  correlationId: "checkpoint:2026-09-12:rev",
};

const QUIETO = { estado: "quieto" as const, puntos: 12, desplazamientoMaxM: 41.7, radioM: 300 };

beforeEach(() => {
  vi.mocked(kilometrajeSiSigueParado).mockReset();
});

describe("kilometrajeParaRevision()", () => {
  it("devuelve el km y cuenta de dónde salió, con qué desfase y con qué prueba", async () => {
    vi.mocked(kilometrajeSiSigueParado).mockResolvedValue({
      estado: "encontrado",
      kilometraje: {
        odometerKm: 809052, provider: "movertis", accountKey: "default",
        providerVehicleId: "26134116", capturedAt: new Date("2026-09-11T04:00:00Z"),
        deltaMinutos: 600, odometerSource: "vehicle", prueba: QUIETO,
      },
    });

    const r = await kilometrajeParaRevision(PARAMS);
    expect(r.km).toBe(809052);
    expect(r.origen).toBe("telematica");
    expect(r.desfaseMin).toBe(600);
    expect(r.capturadoAt).toEqual(new Date("2026-09-11T04:00:00Z"));
    expect(r.nota).toContain("809052 km");
    expect(r.nota).toContain("movertis/default");
    expect(r.nota).toContain("10 h después");
    expect(r.nota).toContain("no se movió");
    expect(r.nota).toContain("42 m");
  });

  it("«se movió» NO se confunde con «no había lectura»", async () => {
    // La distinción que importa: aquí hay odómetro, y lo que pasa es que lleva
    // kilómetros que la rueda no había hecho cuando se le midió.
    vi.mocked(kilometrajeSiSigueParado).mockResolvedValue({
      estado: "se_movio",
      motivo: "movertis/default: el vehículo salió de donde estaba (31402 m, ...)",
      cuentasConsultadas: ["movertis/default"],
    });

    const r = await kilometrajeParaRevision(PARAMS);
    expect(r.km).toBeNull();
    expect(r.origen).toBeNull();
    expect(r.nota).toContain("salió después de la medición");
    expect(r.nota).toContain("kilómetros que aún no había hecho");
  });

  it("lectura anterior a la medición: se acepta y la nota dice por qué es válida", async () => {
    vi.mocked(kilometrajeSiSigueParado).mockResolvedValue({
      estado: "encontrado",
      kilometraje: {
        odometerKm: 674234, provider: "movertis", accountKey: "default",
        providerVehicleId: "1", capturedAt: new Date("2026-09-10T17:48:00Z"),
        deltaMinutos: -12, odometerSource: "vehicle",
        prueba: { estado: "sin_emisiones" },
      },
    });

    const r = await kilometrajeParaRevision(PARAMS);
    expect(r.km).toBe(674234);
    expect(r.desfaseMin).toBe(-12);
    expect(r.nota).toContain("12 min antes");
    expect(r.nota).toContain("no puede llevar kilómetros posteriores");
  });

  it("avisa cuando el odómetro viene del GPS y no del salpicadero", async () => {
    vi.mocked(kilometrajeSiSigueParado).mockResolvedValue({
      estado: "encontrado",
      kilometraje: {
        odometerKm: 1000, provider: "movertis", accountKey: "default",
        providerVehicleId: "1", capturedAt: new Date(), deltaMinutos: 0,
        odometerSource: "gps", prueba: QUIETO,
      },
    });
    expect((await kilometrajeParaRevision(PARAMS)).nota).toContain("GPS");
  });

  it("un desfase de días se lee en días, no en 11.520 minutos", async () => {
    vi.mocked(kilometrajeSiSigueParado).mockResolvedValue({
      estado: "encontrado",
      kilometraje: {
        odometerKm: 1, provider: "movertis", accountKey: "default",
        providerVehicleId: "1", capturedAt: new Date(), deltaMinutos: -11520,
        prueba: { estado: "sin_emisiones" },
      },
    });
    expect((await kilometrajeParaRevision(PARAMS)).nota).toContain("8 días antes");
  });

  it("vehículo sin enlazar: lo dice, y dice dónde se arregla", async () => {
    vi.mocked(kilometrajeSiSigueParado).mockResolvedValue({ estado: "sin_telematica" });
    const r = await kilometrajeParaRevision(PARAMS);
    expect(r.km).toBeNull();
    expect(r.nota).toContain("no está enlazado");
    expect(r.nota).toContain("conciliación telemática");
  });

  it("proveedor caído: lo distingue de «no había lectura»", async () => {
    vi.mocked(kilometrajeSiSigueParado).mockResolvedValue({
      estado: "no_disponible", motivo: "movertis/default: HTTP 503",
    });
    const r = await kilometrajeParaRevision(PARAMS);
    expect(r.km).toBeNull();
    expect(r.nota).toContain("no se pudo consultar");
    expect(r.nota).toContain("503");
  });

  it("sin lectura con odómetro: dice a quién se preguntó", async () => {
    vi.mocked(kilometrajeSiSigueParado).mockResolvedValue({
      estado: "sin_lectura", cuentasConsultadas: ["movertis/default", "movertis/auxiliar"],
    });
    const r = await kilometrajeParaRevision(PARAMS);
    expect(r.km).toBeNull();
    expect(r.nota).toContain("movertis/default, movertis/auxiliar");
  });

  it("NUNCA lanza: un fallo del Hub no puede tumbar la importación del informe", async () => {
    vi.mocked(kilometrajeSiSigueParado).mockRejectedValue(new Error("explotó el hub"));
    const r = await kilometrajeParaRevision(PARAMS);
    expect(r.km).toBeNull();
    expect(r.nota).toContain("explotó el hub");
  });

  it("pregunta por la empresa, el vehículo y el instante de la MEDICIÓN", async () => {
    vi.mocked(kilometrajeSiSigueParado).mockResolvedValue({ estado: "sin_telematica" });
    await kilometrajeParaRevision(PARAMS);

    const [ctx, vehiculo, desde] = vi.mocked(kilometrajeSiSigueParado).mock.calls[0];
    // El tenant del Hub ES la empresa: no hay traducción que hacer.
    expect(ctx.tenantId).toBe("empresa-1");
    expect(vehiculo).toBe("veh-1");
    // Contra `medido_at`, no contra `created_at` ni contra ahora.
    expect(desde).toEqual(PARAMS.medidoAt);
  });
});
