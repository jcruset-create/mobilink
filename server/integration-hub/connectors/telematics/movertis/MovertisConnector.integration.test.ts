/**
 * El conector contra la API de Movertis DE VERDAD.
 *
 * `scripts/movertis-probe.mjs --contrato` prueba que la API responde; esto
 * prueba que la responde a NOSOTROS, con nuestro cliente, nuestro mapeo y
 * nuestra clasificación de errores. No es lo mismo: entre una llamada de curl
 * que funciona y un conector que funciona caben un verbo equivocado, un cuerpo
 * mal montado y un campo leído de donde no está.
 *
 * Solo con RUN_MOVERTIS=1, como las pruebas con base real. Y hace falta poder
 * salir a *.hellomovertis.com: en el entorno remoto el proxy inyecta las
 * credenciales de la cuenta «Movertis Autocares Plana», así que el token que se
 * pone aquí da igual —se comprobó: el proxy sustituye la cabecera
 * `authorization` mande lo que mande el cliente—. Fuera de ahí, pon el token
 * real en MOVERTIS_TOKEN.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { MovertisConnector } from "./MovertisConnector.ts";
import { setSecretsProvider } from "../../../infrastructure/secrets.ts";
import { TELEMATICS_CAPABILITIES } from "../../../domain/telematics.ts";

const RUN = process.env.RUN_MOVERTIS === "1";

const ctx = { tenantId: "plana", correlationId: "COR-sonda-conector" };
const conector = new MovertisConnector({
  baseUrl: process.env.MOVERTIS_BASE_URL || "https://devapi.hellomovertis.com",
  accountKey: "default",
  // El indicio es fuerte (el sensor KM2 de Movertis calcula odometer/1000 y
  // coincide con counters.odometer), pero sigue sin confirmarse contra un
  // cuadro de mandos. Aquí se declara para poder comprobar el camino completo.
  odometroEn: "km",
  origenOdometro: "vehicle",
});

beforeAll(() => {
  if (!RUN) return;
  const token = process.env.MOVERTIS_TOKEN || "lo-pone-el-proxy";
  setSecretsProvider({ get: async (_t, _c, n) => (n === "token" ? token : undefined) });
});

describe.skipIf(!RUN)("MovertisConnector contra la API real", () => {
  it("no anuncia capacidades que no tiene", () => {
    // El histórico de Movertis es de posiciones: si aquí apareciera ODOMETER
    // como capacidad general, el panel ofrecería informes de kilometraje
    // retroactivo que saldrían vacíos.
    expect(conector.info.capabilities).toContain(TELEMATICS_CAPABILITIES.LIST_VEHICLES);
    expect(conector.info.capabilities).toContain(TELEMATICS_CAPABILITIES.HISTORY);
    // El depósito de esta flota viene siempre «sin dato»: anunciarlo sería
    // prometer un informe de combustible que saldría vacío.
    expect(conector.info.capabilities).not.toContain(TELEMATICS_CAPABILITIES.FUEL);
  });

  it("testConnection cuenta cuántos vehículos hay", async () => {
    const r = await conector.testConnection(ctx);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/vehículos en la cuenta/);
  }, 60_000);

  it("listVehicles trae la flota, con matrícula sacada del nombre", async () => {
    const vs = await conector.listVehicles(ctx);
    expect(vs.length).toBeGreaterThan(100);
    // Todos tienen que traer id: sin él no se puede enlazar nada.
    expect(vs.every((v) => !!v.providerVehicleId)).toBe(true);
    // Movertis no tiene campo de matrícula, así que sale del nombre. No todos
    // la tienen (hay equipos sin asignar), pero la gran mayoría sí.
    const conMatricula = vs.filter((v) => v.plate);
    expect(conMatricula.length / vs.length).toBeGreaterThan(0.8);
    // Normalizada como las guarda TyreControl: mayúsculas y sin separadores.
    for (const v of conMatricula.slice(0, 20)) expect(v.plate).toMatch(/^[A-Z0-9]+$/);
  }, 60_000);

  it("getCurrentTelemetry da odómetro CON fecha, no con la de ahora", async () => {
    const vs = await conector.listVehicles(ctx);
    // Uno que tenga matrícula: los «Nueva_xxxxx» son equipos sin vehículo.
    const alguno = vs.find((v) => v.plate);
    expect(alguno).toBeDefined();

    const l = await conector.getCurrentTelemetry(ctx, alguno!.providerVehicleId);
    // `null` es legítimo: un equipo que no ha emitido en una semana no tiene
    // instante al que atribuir su odómetro. Lo que no vale es inventárselo.
    if (l === null) return;

    expect(l.provider).toBe("movertis");
    expect(l.capturedAt.getTime()).toBeLessThanOrEqual(Date.now());
    // La fecha sale de la última posición emitida, así que NO puede ser «ahora».
    expect(Date.now() - l.capturedAt.getTime()).toBeGreaterThan(1000);
    if (l.odometerKm !== undefined) {
      expect(l.odometerKm).toBeGreaterThan(0);
      expect(l.odometerSource).toBe("vehicle");
    }
  }, 120_000);

  it("getTelemetryHistory trae posiciones ordenadas y SIN odómetro", async () => {
    const vs = await conector.listVehicles(ctx);
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - 48 * 3600_000);

    // Se prueba con varios porque un vehículo concreto puede no haber salido.
    let lecturas: Awaited<ReturnType<typeof conector.getTelemetryHistory>> = [];
    for (const v of vs.filter((x) => x.plate).slice(0, 5)) {
      lecturas = await conector.getTelemetryHistory(ctx, v.providerVehicleId, { from: desde, to: hasta });
      if (lecturas.length) break;
    }
    expect(lecturas.length).toBeGreaterThan(0);

    for (const l of lecturas) {
      // Esta es la afirmación que sostiene toda la fase 10: el histórico de
      // Movertis no trae kilometraje.
      expect(l.odometerKm).toBeUndefined();
      expect(l.capturedAt.getTime()).toBeGreaterThanOrEqual(desde.getTime() - 60_000);
    }
    const ordenadas = [...lecturas].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
    expect(lecturas.map((l) => l.capturedAt.getTime())).toEqual(ordenadas.map((l) => l.capturedAt.getTime()));
    // Alguna posición válida tiene que haber; 0,0 se descarta por contrato.
    expect(lecturas.some((l) => l.latitude !== undefined)).toBe(true);
  }, 120_000);

  it("una ruta que no existe se clasifica, no se devuelve como flota vacía", async () => {
    await expect(
      new MovertisConnector({
        baseUrl: process.env.MOVERTIS_BASE_URL || "https://devapi.hellomovertis.com",
        rutas: { vehicles: "/vehicle/noexiste" },
        maxRetries: 0,
      }).listVehicles(ctx),
    ).rejects.toThrow(/no conoce/);
  }, 60_000);
});
