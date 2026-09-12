/**
 * Pruebas de la clasificación de presencia.
 *
 * Todo lo de aquí es puro: sin red, sin base y sin reloj. Lo que se fija es
 * que los cinco estados signifiquen lo que dicen, y sobre todo que ninguno de
 * los tres «no se sabe» se cuele como «fuera de la base», que es el error que
 * llenaría la pantalla de ausencias falsas.
 */

import { describe, expect, it } from "vitest";
import {
  ESTADOS_PRESENCIA,
  RADIO_BASE_M,
  dentroDeBase,
  evaluarPresencia,
  type GeoZonaBase,
} from "./presencia.ts";
import type { VehicleTelemetry } from "./telematics.ts";

/**
 * Distancia aproximada en metros, plana.
 *
 * No se usa el haversine de producción a propósito: lo que se prueba aquí es la
 * clasificación, no la trigonometría, y con una aproximación plana los números
 * de la prueba se leen («200 m al norte») en vez de haber que creérselos. A
 * estas escalas —cientos de metros— el error es de centímetros.
 */
const M_POR_GRADO = 111_320;
const distanciaMetros = (laA: number, lnA: number, laB: number, lnB: number) =>
  Math.hypot(
    (laA - laB) * M_POR_GRADO,
    (lnA - lnB) * M_POR_GRADO * Math.cos((laA * Math.PI) / 180),
  );

/** Una coordenada a `metros` al norte de otra. */
const alNorte = (lat: number, metros: number) => lat + metros / M_POR_GRADO;

// Las dos bases reales, con sus coordenadas de verdad: están a 50 km una de
// otra, así que ningún radio de 300 m las solapa.
const REUS: GeoZonaBase = {
  id: "base-reus",
  nombre: "Reus",
  empresaId: "plana",
  lat: 41.128928,
  lng: 1.186083,
  radioM: 300,
};
const VILANOVA: GeoZonaBase = {
  id: "base-vilanova",
  nombre: "Vilanova",
  empresaId: "plana",
  lat: 41.245253,
  lng: 1.717619,
  radioM: 300,
};

const AHORA = new Date("2026-09-12T12:00:00Z");

function lectura(over: Partial<VehicleTelemetry> = {}): VehicleTelemetry {
  return {
    provider: "movertis",
    accountKey: "buses",
    providerVehicleId: "E1",
    capturedAt: AHORA,
    latitude: REUS.lat,
    longitude: REUS.lng,
    positionAt: AHORA,
    ...over,
  };
}

describe("dentroDeBase()", () => {
  it("el borde cuenta como dentro", () => {
    expect(dentroDeBase(REUS, alNorte(REUS.lat, 300), REUS.lng, distanciaMetros).dentro).toBe(true);
    expect(dentroDeBase(REUS, alNorte(REUS.lat, 301), REUS.lng, distanciaMetros).dentro).toBe(false);
  });

  it("sin radio declarado usa el de siempre, 300", () => {
    const sinRadio = { ...REUS, radioM: null };
    expect(RADIO_BASE_M).toBe(300);
    expect(dentroDeBase(sinRadio, alNorte(REUS.lat, 299), REUS.lng, distanciaMetros).dentro).toBe(true);
    expect(dentroDeBase(sinRadio, alNorte(REUS.lat, 400), REUS.lng, distanciaMetros).dentro).toBe(false);
  });
});

