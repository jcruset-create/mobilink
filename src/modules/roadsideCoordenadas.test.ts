import { describe, expect, it } from "vitest";

import { formatCoords } from "./roadsideCoordenadas";

describe("formatCoords", () => {
  it("corta a seis decimales la cola que llega del geocodificador", () => {
    expect(
      formatCoords({ latitude: 41.15423412345, longitude: 1.10678998765 })
    ).toBe("41.154234, 1.106790");
  });

  it("rellena decimales cuando vienen de menos: la longitud fija se lee de un vistazo", () => {
    expect(formatCoords({ latitude: 41, longitude: 1.1 })).toBe(
      "41.000000, 1.100000"
    );
  });

  it("acepta cadenas, que es como llegan por algunos caminos", () => {
    expect(formatCoords({ latitude: "41.154234", longitude: "1.106790" })).toBe(
      "41.154234, 1.106790"
    );
  });

  it("no inventa nada si la asistencia no trae coordenadas", () => {
    expect(formatCoords({ latitude: null, longitude: null })).toBe("");
    expect(formatCoords({})).toBe("");
    expect(formatCoords({ latitude: 41.154234, longitude: null })).toBe("");
    expect(formatCoords({ latitude: null, longitude: 1.10679 })).toBe("");
  });

  it("descarta la basura en vez de pintar «NaN, NaN»", () => {
    expect(formatCoords({ latitude: "sin datos", longitude: "1.1" })).toBe("");
    expect(formatCoords({ latitude: "", longitude: "" })).toBe("");
    expect(formatCoords({ latitude: Infinity, longitude: 1.1 })).toBe("");
  });

  it("el cero es una coordenada válida, no un hueco", () => {
    // Golfo de Guinea. Improbable, pero legítimo: filtrarlo con un `if (!lat)`
    // lo haría desaparecer de la pantalla sin que nadie se enterara.
    expect(formatCoords({ latitude: 0, longitude: 0 })).toBe(
      "0.000000, 0.000000"
    );
  });

  it("aguanta el hemisferio sur y el oeste", () => {
    expect(
      formatCoords({ latitude: -33.868821, longitude: -151.209295 })
    ).toBe("-33.868821, -151.209295");
  });
});
