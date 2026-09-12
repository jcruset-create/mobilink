/**
 * Pruebas de la prueba de inmovilidad.
 *
 * Lo que se fija aquí es la frontera entre «este odómetro vale para aquella
 * medición» y «este odómetro lleva kilómetros que el neumático no hizo». Si esa
 * frontera se corre, el informe de desgaste del CheckPoint empieza a repartir
 * kilómetros a ruedas que no los han rodado, y nada chirría al mirarlo.
 */

import { describe, expect, it } from "vitest";
import {
  MOTIVOS_RECHAZO,
  RADIO_QUIETO_M,
  decidirLecturaEnReposo,
  evaluarInmovilidad,
} from "./inmovilidad.ts";
import type { VehicleTelemetry } from "./telematics.ts";

/** Haversine, el mismo cálculo que `server/connect/liteRules.ts`. */
function distanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// La base de Autocares Plana, en Vila-seca. Las posiciones son las que devuelve
// Movertis de verdad para esta flota.
const BASE = { lat: 41.1299667358, lng: 1.18569278717 };
const PASO = new Date("2026-09-10T18:00:00Z");

const punto = (lat: number, lng: number, min: number): VehicleTelemetry => ({
  provider: "movertis",
  accountKey: "default",
  providerVehicleId: "26134116",
  capturedAt: new Date(PASO.getTime() + min * 60_000),
  latitude: lat,
  longitude: lng,
  positionAt: new Date(PASO.getTime() + min * 60_000),
});

/** Un punto a `metros` al norte de la base. */
function alNorte(metros: number, min: number): VehicleTelemetry {
  return punto(BASE.lat + metros / 111_320, BASE.lng, min);
}

describe("evaluarInmovilidad()", () => {
  it("un autobús aparcado sale «quieto», con la deriva del GPS dentro", () => {
    // Un receptor quieto no está quieto: inventa metros durante horas. Por eso
    // el radio no es cero.
    const r = evaluarInmovilidad({
      posiciones: [alNorte(0, 5), alNorte(35, 120), alNorte(18, 400), alNorte(60, 900)],
      desde: PASO,
      distanciaMetros,
    });
    expect(r.estado).toBe("quieto");
    if (r.estado === "quieto") {
      expect(r.puntos).toBe(4);
      expect(r.desplazamientoMaxM).toBeLessThan(RADIO_QUIETO_M);
    }
  });

  it("las maniobras dentro de la base no son una salida", () => {
    // Al lavadero y a otra calle: cientos de metros, cero kilómetros de servicio.
    const r = evaluarInmovilidad({
      posiciones: [alNorte(0, 1), alNorte(250, 30), alNorte(120, 90)],
      desde: PASO,
      distanciaMetros,
    });
    expect(r.estado).toBe("quieto");
  });

  it("una salida se detecta, y se dice cuándo", () => {
    const r = evaluarInmovilidad({
      posiciones: [alNorte(0, 1), alNorte(40, 600), alNorte(4000, 780), alNorte(25000, 800)],
      desde: PASO,
      distanciaMetros,
    });
    expect(r.estado).toBe("se_movio");
    if (r.estado === "se_movio") {
      // La primera que se sale del radio, no la más lejana.
      expect(r.primerMovimientoAt).toEqual(new Date(PASO.getTime() + 780 * 60_000));
      expect(r.desplazamientoMaxM).toBeGreaterThan(20_000);
    }
  });

  it("el que sale y vuelve TAMBIÉN se ha movido", () => {
    // Volver a aparcar en el mismo sitio no deshace los kilómetros: si solo se
    // mirara la última posición, una jornada entera pasaría por inmovilidad.
    const r = evaluarInmovilidad({
      posiciones: [alNorte(0, 1), alNorte(30_000, 300), alNorte(10, 600)],
      desde: PASO,
      distanciaMetros,
    });
    expect(r.estado).toBe("se_movio");
  });

  it("sin emisiones NO es «no se ha movido»", () => {
    // Un equipo apagado y un autobús aparcado se parecen desde fuera. No se
    // confunden.
    expect(evaluarInmovilidad({ posiciones: [], desde: PASO, distanciaMetros }).estado).toBe(
      "sin_emisiones",
    );
  });

  it("las posiciones anteriores al instante no cuentan", () => {
    // El autobús venía de ruta: eso es de antes del arco y no dice nada de
    // después.
    const r = evaluarInmovilidad({
      posiciones: [alNorte(40_000, -120), alNorte(0, 10), alNorte(50, 300)],
      desde: PASO,
      distanciaMetros,
    });
    expect(r.estado).toBe("quieto");
    if (r.estado === "quieto") expect(r.puntos).toBe(2);
  });

  it("una posición sin coordenadas se descarta en vez de contarse", () => {
    const sinPos: VehicleTelemetry = {
      provider: "movertis", accountKey: "default", providerVehicleId: "1",
      capturedAt: new Date(PASO.getTime() + 60_000),
    };
    const r = evaluarInmovilidad({ posiciones: [sinPos], desde: PASO, distanciaMetros });
    expect(r.estado).toBe("sin_emisiones");
  });

  it("el radio se puede estrechar, y entonces la misma maniobra sí cuenta", () => {
    const posiciones = [alNorte(0, 1), alNorte(250, 30)];
    expect(evaluarInmovilidad({ posiciones, desde: PASO, distanciaMetros }).estado).toBe("quieto");
    expect(
      evaluarInmovilidad({ posiciones, desde: PASO, radioM: 100, distanciaMetros }).estado,
    ).toBe("se_movio");
  });
});

