import { describe, expect, it } from "vitest";
import { repartirIngreso, valorEnTubos } from "./cierre";
import type { Denominacion } from "../types";

const DENOMINACIONES: Denominacion[] = [
  { id: 1, valor: 5000, tipo: "BILLETE", etiqueta: "50 €", piezasPorCartucho: null, activa: true, orden: 1 },
  { id: 2, valor: 2000, tipo: "BILLETE", etiqueta: "20 €", piezasPorCartucho: null, activa: true, orden: 2 },
  { id: 3, valor: 200, tipo: "MONEDA", etiqueta: "2 €", piezasPorCartucho: 25, activa: true, orden: 3 },
  { id: 4, valor: 100, tipo: "MONEDA", etiqueta: "1 €", piezasPorCartucho: 25, activa: true, orden: 4 },
  { id: 5, valor: 50, tipo: "MONEDA", etiqueta: "0,50 €", piezasPorCartucho: 25, activa: true, orden: 5 },
];

describe("reparto del cierre", () => {
  it("lo que se enseña suma lo que dice el total, también con cartuchos", () => {
    // El caso real que falló: un tubo de 2 € y otro de 1 €. El total contaba
    // los 75 € de los tubos y las líneas no los enseñaban.
    const r = repartirIngreso({
      sueltasContadas: [
        { valor: 5000, cantidad: 9 },
        { valor: 2000, cantidad: 3 },
        { valor: 100, cantidad: 1 },
        { valor: 50, cantidad: 10 },
      ],
      tubosContados: [
        { valor: 200, cantidad: 1 },
        { valor: 100, cantidad: 1 },
      ],
      cambioFinalSueltas: {},
      cambioFinalTubos: [],
      denominaciones: DENOMINACIONES,
    });

    const sumaDeLoQueSeVe =
      r.sueltas.reduce((a, l) => a + l.valor * l.cantidad, 0) +
      r.tubos.reduce((a, t) => a + t.importe, 0);

    expect(sumaDeLoQueSeVe).toBe(r.totalCentimos);
    // 450 + 60 + 1 + 5 sueltos, más 50 + 25 en tubos.
    expect(r.totalCentimos).toBe(45000 + 6000 + 100 + 500 + 5000 + 2500);
    expect(r.tubos).toHaveLength(2);
  });

  it("un tubo que se queda en caja no va al banco", () => {
    const r = repartirIngreso({
      sueltasContadas: [],
      tubosContados: [
        { valor: 200, cantidad: 2 },
        { valor: 100, cantidad: 1 },
      ],
      cambioFinalSueltas: {},
      cambioFinalTubos: [{ valor: 200, cantidad: 1 }],
      denominaciones: DENOMINACIONES,
    });

    expect(r.tubos).toEqual([
      { valor: 200, cantidad: 1, piezasPorCartucho: 25, importe: 5000 },
      { valor: 100, cantidad: 1, piezasPorCartucho: 25, importe: 2500 },
    ]);
    expect(r.totalCentimos).toBe(7500);
  });

  it("descuenta de las sueltas lo que se deja de cambio", () => {
    const r = repartirIngreso({
      sueltasContadas: [
        { valor: 5000, cantidad: 4 },
        { valor: 2000, cantidad: 5 },
      ],
      tubosContados: [],
      cambioFinalSueltas: { 5000: 1, 2000: 5 },
      cambioFinalTubos: [],
      denominaciones: DENOMINACIONES,
    });

    // Los cinco de 20 € se quedan enteros: no aparecen en el ingreso.
    expect(r.sueltas).toEqual([{ valor: 5000, cantidad: 3 }]);
    expect(r.totalCentimos).toBe(15000);
  });

  it("si todo se queda en caja, el ingreso es cero y no hay líneas", () => {
    const r = repartirIngreso({
      sueltasContadas: [{ valor: 5000, cantidad: 2 }],
      tubosContados: [{ valor: 200, cantidad: 1 }],
      cambioFinalSueltas: { 5000: 2 },
      cambioFinalTubos: [{ valor: 200, cantidad: 1 }],
      denominaciones: DENOMINACIONES,
    });

    expect(r.sueltas).toEqual([]);
    expect(r.tubos).toEqual([]);
    expect(r.totalCentimos).toBe(0);
  });

  it("una denominación sin cartucho configurado no inventa piezas", () => {
    const r = repartirIngreso({
      sueltasContadas: [],
      tubosContados: [{ valor: 5000, cantidad: 1 }],
      cambioFinalSueltas: {},
      cambioFinalTubos: [],
      denominaciones: DENOMINACIONES,
    });

    expect(r.tubos[0].importe).toBe(0);
    expect(r.totalCentimos).toBe(0);
  });
});

describe("valor de los tubos que se quedan", () => {
  it("multiplica tubos por piezas y por valor", () => {
    expect(
      valorEnTubos(
        [
          { valor: 200, cantidad: 1 },
          { valor: 100, cantidad: 2 },
        ],
        DENOMINACIONES
      )
    ).toBe(5000 + 5000);
  });
});
