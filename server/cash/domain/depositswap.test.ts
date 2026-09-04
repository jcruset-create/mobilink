/**
 * Canje de monedas por billetes antes de ir al banco.
 *
 * El escenario de las pruebas es el real del mostrador de Tarragona, con sus
 * cifras: dos cierres pendientes que suman 105,69 €, de los cuales solo 95 €
 * están en billetes.
 */

import { describe, expect, it } from "vitest";
import { mejorCanje, montonTrasCanje } from "./depositswap.ts";
import { inventarioDesdeLineas, lineasDesdeInventario, totalInventario } from "./inventory.ts";

/** 50 + 20×2 + 5 = 95 € en billetes. */
const BILLETES_PENDIENTES = inventarioDesdeLineas([
  { valor: 5000, cantidad: 1 },
  { valor: 2000, cantidad: 2 },
  { valor: 500, cantidad: 1 },
]);

/** 2 €×4 + 1 €×2 + 0,50 + 0,10 + 0,05 + 0,02×2 = 10,69 €. */
const MONEDAS_PENDIENTES = inventarioDesdeLineas([
  { valor: 200, cantidad: 4 },
  { valor: 100, cantidad: 2 },
  { valor: 50, cantidad: 1 },
  { valor: 10, cantidad: 1 },
  { valor: 5, cantidad: 1 },
  { valor: 2, cantidad: 2 },
]);

const valor = (lineas: readonly { valor: number; cantidad: number }[]) =>
  lineas.reduce((a, l) => a + l.valor * l.cantidad, 0);

const piezas = (lineas: readonly { valor: number; cantidad: number }[]) =>
  lineas.reduce((a, l) => a + l.cantidad, 0);

const inv = (...lineas: [number, number][]) =>
  inventarioDesdeLineas(lineas.map(([valor_, cantidad]) => ({ valor: valor_, cantidad })));

