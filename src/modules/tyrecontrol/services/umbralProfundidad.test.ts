/**
 * A qué profundidad hay que cambiar una goma, según su llanta.
 *
 * La tabla de casos es LA MISMA que trae la migración
 * `tyrecontrol_profundidad_minima_por_llanta.sql` en su comprobación, y lo es
 * a propósito: la regla vive en dos sitios —la base para el informe de la
 * empresa, aquí para la ficha de un vehículo— y esta tabla es lo que hace que
 * una discrepancia salga en cuanto se toque cualquiera de los dos.
 */

import { describe, expect, it } from "vitest";

import {
  hayQueCambiar, llantaDeMedida, profundidadMinimaPorLlanta, textoDeCambio,
} from "./umbralProfundidad";

/** Medida → mínimo. Copiada de la comprobación de la migración. */
const TABLA: Array<[string | null, number | null]> = [
  ["295/80R22.5", 4],
  ["295/80R22.5 154/149M", 4],   // el índice de carga no estorba
  ["315/80R22.5", 4],
  ["305/70R19.5", 3],
  ["245/70R17.5", 3],
  ["225/55R17", 3],
  ["225/75R16", 2],
  ["215/70R15", 2],
  ["0", null],                    // cae al valor por defecto
  [null, null],
];

describe("el mínimo por llanta, caso por caso", () => {
  it.each(TABLA)("%s → %s mm", (medida, esperado) => {
    expect(profundidadMinimaPorLlanta(medida)).toBe(esperado);
  });
});

describe("leer el diámetro de la medida", () => {
  it("de las medidas reales de la flota", () => {
    expect(llantaDeMedida("295/80R22.5")).toBe(22.5);
    expect(llantaDeMedida("225/75R16")).toBe(16);
    expect(llantaDeMedida("245/70R17.5")).toBe(17.5);
  });

  it("con el índice de carga pegado detrás", () => {
    // El fallo que se vio midiendo contra producción: sin acotar a dos cifras
    // y un decimal, esto devolvía 22.5154.
    expect(llantaDeMedida("295/80R22.5 154/149M")).toBe(22.5);
  });

  it("con espacio tras la R y en minúsculas", () => {
    expect(llantaDeMedida("295/80 R22.5")).toBe(22.5);
    expect(llantaDeMedida("295/80r22.5")).toBe(22.5);
  });

  it("con coma decimal", () => {
    expect(llantaDeMedida("295/80R22,5")).toBe(22.5);
  });

  it("lo que no dice el diámetro da null, no cero", () => {
    // Cero diría «llanta de cero pulgadas», que caería en la banda de 2 mm.
    for (const m of ["0", "", "   ", null, undefined, "sin medida"]) {
      expect(llantaDeMedida(m)).toBeNull();
    }
  });
});

describe("si hay que cambiarla", () => {
  it("una 22.5 se cambia a 4 mm o menos", () => {
    expect(hayQueCambiar(4, "295/80R22.5")).toBe(true);
    expect(hayQueCambiar(3.5, "295/80R22.5")).toBe(true);
    expect(hayQueCambiar(4.1, "295/80R22.5")).toBe(false);
  });

  it("y la misma profundidad en una llanta pequeña NO se cambia", () => {
    // Es el sentido de todo esto: 3 mm es para cambiar en un camión y es
    // normal en una furgoneta.
    expect(hayQueCambiar(3, "295/80R22.5")).toBe(true);
    expect(hayQueCambiar(3, "225/75R16")).toBe(false);
  });

  it("una 17.5 a 3 mm sí, a 3,1 no", () => {
    expect(hayQueCambiar(3, "245/70R17.5")).toBe(true);
    expect(hayQueCambiar(3.1, "245/70R17.5")).toBe(false);
  });

  it("una 16 a 2 mm sí, a 2,5 no", () => {
    expect(hayQueCambiar(2, "225/75R16")).toBe(true);
    expect(hayQueCambiar(2.5, "225/75R16")).toBe(false);
  });

  it("sin profundidad no se afirma nada", () => {
    // Pintar de rojo por falta de datos convierte el rojo en ruido. Un
    // vehículo sin medir ya sale en el informe por «sin revisar».
    expect(hayQueCambiar(null, "295/80R22.5")).toBe(false);
    expect(hayQueCambiar(undefined, "295/80R22.5")).toBe(false);
    expect(hayQueCambiar(Number.NaN, "295/80R22.5")).toBe(false);
  });

  it("sin llanta tampoco", () => {
    expect(hayQueCambiar(1, "0")).toBe(false);
    expect(hayQueCambiar(1, null)).toBe(false);
  });

  it("una profundidad de cero es un dato, no una ausencia", () => {
    // Cero milímetros es una goma lisa: eso hay que cambiarlo, no ignorarlo.
    expect(hayQueCambiar(0, "295/80R22.5")).toBe(true);
  });
});

describe("cómo se dice", () => {
  it("dice los milímetros, el umbral y de qué llanta sale", () => {
    expect(textoDeCambio(3.5, "295/80R22.5")).toBe("3.5 mm (≤ 4 de una llanta 22.5)");
  });

  it("y no dice nada cuando no toca cambiarla", () => {
    expect(textoDeCambio(9, "295/80R22.5")).toBeNull();
    expect(textoDeCambio(null, "295/80R22.5")).toBeNull();
  });
});
