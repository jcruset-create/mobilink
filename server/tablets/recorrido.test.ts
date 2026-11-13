import { describe, expect, it } from "vitest";

import { analizarRecorrido, distanciaM, type PuntoRecorrido } from "./recorrido.ts";

const T0 = Date.parse("2026-11-13T07:00:00Z");
const MIN = 60_000;
// ~1,1 km por cada 0.01 de latitud.
const TALLER = { lat: 41.1, lng: 1.2 };
const CLIENTE = { lat: 41.2, lng: 1.2 };

/** Quieto en un sitio, un punto por minuto. */
function quieto(sitio: { lat: number; lng: number }, desdeMin: number, minutos: number): PuntoRecorrido[] {
  return Array.from({ length: minutos + 1 }, (_, k) => ({
    lat: sitio.lat + (k % 2) * 0.0002, // el GPS baila unos metros
    lng: sitio.lng,
    atMs: T0 + (desdeMin + k) * MIN,
  }));
}

/** De un sitio a otro en línea recta, un punto por minuto. */
function viaje(a: { lat: number; lng: number }, b: { lat: number; lng: number }, desdeMin: number, minutos: number): PuntoRecorrido[] {
  return Array.from({ length: minutos - 1 }, (_, k) => {
    const f = (k + 1) / minutos;
    return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, atMs: T0 + (desdeMin + k + 1) * MIN, speedKmh: 70 };
  });
}

describe("analizarRecorrido", () => {
  const dia = [
    ...quieto(TALLER, 0, 30),          // 07:00–07:30 en el taller
    ...viaje(TALLER, CLIENTE, 30, 12), // 07:30–07:42 de camino
    ...quieto(CLIENTE, 42, 60),        // 07:42–08:42 con el cliente
    ...viaje(CLIENTE, TALLER, 102, 12),
    ...quieto(TALLER, 114, 20),
  ];

  it("encuentra las tres paradas: taller, cliente, taller", () => {
    const r = analizarRecorrido(dia);
    expect(r.paradas).toHaveLength(3);
    expect(distanciaM(r.paradas[1].lat, r.paradas[1].lng, CLIENTE.lat, CLIENTE.lng)).toBeLessThan(50);
    expect(r.paradas[1].duracionSec).toBe(60 * 60);
  });

  it("dos trayectos, y los km de ida y vuelta", () => {
    const r = analizarRecorrido(dia);
    expect(r.trayectos).toHaveLength(2);
    const ida = distanciaM(TALLER.lat, TALLER.lng, CLIENTE.lat, CLIENTE.lng) / 1000;
    expect(r.km).toBeGreaterThan(ida * 2 * 0.95);
    expect(r.km).toBeLessThan(ida * 2 * 1.05);
    expect(r.trayectos[0].maxKmh).toBe(70);
    expect(r.primeraSalidaMs).toBe(T0 + 30 * MIN);
  });

  it("un salto imposible del GPS no suma kilómetros", () => {
    const conSalto = [...dia];
    // A las 08:00, «en Madrid» un minuto.
    conSalto.push({ lat: 40.4, lng: -3.7, atMs: T0 + 60 * MIN + 30_000 });
    const r = analizarRecorrido(conSalto);
    expect(r.km).toBeCloseTo(analizarRecorrido(dia).km, 3);
  });

  it("los puntos con mala precisión no cuentan", () => {
    const malos = dia.map((p) => ({ ...p, accuracyM: 900 }));
    expect(analizarRecorrido(malos).km).toBe(0);
  });

  it("sin moverse en todo el día: una parada y cero km", () => {
    const r = analizarRecorrido(quieto(TALLER, 0, 120));
    expect(r.paradas).toHaveLength(1);
    expect(r.trayectos).toHaveLength(0);
    expect(r.km).toBe(0);
  });

  it("sin puntos, todo vacío", () => {
    expect(analizarRecorrido([])).toMatchObject({ km: 0, paradas: [], trayectos: [] });
  });
});