describe("canje para el ingreso bancario", () => {
  it("con un billete de 10 en caja, convierte los 10 € que hay en monedas", () => {
    const canje = mejorCanje(
      MONEDAS_PENDIENTES,
      BILLETES_PENDIENTES,
      inventarioDesdeLineas([{ valor: 1000, cantidad: 1 }])
    );
    if (!canje) throw new Error("debería haber canje");

    expect(canje.valorMonedasCentimos).toBe(1000);
    expect(valor(canje.monedasEntregadas)).toBe(1000);
    expect(canje.billetesRecibidos).toEqual([{ valor: 1000, cantidad: 1 }]);

    // Quedan los 0,69 € que no forman una cifra canjeable.
    const despues = montonTrasCanje(MONEDAS_PENDIENTES, BILLETES_PENDIENTES, canje);
    expect(valor(despues.monedas)).toBe(69);
    expect(valor(despues.billetes)).toBe(10500);
  });

  it("sin billete de 10 pero con uno de 50, entrega los 2×20 y se lleva el 50", () => {
    // El caso que el usuario vio a ojo: meter billetes propios en el canje no
    // ingresa más, pero desbloquea el billete grande que sí hay.
    const canje = mejorCanje(
      MONEDAS_PENDIENTES,
      BILLETES_PENDIENTES,
      inventarioDesdeLineas([{ valor: 5000, cantidad: 1 }])
    );
    if (!canje) throw new Error("debería haber canje");

    expect(canje.valorMonedasCentimos).toBe(1000);
    expect(valor(canje.billetesEntregados)).toBe(4000);
    expect(canje.billetesRecibidos).toEqual([{ valor: 5000, cantidad: 1 }]);
    expect(canje.valorCanjeCentimos).toBe(5000);
  });

  it("un canje no crea ni destruye dinero", () => {
    const canje = mejorCanje(
      MONEDAS_PENDIENTES,
      BILLETES_PENDIENTES,
      inventarioDesdeLineas([{ valor: 1000, cantidad: 2 }])
    );
    if (!canje) throw new Error("debería haber canje");

    const antes = totalInventario(MONEDAS_PENDIENTES) + totalInventario(BILLETES_PENDIENTES);
    const despues = montonTrasCanje(MONEDAS_PENDIENTES, BILLETES_PENDIENTES, canje);
    expect(valor(despues.monedas) + valor(despues.billetes)).toBe(antes);

    // Y lo que entra y lo que sale del canje valen lo mismo.
    expect(valor(canje.monedasEntregadas) + valor(canje.billetesEntregados)).toBe(
      valor(canje.billetesRecibidos)
    );
  });

  it("sin billetes en la caja no hay canje: se ingresan solo los 95 €", () => {
    expect(mejorCanje(MONEDAS_PENDIENTES, BILLETES_PENDIENTES, new Map())).toBeNull();
  });

  it("con billetes que no llegan a ninguna cifra formable, tampoco", () => {
    // Solo hay un billete de 500 €: no se puede componer con 10,69 € en
    // monedas y 95 € en billetes propios.
    expect(
      mejorCanje(
        MONEDAS_PENDIENTES,
        BILLETES_PENDIENTES,
        inventarioDesdeLineas([{ valor: 50000, cantidad: 1 }])
      )
    ).toBeNull();
  });

  it("no inventa monedas que no hay", () => {
    // Una sola moneda de 2 €: no se pueden entregar 10 € por mucho que la caja
    // tenga el billete.
    const canje = mejorCanje(
      inventarioDesdeLineas([{ valor: 200, cantidad: 1 }]),
      new Map(),
      inventarioDesdeLineas([{ valor: 1000, cantidad: 1 }])
    );
    expect(canje).toBeNull();
  });

  it("elige el mayor valor en monedas, no el canje más cómodo", () => {
    // Caja con un billete de 5 y otro de 10. Con el de 5 se convierten 5 €;
    // con el de 10, diez. Tiene que salir el de 10.
    const canje = mejorCanje(
      inventarioDesdeLineas([{ valor: 100, cantidad: 10 }]),
      new Map(),
      inventarioDesdeLineas([
        { valor: 1000, cantidad: 1 },
        { valor: 500, cantidad: 1 },
      ])
    );
    if (!canje) throw new Error("debería haber canje");
    expect(canje.valorMonedasCentimos).toBe(1000);
  });

  it("teniendo el de 10 Y el de 50, se lleva el de 50", () => {
    /*
     * El caso que manda: con 2×20 en el montón y 10 € en monedas, la propuesta
     * es entregar los dos de 20 con las monedas y llevarse el de 50. Los dos
     * canjes ingresan lo mismo, pero éste deja al cajón los dos billetes de 20
     * y la calderilla, y le quita el billete gordo.
     */
    const canje = mejorCanje(
      MONEDAS_PENDIENTES,
      BILLETES_PENDIENTES,
      inventarioDesdeLineas([
        { valor: 5000, cantidad: 1 },
        { valor: 1000, cantidad: 1 },
      ])
    );
    if (!canje) throw new Error("debería haber canje");

    expect(canje.valorMonedasCentimos).toBe(1000);
    expect(canje.billetesRecibidos).toEqual([{ valor: 5000, cantidad: 1 }]);
    expect(canje.billetesEntregados).toEqual([{ valor: 2000, cantidad: 2 }]);
  });

  it("el billete grande manda aunque haya que entregar más billetes propios", () => {
    // Con un 20 y un 50 en caja: gana el 50, entregando los dos de 20.
    const canje = mejorCanje(
      inventarioDesdeLineas([{ valor: 200, cantidad: 5 }]),
      inventarioDesdeLineas([{ valor: 2000, cantidad: 2 }]),
      inventarioDesdeLineas([
        { valor: 5000, cantidad: 1 },
        { valor: 2000, cantidad: 1 },
      ])
    );
    if (!canje) throw new Error("debería haber canje");
    expect(canje.valorMonedasCentimos).toBe(1000);
    expect(canje.billetesRecibidos).toEqual([{ valor: 5000, cantidad: 1 }]);
  });

  it("a igual conversión, se lleva menos billetes y deja más calderilla", () => {
    // Se pueden convertir 10 € llevándose un billete de 10, o dos de 5. Gana
    // el de 10: la caja se queda con los dos de 5, que sirven para cambio.
    const canje = mejorCanje(
      inventarioDesdeLineas([{ valor: 200, cantidad: 5 }]),
      new Map(),
      inventarioDesdeLineas([
        { valor: 1000, cantidad: 1 },
        { valor: 500, cantidad: 2 },
      ])
    );
    if (!canje) throw new Error("debería haber canje");
    expect(canje.billetesRecibidos).toEqual([{ valor: 1000, cantidad: 1 }]);
  });

  it("sin monedas pendientes no hay nada que canjear", () => {
    expect(
      mejorCanje(new Map(), BILLETES_PENDIENTES, inventarioDesdeLineas([{ valor: 5000, cantidad: 2 }]))
    ).toBeNull();
  });
});

