/**
 * Pruebas del mapeo de Webfleet.
 *
 * Aquí sí se puede probar contra la forma REAL de la API: los nombres de campo
 * salen de lo que `server/index.ts` lleva años leyendo en producción, no de
 * candidatos tanteados. Lo que se fija es sobre todo lo que distingue a este
 * mapeo del código del que viene: que no redondea, que las unidades cambian
 * según la acción, y que el combustible no se traduce.
 */

import { describe, expect, it } from "vitest";
import {
  filasDe,
  masCercana,
  objetoALectura,
  objetoAVehiculo,
  odometroKm,
  viajeALectura,
  type OpcionesMapeo,
} from "./mapeo.ts";
import type { VehicleTelemetry } from "../../../domain/telematics.ts";

const OPCIONES: OpcionesMapeo = { provider: "webfleet", accountKey: "default" };

describe("odometroKm()", () => {
  it("NO redondea: los 684.327,4 km no se pierden", () => {
    // Es el reproche literal que `telematics.ts` le hace a webfleetOdometerKm()
    // de index.ts, que hace Math.round(). Para pintar en pantalla da igual;
    // para decir a qué km se montó un neumático, no.
    expect(odometroKm({ odometer_long: 684327400 })).toBe(684327.4);
  });

  it("prefiere metros (odometer_long) a hectómetros (odometer)", () => {
    // Los dos existen a la vez y no dicen lo mismo de precisión.
    expect(odometroKm({ odometer_long: 684327400, odometer: 6843274 })).toBe(684327.4);
  });

  it("convierte hectómetros cuando no hay metros", () => {
    expect(odometroKm({ odometer: 6843274 })).toBe(684327.4);
  });

  it("trata el 0 de Webfleet como ausencia, no como vehículo a estrenar", () => {
    // Webfleet manda 0 cuando el equipo no reporta odómetro.
    expect(odometroKm({ odometer_long: 0, odometer: 0 })).toBeUndefined();
    expect(odometroKm({})).toBeUndefined();
  });

  it("usa el umbral de 200.000 del can_odometer, que ya venía de producción", () => {
    // Por encima de 200.000 el campo está dando metros; por debajo, km.
    expect(odometroKm({ can_odometer: 684327400 })).toBe(684327.4);
    expect(odometroKm({ can_odometer: 150000 })).toBe(150000);
  });
});

describe("objetoAVehiculo()", () => {
  it("lee objectno y objectname", () => {
    const v = objetoAVehiculo({ objectno: "2321HZT", objectname: "Bus 14", pos_time: "2026-07-15T09:40:00Z" });
    expect(v).toMatchObject({ providerVehicleId: "2321HZT", name: "Bus 14" });
    expect(v?.lastContactAt?.toISOString()).toBe("2026-07-15T09:40:00.000Z");
  });

  it("no afirma matrícula que Webfleet no da", () => {
    // objectname suele ser la matrícula, pero no está garantizado. Afirmarlo
    // permitiría un emparejamiento automático sobre una suposición.
    const v = objetoAVehiculo({ objectno: "001", objectname: "2321HZT" });
    expect(v?.plate).toBeUndefined();
  });

  it("cae a objectno si no hay nombre, y descarta lo que no tiene id", () => {
    expect(objetoAVehiculo({ objectno: "001" })?.name).toBe("001");
    expect(objetoAVehiculo({ objectname: "Sin id" })).toBeNull();
  });
});

