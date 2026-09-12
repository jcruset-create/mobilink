/**
 * Kilómetros a partir del rastro GPS.
 *
 * Lo que se fija aquí es el criterio que acaba en una factura: qué se suma,
 * qué se tira y qué se avisa. Con puntos inventados y sin base de datos,
 * porque lo delicado no es leer la tabla sino decidir.
 */

import { describe, expect, it } from "vitest";
import {
  calcularRecorrido, conEstadoDelHistorial, PRECISION_MAXIMA_M, TRAMO_MINIMO_M,
  type PuntoRastro,
} from "./recorrido.ts";

const T0 = Date.parse("2026-09-11T17:49:00+02:00");

/** Un punto a `metros` al este del origen, a los `segundos` del comienzo. */
function punto(metros: number, segundos: number, extra: Partial<PuntoRastro> = {}): PuntoRastro {
  // A 41,1° de latitud, un grado de longitud son ~84 km
  const gradosPorMetro = 1 / 84_000;
  return {
    lat: 41.1,
    lng: 1.2 + metros * gradosPorMetro,
    ts: T0 + segundos * 1000,
    accuracyM: 10,
    status: "en_route",
    ...extra,
  };
}

describe("kilómetros del rastro", () => {
  it("suma la ida y la vuelta, y no cobra lo que pasa dentro del servicio", () => {
    const r = calcularRecorrido([
      // Ida: 10 km en tramos de 1 km
      ...Array.from({ length: 11 }, (_, i) => punto(i * 1000, i * 60, { status: "en_route" })),
      // Trabajo: se mueve 300 m por el recinto
      punto(10_100, 700, { status: "in_progress" }),
      punto(10_300, 800, { status: "in_progress" }),
      // Vuelta: 10 km de regreso
      ...Array.from({ length: 11 }, (_, i) =>
        punto(10_300 - i * 1000, 900 + i * 60, { status: "returning_to_workshop" })),
    ]);

    expect(r.ida).toBeCloseTo(10.1, 1);  // los 100 m hasta el punto son ida
    expect(r.vuelta).toBeCloseTo(10, 1);
    expect(r.trabajo).toBeGreaterThan(0);
    // Lo que se propone cobrar es el desplazamiento: ida y vuelta
    expect(r.propuestaKm).toBe(20);
    expect(r.calidad).toBe("bueno");
  });

  it("el GPS a la deriva con la furgoneta parada no suma kilómetros", () => {
    // Una hora quieto, con el receptor bailando 10 m cada medio minuto:
    // sumado en crudo serían más de un kilómetro inventado.
    const deriva: PuntoRastro[] = [];
    for (let i = 0; i < 120; i++) {
      deriva.push(punto(i % 2 === 0 ? 0 : TRAMO_MINIMO_M - 5, i * 30, { status: "in_progress" }));
    }
    const r = calcularRecorrido(deriva);
    expect(r.trabajo).toBe(0);
    expect(r.total).toBe(0);
  });

  it("un salto imposible del receptor se descarta en vez de cobrarse", () => {
    const r = calcularRecorrido([
      punto(0, 0),
      punto(1000, 60),
      // 300 km en un segundo: el que salta es el GPS
      punto(301_000, 61),
      punto(2000, 120),
    ]);
    expect(r.total).toBeLessThan(5);
    expect(r.puntosDescartados).toBeGreaterThanOrEqual(1);
  });

  it("los puntos sin precisión suficiente no entran", () => {
    const r = calcularRecorrido([
      punto(0, 0),
      punto(5000, 60, { accuracyM: PRECISION_MAXIMA_M + 150 }),
      punto(1000, 120),
    ]);
    // Solo cuenta el tramo entre los dos puntos buenos
    expect(r.total).toBeCloseTo(1, 1);
    expect(r.puntosDescartados).toBe(1);
  });

  it("un agujero en el rastro se dice, y se cuenta el mínimo que se recorrió", () => {
    const r = calcularRecorrido([
      punto(0, 0),
      punto(1000, 60),
      // Veinte minutos de silencio: la app estuvo muerta
      punto(21_000, 1260),
      punto(22_000, 1320),
      punto(23_000, 1380),
      punto(24_000, 1440),
    ]);
    expect(r.huecos).toHaveLength(1);
    expect(r.huecos[0].minutos).toBe(20);
    // En línea recta son 20 km: es lo mínimo que hizo, y se suma
    expect(r.huecos[0].kmEnLineaRecta).toBeCloseTo(20, 0);
    expect(r.calidad).toBe("con_huecos");
    expect(r.minutosSinRastro).toBe(20);
  });

  it("sin rastro no se inventa un cero creíble: se marca insuficiente", () => {
    expect(calcularRecorrido([]).calidad).toBe("insuficiente");
    expect(calcularRecorrido([punto(0, 0), punto(100, 60)]).calidad).toBe("insuficiente");
  });

  it("el tramo cuenta en el estado en el que empezó, no en el que acabó", () => {
    // El operario marca "llegado" AL llegar: el trayecto anterior es ida.
    const r = calcularRecorrido([
      punto(0, 0, { status: "en_route" }),
      punto(5000, 300, { status: "arrived" }),
    ]);
    expect(r.ida).toBeCloseTo(5, 1);
    expect(r.trabajo).toBe(0);
  });
});

describe("el rastro de Assist toma el estado del historial", () => {
  it("cada punto hereda el estado del último cambio anterior", () => {
    // Rastro denso, como el real: un punto cada pocos segundos.
    const puntos: PuntoRastro[] = [
      punto(0, 0, { status: null }),
      // Ida: 5 km entre el minuto 5 y el 20
      ...Array.from({ length: 6 }, (_, i) => punto(i * 1000, 300 + i * 120, { status: null })),
      // Quieto en el punto de servicio
      punto(5000, 1500, { status: null }),
      // Vuelta: 5 km entre el minuto 40 y el 50
      ...Array.from({ length: 6 }, (_, i) => punto(5000 - i * 1000, 2400 + i * 120, { status: null })),
    ];
    const conEstado = conEstadoDelHistorial(puntos, [
      { status: "asignada", ts: T0 - 60_000 },
      { status: "en_camino", ts: T0 + 300 * 1000 },
      { status: "en_punto", ts: T0 + 1200 * 1000 },
      { status: "en_camino_base", ts: T0 + 2400 * 1000 },
    ]);

    expect(conEstado[0].status).toBe("asignada");
    expect(conEstado[conEstado.length - 1].status).toBe("en_camino_base");

    const r = calcularRecorrido(conEstado);
    expect(r.ida).toBeGreaterThan(4);
    expect(r.vuelta).toBeGreaterThan(3);
    // Ida y vuelta son 10 km; el reparto exacto entre tramos puede bailar un
    // segmento en cada cambio de estado, que en un rastro real son metros.
    expect(r.total).toBeCloseTo(10, 0);
  });

  it("un punto anterior a cualquier cambio se queda sin estado, no se inventa", () => {
    const [p] = conEstadoDelHistorial([punto(0, 0)], [
      { status: "en_camino", ts: T0 + 60_000 },
    ]);
    expect(p.status).toBeNull();
  });
});
