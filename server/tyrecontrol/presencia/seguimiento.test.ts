/**
 * Qué vehículos cuentan en «Vehículos en bases».
 *
 * Las dos mitades importan por igual. Si no se filtra, un vehículo que la
 * oficina ha sacado del mantenimiento integral sigue contando en «N dentro» de
 * su base y en los contadores de estado, y nadie entiende por qué no cuadra.
 * Si se filtra de más, desaparece de la pantalla un vehículo al que sí hay que
 * mirarle las ruedas, y eso no se nota hasta que ya es tarde.
 */

import { describe, expect, it } from "vitest";

import { cuentaEnBases, filtrarPresencia } from "./seguimiento.ts";

describe("una fila suelta", () => {
  it("cuenta la de un vehículo activo y en seguimiento", () => {
    expect(cuentaEnBases({ vehiculo: { activo: true, en_seguimiento: true } })).toBe(true);
  });

  it("no cuenta la de uno dado de baja", () => {
    expect(cuentaEnBases({ vehiculo: { activo: false, en_seguimiento: true } })).toBe(false);
  });

  it("no cuenta la de uno fuera del mantenimiento integral", () => {
    expect(cuentaEnBases({ vehiculo: { activo: true, en_seguimiento: false } })).toBe(false);
  });

  it("ante la duda se enseña: sin vehículo, sin columnas o con nulos", () => {
    // Si la fila no trae el vehículo no hay con qué decidir. Esconder uno que
    // sí hay que revisar es peor que contar uno de más.
    expect(cuentaEnBases({})).toBe(true);
    expect(cuentaEnBases({ vehiculo: null })).toBe(true);
    expect(cuentaEnBases({ vehiculo: {} })).toBe(true);
    expect(cuentaEnBases({ vehiculo: { activo: null, en_seguimiento: null } })).toBe(true);
    expect(cuentaEnBases(null)).toBe(true);
    expect(cuentaEnBases(undefined)).toBe(true);
  });
});

describe("la lista entera", () => {
  const flota = [
    { id: "a", vehiculo: { activo: true, en_seguimiento: true } },
    { id: "b", vehiculo: { activo: true, en_seguimiento: false } },
    { id: "c", vehiculo: { activo: false, en_seguimiento: true } },
    { id: "d", vehiculo: { activo: true, en_seguimiento: true } },
    { id: "e", vehiculo: null },
  ];

  it("deja pasar los que cuentan, en el mismo orden", () => {
    expect(filtrarPresencia(flota).filas.map((f) => f.id)).toEqual(["a", "d", "e"]);
  });

  it("dice cuántos ha quitado y por qué", () => {
    const r = filtrarPresencia(flota);
    expect(r.sinSeguimiento).toBe(1);
    expect(r.inactivos).toBe(1);
  });

  it("uno de baja Y sin seguimiento se cuenta como de baja, no dos veces", () => {
    // La baja es la razón más fuerte para no estar, y sumarlo a los dos
    // contadores haría que el aviso de la pantalla dijera un número de más.
    const r = filtrarPresencia([{ vehiculo: { activo: false, en_seguimiento: false } }]);
    expect(r.filas).toHaveLength(0);
    expect(r.inactivos).toBe(1);
    expect(r.sinSeguimiento).toBe(0);
  });

  it("una flota entera en orden no pierde a nadie", () => {
    const todos = Array.from({ length: 50 }, (_, i) => ({
      id: `v${i}`,
      vehiculo: { activo: true, en_seguimiento: true },
    }));
    const r = filtrarPresencia(todos);
    expect(r.filas).toHaveLength(50);
    expect(r.sinSeguimiento).toBe(0);
    expect(r.inactivos).toBe(0);
  });

  it("una lista vacía no es un error", () => {
    expect(filtrarPresencia([])).toEqual({ filas: [], sinSeguimiento: 0, inactivos: 0 });
  });

  it("no toca la lista que recibe", () => {
    const original = [...flota];
    filtrarPresencia(flota);
    expect(flota).toEqual(original);
  });
});