describe("objetoALectura() — showObjectReportExtern", () => {
  it("exige pos_time: sin fecha la lectura no es auditable", () => {
    expect(objetoALectura({ objectno: "001", odometer_long: 100000 }, OPCIONES)).toBeNull();
  });

  it("interpreta latitude_mdeg como MICROGRADOS", () => {
    const l = objetoALectura(
      { objectno: "001", pos_time: "2026-07-15T09:40:00Z", latitude_mdeg: 41118900, longitude_mdeg: 1244500 },
      OPCIONES,
    );
    expect(l?.latitude).toBeCloseTo(41.1189, 4);
    expect(l?.longitude).toBeCloseTo(1.2445, 4);
  });

  it("interpreta latitude (sin _mdeg) como GRADOS en esta acción", () => {
    // La trampa: el mismo nombre significa microgrados en showTracks y en los
    // viajes. Un millón de diferencia entre Tarragona y el océano.
    const l = objetoALectura(
      { objectno: "001", pos_time: "2026-07-15T09:40:00Z", latitude: 41.1189, longitude: 1.2445 },
      OPCIONES,
    );
    expect(l?.latitude).toBeCloseTo(41.1189, 4);
  });

  it("descarta 0,0 como posición", () => {
    const l = objetoALectura(
      { objectno: "001", pos_time: "2026-07-15T09:40:00Z", latitude_mdeg: 0, longitude_mdeg: 0 },
      OPCIONES,
    );
    expect(l?.latitude).toBeUndefined();
  });

  it("declara que el odómetro es del vehículo, no del GPS", () => {
    const l = objetoALectura(
      { objectno: "001", pos_time: "2026-07-15T09:40:00Z", odometer_long: 684327400 },
      OPCIONES,
    );
    expect(l?.odometerKm).toBe(684327.4);
    expect(l?.odometerSource).toBe("vehicle");
  });

  it("NO traduce el combustible aunque venga a 0", () => {
    // Los equipos de esta flota no tienen CAN/FMS: Webfleet manda 0 siempre.
    // Un 0 guardado es indistinguible de un depósito vacío.
    const l = objetoALectura(
      { objectno: "001", pos_time: "2026-07-15T09:40:00Z", fuel_usage: 0, fuel_level: 0, co2: 0 },
      OPCIONES,
    );
    expect(l?.fuelLevelPct).toBeUndefined();
    expect(l?.fuelConsumedL).toBeUndefined();
  });

  it("recoge dirección y velocidad cuando vienen", () => {
    const l = objetoALectura(
      { objectno: "001", pos_time: "2026-07-15T09:40:00Z", postext: "Tarragona", speed: 82 },
      OPCIONES,
    );
    expect(l?.address).toBe("Tarragona");
    expect(l?.speedKmh).toBe(82);
  });
});

describe("viajeALectura() — histórico", () => {
  it("interpreta las coordenadas del viaje como MICROGRADOS", () => {
    const l = viajeALectura(
      { end_time: "2026-07-15T09:40:00Z", end_latitude: 41118900, end_longitude: 1244500 },
      OPCIONES,
      "001",
    );
    expect(l?.latitude).toBeCloseTo(41.1189, 4);
  });

  it("fecha la lectura al FINAL del viaje", () => {
    const l = viajeALectura(
      { start_time: "2026-07-15T08:00:00Z", end_time: "2026-07-15T09:40:00Z" },
      OPCIONES,
      "001",
    );
    expect(l?.capturedAt.toISOString()).toBe("2026-07-15T09:40:00.000Z");
  });

  it("lee el odómetro del libro de ruta, en metros", () => {
    const l = viajeALectura(
      { end_time: "2026-07-15T09:40:00Z", end_odometer: 684327400 },
      OPCIONES,
      "001",
    );
    expect(l?.odometerKm).toBe(684327.4);
    expect(l?.odometerSource).toBe("vehicle");
  });

  it("no convierte la distancia del viaje en odómetro", () => {
    // showTripReportExtern solo trae distancia. Un recorrido NO es un
    // cuentakilómetros, y fabricar uno es justo lo que el hub evita.
    const l = viajeALectura(
      { end_time: "2026-07-15T09:40:00Z", distance: 143000 },
      OPCIONES,
      "001",
    );
    expect(l?.odometerKm).toBeUndefined();
  });

  it("descarta el viaje sin hora de fin", () => {
    expect(viajeALectura({ start_time: "2026-07-15T08:00:00Z" }, OPCIONES, "001")).toBeNull();
  });
});

describe("filasDe()", () => {
  it("acepta el array pelado y el envuelto en data", () => {
    expect(filasDe([{ objectno: "1" }])).toHaveLength(1);
    expect(filasDe({ data: [{ objectno: "1" }, { objectno: "2" }] })).toHaveLength(2);
    expect(filasDe({ errorCode: 9 })).toEqual([]);
  });
});

describe("masCercana()", () => {
  const lectura = (iso: string, km: number): VehicleTelemetry => ({
    provider: "webfleet",
    accountKey: "default",
    providerVehicleId: "001",
    capturedAt: new Date(iso),
    odometerKm: km,
  });

  it("elige la más próxima dentro de la tolerancia", () => {
    const r = masCercana(
      [lectura("2026-07-15T09:00:00Z", 100), lectura("2026-07-15T09:50:00Z", 140)],
      new Date("2026-07-15T09:40:00Z"),
      60,
    );
    expect(r?.odometerKm).toBe(140);
  });

  it("devuelve null si nada cae dentro", () => {
    const r = masCercana([lectura("2026-07-15T06:00:00Z", 100)], new Date("2026-07-15T09:40:00Z"), 15);
    expect(r).toBeNull();
  });
});
