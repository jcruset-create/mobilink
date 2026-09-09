/**
 * El límite de peticiones, sin reloj real.
 *
 * Todas las funciones reciben el instante, así que se puede probar una ventana
 * de diez minutos sin esperar diez minutos.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  LIMITE_ENVIO, LIMITE_LECTURA, consumir, reiniciarLimites,
} from "./rateLimit.ts";

const T0 = 1_700_000_000_000;

beforeEach(() => reiniciarLimites());

describe("ventana de peticiones", () => {
  it("dentro del límite deja pasar", () => {
    for (let i = 0; i < LIMITE_LECTURA.peticiones; i++) {
      expect(consumir("ip:1", LIMITE_LECTURA, T0).permitido).toBe(true);
    }
  });

  it("la que sobra se rechaza, y dice cuándo volver", () => {
    for (let i = 0; i < LIMITE_LECTURA.peticiones; i++) consumir("ip:1", LIMITE_LECTURA, T0);
    const v = consumir("ip:1", LIMITE_LECTURA, T0);
    expect(v.permitido).toBe(false);
    expect(v.reintentarEnS).toBeGreaterThan(0);
    expect(v.reintentarEnS).toBeLessThanOrEqual(LIMITE_LECTURA.ventanaMs / 1000);
  });

  it("pasada la ventana vuelve a contar de cero", () => {
    for (let i = 0; i <= LIMITE_LECTURA.peticiones; i++) consumir("ip:1", LIMITE_LECTURA, T0);
    expect(consumir("ip:1", LIMITE_LECTURA, T0).permitido).toBe(false);
    const despues = T0 + LIMITE_LECTURA.ventanaMs + 1;
    expect(consumir("ip:1", LIMITE_LECTURA, despues).permitido).toBe(true);
  });

  it("cada clave lleva su propia cuenta", () => {
    for (let i = 0; i <= LIMITE_LECTURA.peticiones; i++) consumir("ip:1", LIMITE_LECTURA, T0);
    expect(consumir("ip:1", LIMITE_LECTURA, T0).permitido).toBe(false);
    expect(consumir("ip:2", LIMITE_LECTURA, T0).permitido).toBe(true);
  });

  it("leer y enviar no comparten cuenta", () => {
    for (let i = 0; i <= LIMITE_ENVIO.peticiones; i++) consumir("post:ip", LIMITE_ENVIO, T0);
    expect(consumir("post:ip", LIMITE_ENVIO, T0).permitido).toBe(false);
    // Gastar los envíos no puede impedirle recargar la página.
    expect(consumir("get:ip", LIMITE_LECTURA, T0).permitido).toBe(true);
  });

  it("enviar es más estricto que leer, que es lo que se recarga", () => {
    expect(LIMITE_ENVIO.peticiones).toBeLessThan(LIMITE_LECTURA.peticiones);
  });
});
