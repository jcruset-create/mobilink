/**
 * Pruebas del arqueo y del reparto de cierre.
 *
 * El caso que da sentido a todo el fichero es "mismo importe, denominaciones
 * distintas": es el descuadre que un total no ve y que este módulo existe para
 * detectar.
 */

import { describe, it, expect } from "vitest";
import { esExito, esFallo } from "./result.ts";
import { compararArqueo, repartirCierre, proponerCambioFinal } from "./arqueo.ts";
import { type LineaDenominacion, inventarioDesdeLineas, totalInventario } from "./inventory.ts";

const TEORICO: LineaDenominacion[] = [
  { valor: 5000, cantidad: 8 }, // 400 €
  { valor: 2000, cantidad: 12 }, // 240 €
  { valor: 1000, cantidad: 4 }, //  40 €
  { valor: 500, cantidad: 4 }, //  20 €
];

describe("arqueo", () => {
  it("caja cuadrada: importe y piezas coinciden", () => {
    const r = compararArqueo(inventarioDesdeLineas(TEORICO), inventarioDesdeLineas(TEORICO));
    expect(r.estado).toBe("CUADRADA");
    expect(r.diferencia).toBe(0);
    expect(r.cuadraImporte).toBe(true);
    expect(r.cuadranDenominaciones).toBe(true);
    expect(r.descuadres).toEqual([]);
  });

  it("faltante: se han contado menos euros de los que debía haber", () => {
    const contado = inventarioDesdeLineas([...TEORICO.slice(1), { valor: 5000, cantidad: 7 }]);
    const r = compararArqueo(inventarioDesdeLineas(TEORICO), contado);
    expect(r.estado).toBe("FALTANTE");
    expect(r.diferencia).toBe(-5000);
    expect(r.descuadres).toHaveLength(1);
    expect(r.descuadres[0]).toMatchObject({ valor: 5000, teorico: 8, contado: 7, diferencia: -1 });
  });

  it("sobrante", () => {
    const contado = inventarioDesdeLineas([...TEORICO, { valor: 1000, cantidad: 2 }]);
    const r = compararArqueo(inventarioDesdeLineas(TEORICO), contado);
    expect(r.estado).toBe("SOBRANTE");
    expect(r.diferencia).toBe(2000);
  });

  it("mismo importe pero denominaciones distintas: importe cuadra, piezas no", () => {
    // Faltan 2 billetes de 20 € (−40 €) y sobran 4 de 10 € (+40 €).
    const contado = inventarioDesdeLineas([
      { valor: 5000, cantidad: 8 },
      { valor: 2000, cantidad: 10 },
      { valor: 1000, cantidad: 8 },
      { valor: 500, cantidad: 4 },
    ]);
    const r = compararArqueo(inventarioDesdeLineas(TEORICO), contado);

    expect(r.totalTeorico).toBe(r.totalContado);
    expect(r.diferencia).toBe(0);
    expect(r.estado).toBe("CUADRADA");
    // Y sin embargo:
    expect(r.cuadraImporte).toBe(true);
    expect(r.cuadranDenominaciones).toBe(false);
    expect(r.descuadres).toHaveLength(2);
    expect(r.descuadres.find((d) => d.valor === 2000)).toMatchObject({
      diferencia: -2,
      importeDiferencia: -4000,
    });
    expect(r.descuadres.find((d) => d.valor === 1000)).toMatchObject({
      diferencia: 4,
      importeDiferencia: 4000,
    });
    // Las piezas totales sí delatan que algo pasó.
    expect(r.piezasContadas).not.toBe(r.piezasTeoricas);
  });

  it("una denominación contada que no estaba en el teórico también aparece", () => {
    const contado = inventarioDesdeLineas([...TEORICO, { valor: 200, cantidad: 3 }]);
    const r = compararArqueo(inventarioDesdeLineas(TEORICO), contado);
    const linea = r.descuadres.find((d) => d.valor === 200);
    expect(linea).toMatchObject({ teorico: 0, contado: 3, diferencia: 3 });
  });
});

