/**
 * El limitador de ritmo.
 *
 * Con reloj y espera inyectados: lo que se prueba es que no deja pasar la
 * petición 101 dentro de la ventana, que espera lo justo, y que dos que piden
 * turno a la vez no se cuelan las dos por el mismo hueco.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { ErrorRitmo, LimitadorDeRitmo, limitadorDe, reiniciarLimitadoresParaPruebas, ritmoDeConfig } from "./ritmo.ts";

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

describe("espera máxima", () => {
  it("si el turno no llega a tiempo, se rinde en vez de colgar la pantalla", async () => {
    const r = relojFalso();
    const l = new LimitadorDeRitmo({ maximo: 1, ventanaMs: 300_000, ...r });
    await l.turno();

    // Quedan 300 s para el siguiente turno y solo se pueden esperar 45.
    await expect(l.turno(45_000)).rejects.toBeInstanceOf(ErrorRitmo);
    // Y no ha dormido nada: rendirse es inmediato.
    expect(r.esperas).toEqual([]);
  });

  it("el error dice cuánto falta, para poder contarlo", async () => {
    const r = relojFalso();
    const l = new LimitadorDeRitmo({ maximo: 1, ventanaMs: 300_000, ...r });
    await l.turno();
    r.avanzar(100_000);
    await l.turno(1000).catch((e: ErrorRitmo) => {
      expect(e.esperaMs).toBe(200_000);
      expect(e.message).toContain("200 s");
    });
  });

  it("si cabe dentro del margen, espera y pasa", async () => {
    const r = relojFalso();
    const l = new LimitadorDeRitmo({ maximo: 1, ventanaMs: 1000, ...r });
    await l.turno();
    await expect(l.turno(5000)).resolves.toBeUndefined();
    expect(r.esperas).toEqual([1000]);
  });

  it("sin margen declarado espera lo que haga falta: es lo que hace el job", async () => {
    const r = relojFalso();
    const l = new LimitadorDeRitmo({ maximo: 1, ventanaMs: 300_000, ...r });
    await l.turno();
    await expect(l.turno()).resolves.toBeUndefined();
    expect(r.esperas).toEqual([300_000]);
  });

  it("un turno que se rinde no rompe la cola: el siguiente sigue funcionando", async () => {
    const r = relojFalso();
    const l = new LimitadorDeRitmo({ maximo: 1, ventanaMs: 1000, ...r });
    await l.turno();
    await expect(l.turno(1)).rejects.toBeInstanceOf(ErrorRitmo);
    await expect(l.turno()).resolves.toBeUndefined();
  });
});

describe("ritmoDeConfig()", () => {
  it("sin config, el techo documentado", () => {
    expect(ritmoDeConfig(undefined)).toEqual({ maximo: 100, ventanaMs: 300_000 });
    expect(ritmoDeConfig({})).toEqual({ maximo: 100, ventanaMs: 300_000 });
  });

  it("una cuenta puede pedir MENOS: una petición cada cinco minutos", () => {
    expect(ritmoDeConfig({ ritmo: { maximo: 1, ventanaMs: 300_000 } })).toEqual({ maximo: 1, ventanaMs: 300_000 });
  });

  it("una cuenta NO puede subirse el límite del proveedor", () => {
    expect(ritmoDeConfig({ ritmo: { maximo: 5000 } })).toEqual({ maximo: 100, ventanaMs: 300_000 });
    // Cien en un segundo es trescientas veces el techo: se ignora entero.
    expect(ritmoDeConfig({ ritmo: { maximo: 100, ventanaMs: 1000 } })).toEqual({ maximo: 100, ventanaMs: 300_000 });
  });

  it("una ventana más larga vale: es pedir menos", () => {
    expect(ritmoDeConfig({ ritmo: { maximo: 20, ventanaMs: 600_000 } })).toEqual({ maximo: 20, ventanaMs: 600_000 });
  });

  it("una ventana más CORTA también vale si el ritmo resultante es menor", () => {
    // «Una por minuto» es la vigésima parte de 100/5 min, y es lo único que
    // ESPACIA de verdad: con 12/5 min salen doce seguidas, que es la ráfaga
    // que tumbó a Movertis.
    expect(ritmoDeConfig({ ritmo: { maximo: 1, ventanaMs: 60_000 } })).toEqual({ maximo: 1, ventanaMs: 60_000 });
    expect(ritmoDeConfig({ ritmo: { maximo: 2, ventanaMs: 60_000 } })).toEqual({ maximo: 2, ventanaMs: 60_000 });
  });

  it("una ventana absurdamente corta se sanea en vez de aceptarse a ciegas", () => {
    // Menos de un segundo no es un ritmo, es un descuido.
    expect(ritmoDeConfig({ ritmo: { maximo: 1, ventanaMs: 10 } })).toEqual({ maximo: 1, ventanaMs: 300_000 });
  });

  it("basura en la config no rompe nada: se cae al techo", () => {
    expect(ritmoDeConfig({ ritmo: { maximo: "mucho", ventanaMs: null } })).toEqual({ maximo: 100, ventanaMs: 300_000 });
    expect(ritmoDeConfig({ ritmo: { maximo: 0 } }).maximo).toBe(100);
  });
});

describe("limitadorDe() con ritmos distintos", () => {
  beforeEach(() => reiniciarLimitadoresParaPruebas());

  it("cambiar el ritmo en la config construye otro limitador, sin reiniciar", () => {
    const antes = limitadorDe("cuenta", { maximo: 100, ventanaMs: 300_000 });
    const despues = limitadorDe("cuenta", { maximo: 1, ventanaMs: 300_000 });
    expect(despues).not.toBe(antes);
    expect(despues.ritmo).toEqual({ maximo: 1, ventanaMs: 300_000 });
  });

  it("con el mismo ritmo se comparte, que es lo que reparte el cupo", () => {
    const a = limitadorDe("cuenta", { maximo: 20, ventanaMs: 300_000 });
    const b = limitadorDe("cuenta", { maximo: 20, ventanaMs: 300_000 });
    expect(a).toBe(b);
  });
});
