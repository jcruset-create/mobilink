import { describe, expect, it } from "vitest";

import { distanciaKm, estadisticaRecorrido, reducirPuntos, type PuntoRecorrido } from "./recorrido.ts";

/** Un autobús yendo hacia el norte a ~60 km/h, un punto cada `cada` segundos. */
function ruta(n: number, cada: number, t0 = Date.UTC(2026, 10, 24, 6)): PuntoRecorrido[] {
  const pasoGrados = (60 / 3600) * cada / 111.2; // km recorridos en `cada` s, en grados de latitud
  return Array.from({ length: n }, (_, i) => ({ t: t0 + i * cada * 1000, lat: 41.1 + i * pasoGrados, lng: 1.25, velocidad: 60 }));
}

describe("distanciaKm", () => {
  it("un grado de latitud son unos 111 km", () => {
    expect(distanciaKm({ lat: 41, lng: 1 }, { lat: 42, lng: 1 })).toBeCloseTo(111.2, 0);
  });
});

describe("estadisticaRecorrido", () => {
  it("un punto cada 30 s y cuadrando con el resumen: suficiente", () => {
    const p = ruta(121, 30); // 1 h → 60 km
    const e = estadisticaRecorrido(p, 61);
    expect(e.puntos).toBe(121);
    expect(e.intervaloMediana).toBe(30);
    expect(e.kmPorPuntos).toBeCloseTo(60, 0);
    expect(e.conVelocidad).toBe(121);
    expect(e.veredicto).toBe("suficiente");
  });

  it("un punto cada 4 minutos: justo; cada 10: insuficiente", () => {
    expect(estadisticaRecorrido(ruta(16, 240), null).veredicto).toBe("justo");
    expect(estadisticaRecorrido(ruta(7, 600), null).veredicto).toBe("insuficiente");
  });

  it("si los puntos suman mucho menos que el resumen, no basta aunque sean frecuentes", () => {
    expect(estadisticaRecorrido(ruta(121, 30), 200).veredicto).toBe("insuficiente");
  });

  it("parado no cuenta como hueco; un salto de 20 min moviéndose, sí", () => {
    const parado = [0, 1, 2].map((i) => ({ t: Date.UTC(2026, 10, 24, 1) + i * 3_600_000, lat: 41.1, lng: 1.25, velocidad: 0 }));
    const p = [...parado, ...ruta(10, 30, Date.UTC(2026, 10, 24, 6)), ...ruta(10, 30, Date.UTC(2026, 10, 24, 6, 25)).map((x) => ({ ...x, lat: x.lat + 0.2 }))];
    const e = estadisticaRecorrido(p, null);
    expect(e.huecos).toBe(1);
    expect(e.minutosEnHuecos).toBeGreaterThanOrEqual(20);
  });

  it("sin puntos o con uno solo: sin datos", () => {
    expect(estadisticaRecorrido([], 10).veredicto).toBe("sin_datos");
    expect(estadisticaRecorrido(ruta(1, 30), 10).veredicto).toBe("sin_datos");
  });
});

describe("reducirPuntos", () => {
  it("deja como mucho `max`, con el primero y el último", () => {
    const p = Array.from({ length: 5000 }, (_, i) => i);
    const r = reducirPuntos(p, 100);
    expect(r).toHaveLength(100);
    expect(r[0]).toBe(0);
    expect(r[99]).toBe(4999);
  });
});
