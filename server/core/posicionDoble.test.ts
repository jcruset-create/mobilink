import { describe, expect, it } from "vitest";

import { elegirPosicion, horaWebfleet, MAX_EDAD_POSICION_MS } from "./posicionDoble.ts";

const AHORA = 1_800_000_000_000;
const furgo = (edadMs: number) => ({ lat: 41.1, lng: 1.2, atMs: AHORA - edadMs });
const tablet = (edadMs: number) => ({ lat: 41.3, lng: 1.4, atMs: AHORA - edadMs });

describe("elegirPosicion: Webfleet y la tablet", () => {
  it("con las dos al día, manda Webfleet", () => {
    const p = elegirPosicion({ furgoneta: furgo(10_000), tablet: tablet(1_000), ahoraMs: AHORA });
    expect(p).toMatchObject({ fuente: "furgoneta", antigua: false, lat: 41.1 });
  });

  it("si Webfleet no da posición, la tablet", () => {
    const p = elegirPosicion({ furgoneta: null, tablet: tablet(20_000), ahoraMs: AHORA });
    expect(p).toMatchObject({ fuente: "tablet", antigua: false, lat: 41.3 });
  });

  it("si la de Webfleet es vieja y la de la tablet no, la tablet", () => {
    const p = elegirPosicion({
      furgoneta: furgo(MAX_EDAD_POSICION_MS + 60_000),
      tablet: tablet(30_000),
      ahoraMs: AHORA,
    });
    expect(p?.fuente).toBe("tablet");
  });

  it("si las dos son viejas, la menos vieja, marcada como antigua", () => {
    const p = elegirPosicion({
      furgoneta: furgo(60 * 60_000),
      tablet: tablet(20 * 60_000),
      ahoraMs: AHORA,
    });
    expect(p).toMatchObject({ fuente: "tablet", antigua: true });
  });

  it("un (0, 0) de GPS sin fijar no cuenta como posición", () => {
    const p = elegirPosicion({
      furgoneta: { lat: 0, lng: 0, atMs: AHORA },
      tablet: tablet(10_000),
      ahoraMs: AHORA,
    });
    expect(p?.fuente).toBe("tablet");
  });

  it("sin ninguna de las dos, nada", () => {
    expect(elegirPosicion({ furgoneta: null, tablet: null, ahoraMs: AHORA })).toBeNull();
  });
});

describe("horaWebfleet", () => {
  it("entiende la hora con zona", () => {
    expect(horaWebfleet("2026-10-31T13:00:00+01:00", Date.parse("2026-10-31T13:05:00+01:00")))
      .toBe(Date.parse("2026-10-31T12:00:00Z"));
  });

  it("sin hora o con una que no se entiende, la de ahora", () => {
    expect(horaWebfleet(undefined, AHORA)).toBe(AHORA);
    expect(horaWebfleet("ayer por la tarde", AHORA)).toBe(AHORA);
  });
});
