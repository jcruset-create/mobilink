/**
 * Dónde está la tablet de cada operario.
 *
 * Lo que se fija aquí son las tres reglas que el almacén de Assist aprendió a
 * base de verlas fallar, y que esta copia tiene que respetar igual:
 *
 *   · un GPS sin fijar devuelve (0, 0), y eso no es un sitio;
 *   · una posición vieja que llega tarde no puede pisar a una más nueva;
 *   · una posición de hace un día no dice dónde está nadie ahora.
 */

import { describe, expect, it } from "vitest";

import { esReciente, MAX_EDAD_MS, posicionValida } from "./posicionTablet.ts";

describe("qué es una posición y qué no", () => {
  it("unas coordenadas normales valen", () => {
    expect(posicionValida({ lat: 41.1189, lng: 1.2445 })).toBe(true); // Tarragona
    expect(posicionValida({ lat: -33.86, lng: 151.2 })).toBe(true); // el otro hemisferio
  });

  it("el (0, 0) no: es un GPS que todavía no ha fijado", () => {
    // La isla Null, en el golfo de Guinea. Nadie está ahí. Una tablet en mitad
    // del Atlántico es peor que una tablet que no sale.
    expect(posicionValida({ lat: 0, lng: 0 })).toBe(false);
  });

  it("un cero solo sí vale: el meridiano y el ecuador existen", () => {
    expect(posicionValida({ lat: 41.1, lng: 0 })).toBe(true);
    expect(posicionValida({ lat: 0, lng: 1.2 })).toBe(true);
  });

  it("fuera del mundo, no", () => {
    expect(posicionValida({ lat: 91, lng: 0 })).toBe(false);
    expect(posicionValida({ lat: -91, lng: 0 })).toBe(false);
    expect(posicionValida({ lat: 0, lng: 181 })).toBe(false);
    expect(posicionValida({ lat: 0, lng: -181 })).toBe(false);
  });

  it("lo que no es un número, tampoco", () => {
    expect(posicionValida({ lat: Number.NaN, lng: 1 })).toBe(false);
    expect(posicionValida({ lat: 1, lng: Number.POSITIVE_INFINITY })).toBe(false);
    expect(posicionValida({ lat: "41.1", lng: "1.2" })).toBe(false);
    expect(posicionValida({ lat: null, lng: null })).toBe(false);
    expect(posicionValida({ lat: undefined, lng: undefined })).toBe(false);
  });
});

describe("cuándo una posición todavía dice algo", () => {
  const ahora = Date.UTC(2026, 10, 9, 17, 0, 0);

  it("la de hace un rato, sí", () => {
    expect(esReciente(new Date(ahora - 60_000).toISOString(), ahora)).toBe(true);
    expect(esReciente(new Date(ahora - 6 * 3600_000).toISOString(), ahora)).toBe(true);
  });

  it("justo en el límite de las 24 h, sí; pasado, no", () => {
    expect(esReciente(new Date(ahora - MAX_EDAD_MS).toISOString(), ahora)).toBe(true);
    expect(esReciente(new Date(ahora - MAX_EDAD_MS - 1000).toISOString(), ahora)).toBe(false);
  });

  it("una posición del futuro es un reloj mal puesto, no un dato", () => {
    // Un margen de cinco minutos para el desfase normal entre relojes; más
    // allá, la tablet tiene la hora mal y su posición no se puede ordenar
    // contra las demás.
    expect(esReciente(new Date(ahora + 60_000).toISOString(), ahora)).toBe(true);
    expect(esReciente(new Date(ahora + 10 * 60_000).toISOString(), ahora)).toBe(false);
  });

  it("sin fecha, o con una que no se entiende, no", () => {
    expect(esReciente(null, ahora)).toBe(false);
    expect(esReciente(undefined, ahora)).toBe(false);
    expect(esReciente("", ahora)).toBe(false);
    expect(esReciente("ayer por la tarde", ahora)).toBe(false);
  });

  it("acepta también un Date, no solo el texto de Supabase", () => {
    expect(esReciente(new Date(ahora - 1000), ahora)).toBe(true);
  });
});