describe("juntar los billetes chicos en gordos", () => {
  /*
   * El caso real de Tarragona: la bolsa lleva 100 € en billetes pequeños
   * —3×20 + 3×10 + 2×5— más 5,76 € en monedas, y el cajón tiene billetes de
   * 50. Antes la propuesta se conformaba con el canje más pequeño que cuadrara
   * (soltar 45 € y llevarse un billete de 50) y la bolsa se iba al banco con
   * seis billetes. Ahora se sueltan los ocho y vuelven tres.
   */
  const MONEDAS = inv([100, 3], [50, 3], [20, 4], [10, 3], [5, 2], [2, 2], [1, 2]);
  const BOLSA = inv([2000, 3], [1000, 3], [500, 2]);
  const CAJON = inv([5000, 4], [2000, 2], [1000, 2], [500, 2]);

  it("suelta los ocho billetes pequeños y se lleva los gordos", () => {
    const c = mejorCanje(MONEDAS, BOLSA, CAJON)!;
    expect(c).not.toBeNull();
    // Sigue convirtiendo todas las monedas que se pueden: 5,00 € de 5,76 €.
    expect(c.valorMonedasCentimos).toBe(500);
    // Y entrega los billetes pequeños enteros, no un trozo.
    expect(piezas(c.billetesEntregados)).toBe(8);
    expect(valor(c.billetesEntregados)).toBe(10000);
    // Se lleva menos billetes de los que da: por eso la bolsa adelgaza.
    expect(piezas(c.billetesRecibidos)).toBeLessThan(8);
  });

  it("la bolsa acaba con menos billetes y el mismo dinero", () => {
    const c = mejorCanje(MONEDAS, BOLSA, CAJON)!;
    const despues = montonTrasCanje(MONEDAS, BOLSA, c);
    expect(piezas(despues.billetes)).toBeLessThan(piezas(lineasDesdeInventario(BOLSA)));
    // Ni un céntimo de más ni de menos: un canje no crea ni destruye dinero.
    expect(valor(despues.billetes) + valor(despues.monedas)).toBe(
      totalInventario(MONEDAS) + totalInventario(BOLSA)
    );
  });

  it("sin monedas también junta los billetes", () => {
    // Es lo que antes no hacía: sin nada que convertir devolvía null y la
    // bolsa se iba al banco con ocho billetes pudiendo ir con dos.
    const c = mejorCanje(inv(), BOLSA, CAJON)!;
    expect(c).not.toBeNull();
    expect(c.valorMonedasCentimos).toBe(0);
    expect(valor(c.billetesEntregados)).toBe(10000);
    expect(c.billetesRecibidos).toEqual([{ valor: 5000, cantidad: 2 }]);
  });

  it("NO propone cambiar un billete por otro igual", () => {
    // Sin monedas y con la bolsa ya en billetes gordos no hay nada que juntar:
    // entregar un 50 para llevarse otro 50 es mover papel por mover papel.
    expect(mejorCanje(inv(), inv([5000, 2]), inv([5000, 3]))).toBeNull();
  });

  it("con lo que haya en el cajón: si solo hay de 10, junta lo que pueda", () => {
    // No hace falta llegar al de 50 para que compense: cambiar los dos de 5
    // por uno de 10 ya deja un billete menos en la bolsa.
    const c = mejorCanje(inv(), BOLSA, inv([1000, 12]))!;
    expect(c).not.toBeNull();
    expect(piezas(c.billetesRecibidos)).toBeLessThan(piezas(c.billetesEntregados));
    expect(valor(c.billetesRecibidos)).toBe(valor(c.billetesEntregados));
  });

  it("si no hay forma de bajar el número de billetes, no se propone nada", () => {
    // El cajón solo tiene de 5: cualquier cambio devuelve tantos billetes como
    // se entregan, o más. Mover papel por mover papel no es una propuesta.
    expect(mejorCanje(inv(), BOLSA, inv([500, 40]))).toBeNull();
  });

  it("convertir monedas sigue mandando sobre juntar billetes", () => {
    /*
     * Si hay que elegir, primero se convierten las monedas: eso SUBE lo que se
     * ingresa, y juntar billetes solo cambia la forma. Aquí el cajón solo puede
     * dar 20 €, así que se gasta en convertir las monedas.
     */
    const c = mejorCanje(inv([100, 20]), inv([1000, 2]), inv([2000, 1]))!;
    expect(c.valorMonedasCentimos).toBe(2000 - valor(c.billetesEntregados));
    expect(c.valorMonedasCentimos).toBeGreaterThan(0);
  });
});
