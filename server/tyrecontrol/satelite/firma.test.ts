import { describe, expect, it } from "vitest";

import { VIDA_FIRMA_MS, firmaValida, firmar, teselaValida } from "./firma.ts";

describe("firma de las teselas de satélite", () => {
  const ahora = 1_800_000_000_000;
  it("una firma recién hecha vale", () => {
    const e = ahora + VIDA_FIRMA_MS;
    expect(firmaValida(firmar(e, "s"), e, ahora, "s")).toBe(true);
  });
  it("caducada, inventada, con otro secreto o con la caducidad cambiada, no", () => {
    const e = ahora + 1000;
    expect(firmaValida(firmar(e, "s"), e, e + 1, "s")).toBe(false);
    expect(firmaValida("abcd", e, ahora, "s")).toBe(false);
    expect(firmaValida(firmar(e, "otro"), e, ahora, "s")).toBe(false);
    expect(firmaValida(firmar(e, "s"), e + 1, ahora, "s")).toBe(false);
    // Una caducidad absurda (firmada para dentro de un año) tampoco.
    const lejos = ahora + 365 * 86_400_000;
    expect(firmaValida(firmar(lejos, "s"), lejos, ahora, "s")).toBe(false);
  });
  it("solo coordenadas de tesela posibles", () => {
    expect(teselaValida(17, 66000, 48000)).toBe(true);
    expect(teselaValida(2, 4, 0)).toBe(false);
    expect(teselaValida(23, 0, 0)).toBe(false);
    expect(teselaValida(1.5, 0, 0)).toBe(false);
  });
});
