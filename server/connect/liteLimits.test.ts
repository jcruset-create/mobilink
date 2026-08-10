import { describe, it, expect } from "vitest";
import {
  hitLimit, limitKey, newLimitStore, pruneLimitStore, LITE_LIMITS,
} from "./liteLimits.ts";

const politica = { limit: 3, windowMs: 1000 };

describe("límites de uso de la API de Lite", () => {
  it("deja pasar hasta el tope y rechaza el siguiente", () => {
    const store = newLimitStore();
    const t = 1_000_000;
    expect(hitLimit(store, "k", politica, t).allowed).toBe(true);
    expect(hitLimit(store, "k", politica, t + 1).allowed).toBe(true);
    const tercera = hitLimit(store, "k", politica, t + 2);
    expect(tercera.allowed).toBe(true);
    expect(tercera.remaining).toBe(0);
    expect(hitLimit(store, "k", politica, t + 3).allowed).toBe(false);
  });

  it("la ventana se desliza: al salir la más antigua vuelve a haber hueco", () => {
    const store = newLimitStore();
    const t = 2_000_000;
    hitLimit(store, "k", politica, t);
    hitLimit(store, "k", politica, t + 100);
    hitLimit(store, "k", politica, t + 200);
    expect(hitLimit(store, "k", politica, t + 300).allowed).toBe(false);
    // Justo pasada la ventana de la primera marca
    expect(hitLimit(store, "k", politica, t + 1001).allowed).toBe(true);
  });

  it("insistir no alarga el bloqueo", () => {
    // Si las llamadas rechazadas se anotaran, la ventana no se vaciaría nunca
    // y un cliente en bucle se autobloquearía de forma permanente.
    const store = newLimitStore();
    const t = 3_000_000;
    for (let i = 0; i < 3; i++) hitLimit(store, "k", politica, t);
    for (let i = 0; i < 50; i++) hitLimit(store, "k", politica, t + 500);
    expect(hitLimit(store, "k", politica, t + 1001).allowed).toBe(true);
  });

  it("el tiempo de espera apunta a cuando queda hueco de verdad", () => {
    const store = newLimitStore();
    const t = 4_000_000;
    hitLimit(store, "k", politica, t);
    hitLimit(store, "k", politica, t + 400);
    hitLimit(store, "k", politica, t + 800);
    const v = hitLimit(store, "k", politica, t + 900);
    expect(v.allowed).toBe(false);
    // La más antigua sale en t+1000, o sea dentro de 100 ms → se redondea a 1 s
    expect(v.retryAfterSec).toBe(1);
  });

  it("cada clave lleva su propia cuenta", () => {
    const store = newLimitStore();
    const t = 5_000_000;
    for (let i = 0; i < 3; i++) hitLimit(store, limitKey("files", 1), politica, t);
    expect(hitLimit(store, limitKey("files", 1), politica, t).allowed).toBe(false);
    expect(hitLimit(store, limitKey("files", 2), politica, t).allowed).toBe(true);
    expect(hitLimit(store, limitKey("location", 1), politica, t).allowed).toBe(true);
  });

  it("la limpieza tira las claves inactivas y respeta las vivas", () => {
    const store = newLimitStore();
    const t = 6_000_000;
    hitLimit(store, "vieja", politica, t);
    hitLimit(store, "nueva", politica, t + 500_000);
    const borradas = pruneLimitStore(store, t + 600_000, 300_000);
    expect(borradas).toBe(1);
    expect(store.has("vieja")).toBe(false);
    expect(store.has("nueva")).toBe(true);
  });

  it("las políticas reales dejan holgura sobre el uso normal", () => {
    // El seguimiento más agresivo manda un punto cada 5 s: 12 por minuto.
    expect(LITE_LIMITS.location.limit).toBeGreaterThan(12 * 5);
    // Un servicio bien documentado ronda las 10 fotografías.
    expect(LITE_LIMITS.files.limit).toBeGreaterThan(10 * 3);
    // El tope por dispositivo tiene que quedar por encima de cada familia.
    expect(LITE_LIMITS.device.limit).toBeGreaterThan(LITE_LIMITS.location.limit);
  });
});
