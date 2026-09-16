import { describe, expect, it } from "vitest";
import { BLOQUEO_MS, INTENTOS_MAX, estaBloqueado, minutosRestantes, pinValido, trasFallo } from "./pin.ts";

describe("pinValido", () => {
  it("acepta de 4 a 8 dígitos y nada más", () => {
    expect(pinValido("1234")).toBe(true);
    expect(pinValido("12345678")).toBe(true);
    expect(pinValido("123")).toBe(false);
    expect(pinValido("123456789")).toBe(false);
    expect(pinValido("12a4")).toBe(false);
    expect(pinValido("")).toBe(false);
    expect(pinValido(" 1234 ")).toBe(false);
  });
});

describe("trasFallo", () => {
  const ahora = new Date("2026-09-16T10:00:00Z");

  it("va sumando hasta el tope sin bloquear", () => {
    expect(trasFallo(0, ahora)).toEqual({ intentos: 1, bloqueadoHasta: null });
    expect(trasFallo(INTENTOS_MAX - 2, ahora)).toEqual({ intentos: INTENTOS_MAX - 1, bloqueadoHasta: null });
  });

  it("al llegar al tope bloquea y pone el contador a cero", () => {
    const r = trasFallo(INTENTOS_MAX - 1, ahora);
    expect(r.intentos).toBe(0);
    expect(r.bloqueadoHasta?.getTime()).toBe(ahora.getTime() + BLOQUEO_MS);
  });

  it("el siguiente bloqueo vuelve a pedir cinco fallos, no cae al primero", () => {
    let estado = trasFallo(INTENTOS_MAX - 1, ahora);
    for (let i = 1; i < INTENTOS_MAX; i += 1) {
      estado = trasFallo(estado.intentos, ahora);
      expect(estado.bloqueadoHasta, `el fallo ${i} tras un bloqueo no debería bloquear`).toBeNull();
    }
    expect(trasFallo(estado.intentos, ahora).bloqueadoHasta).not.toBeNull();
  });
});

describe("estaBloqueado y minutosRestantes", () => {
  const ahora = new Date("2026-09-16T10:00:00Z");

  it("sin fecha no hay bloqueo, y una fecha pasada tampoco", () => {
    expect(estaBloqueado(null, ahora)).toBe(false);
    expect(estaBloqueado(new Date("2026-09-16T09:59:59Z"), ahora)).toBe(false);
    expect(estaBloqueado(new Date("2026-09-16T10:00:01Z"), ahora)).toBe(true);
  });

  it("los minutos que faltan se redondean hacia arriba y nunca son cero", () => {
    expect(minutosRestantes(new Date("2026-09-16T10:04:30Z"), ahora)).toBe(5);
    expect(minutosRestantes(new Date("2026-09-16T10:00:01Z"), ahora)).toBe(1);
  });
});