describe("reparto del cierre", () => {
  const contado = inventarioDesdeLineas([
    { valor: 10000, cantidad: 5 }, // 500 €
    { valor: 5000, cantidad: 4 }, // 200 €
    { valor: 2000, cantidad: 8 }, // 160 €
    { valor: 1000, cantidad: 4 }, //  40 €
    { valor: 500, cantidad: 4 }, //  20 €
    { valor: 200, cantidad: 10 }, //  20 €
  ]);

  it("el cambio final más el ingreso bancario suman el arqueo, pieza a pieza", () => {
    // 100 + 120 + 40 + 20 + 20 = 300 €
    const cambioFinal: LineaDenominacion[] = [
      { valor: 5000, cantidad: 2 },
      { valor: 2000, cantidad: 6 },
      { valor: 1000, cantidad: 4 },
      { valor: 500, cantidad: 4 },
      { valor: 200, cantidad: 10 },
    ];
    const r = repartirCierre(contado, cambioFinal);
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;

    expect(r.totalCambio).toBe(30000); // 300 €
    expect(r.totalCambio + r.totalIngreso).toBe(totalInventario(contado));

    // El mismo billete no puede estar en los dos sitios.
    const ingreso = inventarioDesdeLineas(r.ingresoBancario);
    expect(ingreso.get(10000)).toBe(5);
    expect(ingreso.get(5000)).toBe(2); // había 4, se quedan 2
    expect(ingreso.get(2000)).toBe(2); // había 8, se quedan 6
    expect(ingreso.get(1000)).toBeUndefined(); // se quedan todos en caja
  });

  it("no se puede dejar como cambio una pieza que no se ha contado", () => {
    const r = repartirCierre(contado, [{ valor: 50000, cantidad: 1 }]);
    expect(r.ok).toBe(false);
    if (esExito(r)) return;
    expect(r.codigo).toBe("CAMBIO_NO_DISPONIBLE");
    expect(r.detalle?.[0]).toMatchObject({ valor: 50000, pedido: 1, disponible: 0 });
  });

  it("dejarlo todo como cambio deja el ingreso a cero", () => {
    const todo = [...contado.entries()].map(([valor, cantidad]) => ({ valor, cantidad }));
    const r = repartirCierre(contado, todo);
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;
    expect(r.ingresoBancario).toEqual([]);
    expect(r.totalIngreso).toBe(0);
  });

  it("un cambio final vacío manda todo el efectivo al banco", () => {
    const r = repartirCierre(contado, []);
    expect(r.ok).toBe(true);
    if (esFallo(r)) return;
    expect(r.totalCambio).toBe(0);
    expect(r.totalIngreso).toBe(totalInventario(contado));
  });
});

describe("propuesta de cambio final", () => {
  const contado = inventarioDesdeLineas([
    { valor: 10000, cantidad: 5 },
    { valor: 5000, cantidad: 4 },
    { valor: 2000, cantidad: 8 },
    { valor: 1000, cantidad: 4 },
    { valor: 500, cantidad: 4 },
    { valor: 200, cantidad: 10 },
    { valor: 100, cantidad: 10 },
  ]);

  it("se queda con el menudo primero, para poder dar cambio mañana", () => {
    const propuesta = proponerCambioFinal(contado, 30000);
    const total = propuesta.reduce((a, l) => a + l.valor * l.cantidad, 0);
    expect(total).toBe(30000);

    // Todas las monedas de 1 € y de 2 € se quedan en caja: son las que hacen
    // falta para devolver cambio, no los billetes de 100 €.
    expect(propuesta.find((l) => l.valor === 100)?.cantidad).toBe(10);
    expect(propuesta.find((l) => l.valor === 200)?.cantidad).toBe(10);
    expect(propuesta.find((l) => l.valor === 10000)).toBeUndefined();
  });

  it("nunca propone más piezas de las contadas", () => {
    const propuesta = proponerCambioFinal(contado, 999999);
    for (const l of propuesta) {
      expect(l.cantidad).toBeLessThanOrEqual(contado.get(l.valor) ?? 0);
    }
    // Y lo que propone es exactamente todo lo que hay.
    const total = propuesta.reduce((a, l) => a + l.valor * l.cantidad, 0);
    expect(total).toBe(totalInventario(contado));
  });

  it("un objetivo de cero no propone nada", () => {
    expect(proponerCambioFinal(contado, 0)).toEqual([]);
  });

  it("lo que propone siempre es repartible sin errores", () => {
    const propuesta = proponerCambioFinal(contado, 30000);
    const r = repartirCierre(contado, propuesta);
    expect(r.ok).toBe(true);
  });
});