describe("decidirLecturaEnReposo()", () => {
  it("quieto: la lectura de ahora vale para entonces", () => {
    const v = decidirLecturaEnReposo({
      capturedAt: new Date(PASO.getTime() + 120 * 60_000),
      desde: PASO,
      prueba: { estado: "quieto", puntos: 3, desplazamientoMaxM: 40, radioM: RADIO_QUIETO_M },
    });
    expect(v).toEqual({ aceptado: true, deltaMinutos: 120 });
  });

  it("se movió: no hay número, y se dice por qué", () => {
    const v = decidirLecturaEnReposo({
      capturedAt: new Date(PASO.getTime() + 600 * 60_000),
      desde: PASO,
      prueba: {
        estado: "se_movio", puntos: 90, desplazamientoMaxM: 30_000,
        radioM: RADIO_QUIETO_M, primerMovimientoAt: new Date(),
      },
    });
    expect(v).toEqual({ aceptado: false, motivo: MOTIVOS_RECHAZO.SE_MOVIO });
  });

  it("sin emisiones y lectura ANTERIOR al paso: vale", () => {
    // El caso normal en esta flota: el equipo se duerme al aparcar. Una lectura
    // anterior al arco no puede llevar kilómetros posteriores a él.
    const v = decidirLecturaEnReposo({
      capturedAt: new Date(PASO.getTime() - 12 * 60_000),
      desde: PASO,
      prueba: { estado: "sin_emisiones" },
    });
    expect(v).toEqual({ aceptado: true, deltaMinutos: -12 });
  });

  it("sin emisiones y lectura POSTERIOR al paso: no vale", () => {
    // Aquí no hay nada que respalde que estuviera quieto, y los kilómetros de
    // en medio podrían estar dentro del número.
    const v = decidirLecturaEnReposo({
      capturedAt: new Date(PASO.getTime() + 30 * 60_000),
      desde: PASO,
      prueba: { estado: "sin_emisiones" },
    });
    expect(v).toEqual({ aceptado: false, motivo: MOTIVOS_RECHAZO.SIN_PRUEBA });
  });

  it("un desfase de segundos es 0 minutos, y 0 de verdad, no -0", () => {
    const v = decidirLecturaEnReposo({
      capturedAt: new Date(PASO.getTime() - 20_000),
      desde: PASO,
      prueba: { estado: "quieto", puntos: 1, desplazamientoMaxM: 0, radioM: RADIO_QUIETO_M },
    });
    expect(v.aceptado).toBe(true);
    if (v.aceptado) {
      expect(v.deltaMinutos).toBe(0);
      expect(Object.is(v.deltaMinutos, -0)).toBe(false);
    }
  });

  it("una lectura de días antes se acepta, pero el desfase lo delata", () => {
    // No se decide por nadie: se entrega el número con su Δ y quien lo lea
    // aplica su tolerancia.
    const v = decidirLecturaEnReposo({
      capturedAt: new Date(PASO.getTime() - 8 * 24 * 60 * 60_000),
      desde: PASO,
      prueba: { estado: "sin_emisiones" },
    });
    expect(v).toEqual({ aceptado: true, deltaMinutos: -11520 });
  });
});
