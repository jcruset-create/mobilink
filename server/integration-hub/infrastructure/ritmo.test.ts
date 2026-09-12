/**
 * El limitador de ritmo.
 *
 * Con reloj y espera inyectados: lo que se prueba es que no deja pasar la
 * petición 101 dentro de la ventana, que espera lo justo, y que dos que piden
 * turno a la vez no se cuelan las dos por el mismo hueco.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { LimitadorDeRitmo, limitadorDe, reiniciarLimitadoresParaPruebas } from "./ritmo.ts";

/** Reloj falso: `esperar` adelanta el tiempo en vez de dormir. */
function relojFalso() {
  let t = 0;
  const esperas: number[] = [];
  return {
    ahora: () => t,
    esperar: async (ms: number) => { esperas.push(ms); t += ms; },
    avanzar: (ms: number) => { t += ms; },
    esperas,
  };
}

describe("LimitadorDeRitmo", () => {
  it("deja pasar hasta el máximo sin esperar", async () => {
    const r = relojFalso();
    const l = new LimitadorDeRitmo({ maximo: 3, ventanaMs: 1000, ...r });
    await l.turno(); await l.turno(); await l.turno();
    expect(r.esperas).toEqual([]);
    expect(l.enVentana()).toBe(3);
  });

  it("la siguiente espera a que caduque la más antigua, ni un ms antes", async () => {
    const r = relojFalso();
    const l = new LimitadorDeRitmo({ maximo: 2, ventanaMs: 1000, ...r });
    await l.turno();          // t=0
    r.avanzar(300);
    await l.turno();          // t=300
    r.avanzar(100);
    await l.turno();          // t=400: la de t=0 caduca en t=1000 → esperar 600
    expect(r.esperas).toEqual([600]);
    expect(r.ahora()).toBe(1000);
  });

  it("dos que piden turno a la vez no pasan por el mismo hueco", async () => {
    const r = relojFalso();
    const l = new LimitadorDeRitmo({ maximo: 1, ventanaMs: 1000, ...r });
    await Promise.all([l.turno(), l.turno(), l.turno()]);
    // Tres turnos con cupo de uno: dos esperas de una ventana entera.
    expect(r.esperas).toEqual([1000, 1000]);
    expect(r.ahora()).toBe(2000);
  });

  it("es una ventana deslizante, no cubos: 100 a las :59 y 100 a las :00 no son legales", async () => {
    const r = relojFalso();
    const l = new LimitadorDeRitmo({ maximo: 100, ventanaMs: 300_000, ...r });
    for (let i = 0; i < 100; i++) await l.turno();
    r.avanzar(299_000);
    await l.turno();
    // La 101 tuvo que esperar a que caducara la primera: 1 s más.
    expect(r.esperas).toEqual([1000]);
  });
});

describe("limitadorDe()", () => {
  beforeEach(() => reiniciarLimitadoresParaPruebas());

  it("la misma cuenta comparte limitador; cuentas distintas no", () => {
    const a1 = limitadorDe("empresa-A/movertis/buses");
    const a2 = limitadorDe("empresa-A/movertis/buses");
    const b = limitadorDe("empresa-A/movertis/auxiliar");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("por defecto trabaja a dos tercios del límite documentado de Movertis", async () => {
    const l = limitadorDe("x");
    // 100 pasan sin esperar; el 101 esperaría. No se espera de verdad aquí:
    // se comprueba el recuento tras 100.
    for (let i = 0; i < 100; i++) await l.turno();
    expect(l.enVentana()).toBe(100);
  });
});