describe("evaluarPresencia()", () => {
  const base = { bases: [REUS, VILANOVA], ahora: AHORA, distanciaMetros };

  it("posición reciente dentro de la base: IN_BASE, con la base y la distancia", () => {
    const r = evaluarPresencia({ ...base, lectura: lectura({ latitude: alNorte(REUS.lat, 100) }) });
    expect(r.estado).toBe(ESTADOS_PRESENCIA.IN_BASE);
    expect(r.baseId).toBe("base-reus");
    expect(r.baseNombre).toBe("Reus");
    expect(Math.round(r.distanciaM as number)).toBe(100);
    expect(r.antiguedadMin).toBe(0);
  });

  it("posición reciente fuera de todas: OUTSIDE_BASES, con la distancia a la más cercana", () => {
    const r = evaluarPresencia({ ...base, lectura: lectura({ latitude: alNorte(REUS.lat, 5000) }) });
    expect(r.estado).toBe(ESTADOS_PRESENCIA.OUTSIDE_BASES);
    expect(r.baseId).toBeUndefined();
    expect(Math.round(r.distanciaM as number)).toBe(5000);
  });

  it("el proveedor no dice nada: NO_POSITION, que NO es estar fuera", () => {
    const r = evaluarPresencia({ ...base, lectura: null });
    expect(r.estado).toBe(ESTADOS_PRESENCIA.NO_POSITION);
    expect(r.lat).toBeUndefined();
  });

  it("0,0 no es el Golfo de Guinea: INVALID_POSITION", () => {
    const r = evaluarPresencia({
      ...base,
      lectura: lectura({ latitude: 0, longitude: 0 }),
    });
    expect(r.estado).toBe(ESTADOS_PRESENCIA.INVALID_POSITION);
  });

  it("una posición vieja fuera de las bases es STALE_POSITION, no OUTSIDE_BASES", () => {
    const r = evaluarPresencia({
      ...base,
      lectura: lectura({
        latitude: alNorte(REUS.lat, 5000),
        positionAt: new Date(AHORA.getTime() - 3 * 3600_000),
        capturedAt: new Date(AHORA.getTime() - 3 * 3600_000),
      }),
    });
    expect(r.estado).toBe(ESTADOS_PRESENCIA.STALE_POSITION);
    expect(r.antiguedadMin).toBe(180);
  });

  it("una posición vieja DENTRO de una base conserva dónde se le vio", () => {
    const r = evaluarPresencia({
      ...base,
      lectura: lectura({
        latitude: alNorte(REUS.lat, 50),
        positionAt: new Date(AHORA.getTime() - 5 * 86400_000),
        capturedAt: new Date(AHORA.getTime() - 5 * 86400_000),
      }),
    });
    // No se le asciende a presente: el estado sigue diciendo que la posición
    // es vieja, pero el sitio se informa porque es lo último que se supo.
    expect(r.estado).toBe(ESTADOS_PRESENCIA.STALE_POSITION);
    expect(r.baseId).toBe("base-reus");
  });

  it("el umbral de antigüedad es configurable", () => {
    const hace30 = lectura({
      latitude: alNorte(REUS.lat, 50),
      positionAt: new Date(AHORA.getTime() - 30 * 60_000),
      capturedAt: new Date(AHORA.getTime() - 30 * 60_000),
    });
    expect(evaluarPresencia({ ...base, lectura: hace30 }).estado).toBe(
      ESTADOS_PRESENCIA.IN_BASE,
    );
    expect(
      evaluarPresencia({ ...base, lectura: hace30, antiguedadMaxMin: 15 }).estado,
    ).toBe(ESTADOS_PRESENCIA.STALE_POSITION);
  });

  it("distingue su base de otra base, sin inventar un estado nuevo", () => {
    const enReus = lectura({ latitude: alNorte(REUS.lat, 100) });
    const suya = evaluarPresencia({ ...base, lectura: enReus, delegacionId: "base-reus" });
    expect(suya.estado).toBe(ESTADOS_PRESENCIA.IN_BASE);
    expect(suya.esSuBase).toBe(true);

    const ajena = evaluarPresencia({ ...base, lectura: enReus, delegacionId: "base-vilanova" });
    expect(ajena.estado).toBe(ESTADOS_PRESENCIA.IN_BASE);
    expect(ajena.baseId).toBe("base-reus");
    expect(ajena.esSuBase).toBe(false);
  });

  it("con dos geo-zonas solapadas gana la asignada al vehículo", () => {
    // Un anexo a 50 m del centro de Reus: los dos círculos se pisan.
    const solapada: GeoZonaBase = {
      ...VILANOVA,
      id: "base-anexo",
      nombre: "Anexo",
      lat: alNorte(REUS.lat, 50),
      lng: REUS.lng,
    };
    const r = evaluarPresencia({
      ...base,
      bases: [REUS, solapada],
      lectura: lectura({ latitude: alNorte(REUS.lat, 60) }),
      delegacionId: "base-anexo",
    });
    expect(r.baseId).toBe("base-anexo");
  });

  it("sin posición fechada no se supone que sea de ahora", () => {
    const r = evaluarPresencia({
      ...base,
      lectura: {
        ...lectura({ latitude: alNorte(REUS.lat, 50) }),
        positionAt: undefined,
        capturedAt: undefined as any,
      },
    });
    expect(r.estado).toBe(ESTADOS_PRESENCIA.STALE_POSITION);
    expect(r.antiguedadMin).toBeUndefined();
  });
});
