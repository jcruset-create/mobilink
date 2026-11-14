/**
 * «Posición de hace», calculado al leer.
 *
 * Era la única razón por la que un vehículo quieto necesitaba que se le
 * reescribiera la fila cada cinco minutos. Lo que se fija aquí es que al
 * dejar de reescribirla el número siga siendo verdad —y que siga siendo raya,
 * y no cero, cuando no hay de dónde sacarlo—.
 */

import { describe, expect, it } from "vitest";

import { minutosDesde, refrescarAntiguedad } from "./frescura.ts";

const AHORA = new Date("2026-11-10T17:00:00Z");

describe("minutosDesde()", () => {
  it("cuenta los minutos que han pasado", () => {
    expect(minutosDesde("2026-11-10T16:30:00Z", AHORA)).toBe(30);
    expect(minutosDesde("2026-11-09T17:00:00Z", AHORA)).toBe(1440);
  });

  it("«Z» y «+00:00» son el mismo instante", () => {
    // Supabase devuelve el segundo formato; nosotros escribimos el primero.
    expect(minutosDesde("2026-11-10T16:30:00+00:00", AHORA)).toBe(30);
  });

  it("recién reportado es cero, que es un dato", () => {
    expect(minutosDesde("2026-11-10T17:00:00Z", AHORA)).toBe(0);
  });

  it("un reloj adelantado no sale «dentro de 3 minutos»", () => {
    // Pasa con equipos mal puestos en hora: se enseña 0, no un negativo.
    expect(minutosDesde("2026-11-10T17:03:00Z", AHORA)).toBe(0);
  });

  it("sin instante, o con basura, no hay número", () => {
    expect(minutosDesde(null, AHORA)).toBeNull();
    expect(minutosDesde(undefined, AHORA)).toBeNull();
    expect(minutosDesde("", AHORA)).toBeNull();
    expect(minutosDesde("ayer por la tarde", AHORA)).toBeNull();
  });
});

describe("refrescarAntiguedad()", () => {
  it("pone al día lo que decía la fila guardada", () => {
    // La fila se escribió hace horas diciendo «hace 5 min». Sin esto, la
    // pantalla seguiría diciendo 5.
    const filas = [{ vehiculo_id: "v1", posicion_at: "2026-11-10T13:00:00Z", antiguedad_min: 5 }];
    expect(refrescarAntiguedad(filas, AHORA)[0].antiguedad_min).toBe(240);
  });

  it("sin posición fechada respeta lo que hubiera", () => {
    // No se inventa un cero: un cero diría «acaba de reportar», que es falso.
    const filas = [{ vehiculo_id: "v1", posicion_at: null, antiguedad_min: 77 }];
    expect(refrescarAntiguedad(filas, AHORA)[0].antiguedad_min).toBe(77);
    const sinNada = [{ vehiculo_id: "v2", posicion_at: null, antiguedad_min: null }];
    expect(refrescarAntiguedad(sinNada, AHORA)[0].antiguedad_min).toBeNull();
  });

  it("no toca la lista que recibe", () => {
    // La lista que llega es la que va a la pantalla: modificarla por dentro es
    // la clase de efecto que luego nadie encuentra.
    const filas = [{ vehiculo_id: "v1", posicion_at: "2026-11-10T13:00:00Z", antiguedad_min: 5 }];
    refrescarAntiguedad(filas, AHORA);
    expect(filas[0].antiguedad_min).toBe(5);
  });

  it("conserva el resto de columnas tal cual", () => {
    const filas = [
      {
        vehiculo_id: "v1",
        estado: "IN_BASE",
        delegacion_id: "reus",
        posicion_at: "2026-11-10T16:00:00Z",
        antiguedad_min: 1,
      },
    ];
    expect(refrescarAntiguedad(filas, AHORA)[0]).toEqual({
      vehiculo_id: "v1",
      estado: "IN_BASE",
      delegacion_id: "reus",
      posicion_at: "2026-11-10T16:00:00Z",
      antiguedad_min: 60,
    });
  });

  it("con la lista vacía devuelve lista vacía", () => {
    expect(refrescarAntiguedad([], AHORA)).toEqual([]);
  });
});
