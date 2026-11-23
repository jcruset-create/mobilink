import { describe, expect, it } from "vitest";
import {
  areaDeEsquinas,
  coeficientesHomografia,
  enderezar,
  esquinasValidas,
  tamanoDeSalida,
  type Esquinas,
} from "./recorteDocumento";

/** Las cuatro esquinas de la foto entera: el documento ocupa todo. */
const TODA: Esquinas = {
  supIzq: { x: 0, y: 0 },
  supDer: { x: 1, y: 0 },
  infDer: { x: 1, y: 1 },
  infIzq: { x: 0, y: 1 },
};

/** Un documento tumbado 90° a la derecha dentro de la foto. */
const TUMBADA: Esquinas = {
  supIzq: { x: 0, y: 1 },
  supDer: { x: 0, y: 0 },
  infDer: { x: 1, y: 0 },
  infIzq: { x: 1, y: 1 },
};

describe("areaDeEsquinas", () => {
  it("la foto entera es toda el área", () => {
    expect(areaDeEsquinas(TODA)).toBeCloseTo(1, 6);
  });

  it("un documento en el centro ocupa lo que ocupa", () => {
    expect(
      areaDeEsquinas({
        supIzq: { x: 0.25, y: 0.25 },
        supDer: { x: 0.75, y: 0.25 },
        infDer: { x: 0.75, y: 0.75 },
        infIzq: { x: 0.25, y: 0.75 },
      })
    ).toBeCloseTo(0.25, 6);
  });
});

describe("esquinasValidas", () => {
  it("acepta un trapecio normal: una foto hecha de lado", () => {
    expect(
      esquinasValidas({
        supIzq: { x: 0.08, y: 0.3 },
        supDer: { x: 0.94, y: 0.22 },
        infDer: { x: 0.96, y: 0.74 },
        infIzq: { x: 0.06, y: 0.68 },
      })
    ).toBe(true);
  });

  it("rechaza las esquinas cruzadas, que darían una imagen doblada", () => {
    expect(
      esquinasValidas({
        supIzq: { x: 0, y: 0 },
        supDer: { x: 1, y: 1 },
        infDer: { x: 1, y: 0 },
        infIzq: { x: 0, y: 1 },
      })
    ).toBe(false);
  });

  it("rechaza un documento ridículamente pequeño", () => {
    expect(
      esquinasValidas({
        supIzq: { x: 0.4, y: 0.4 },
        supDer: { x: 0.5, y: 0.4 },
        infDer: { x: 0.5, y: 0.5 },
        infIzq: { x: 0.4, y: 0.5 },
      })
    ).toBe(false);
  });

  it("rechaza coordenadas en píxeles, que es como el modelo se equivoca", () => {
    expect(
      esquinasValidas({
        supIzq: { x: 120, y: 300 },
        supDer: { x: 3800, y: 280 },
        infDer: { x: 3820, y: 2600 },
        infIzq: { x: 100, y: 2580 },
      })
    ).toBe(false);
  });

  it("rechaza lo que no son números y lo que no hay", () => {
    expect(esquinasValidas(null)).toBe(false);
    expect(esquinasValidas({ ...TODA, supIzq: { x: NaN, y: 0 } })).toBe(false);
    expect(esquinasValidas({ ...TODA, supDer: undefined as never })).toBe(false);
  });
});

describe("tamanoDeSalida", () => {
  it("mantiene las proporciones del documento, no las de la foto", () => {
    // Un carnet apaisado dentro de una foto cuadrada.
    const s = tamanoDeSalida(
      { supIzq: { x: 0.1, y: 0.4 }, supDer: { x: 0.9, y: 0.4 }, infDer: { x: 0.9, y: 0.6 }, infIzq: { x: 0.1, y: 0.6 } },
      1000,
      1000
    );
    expect(s.ancho / s.alto).toBeCloseTo(4, 1);
  });

  it("no se pasa del ancho máximo", () => {
    const s = tamanoDeSalida(TODA, 4032, 3024, 1600);
    expect(s.ancho).toBe(1600);
    expect(s.alto).toBe(1200);
  });

  it("un documento pequeño en la foto no se encoge: se estira al máximo", () => {
    const s = tamanoDeSalida(
      { supIzq: { x: 0.3, y: 0.3 }, supDer: { x: 0.7, y: 0.3 }, infDer: { x: 0.7, y: 0.6 }, infIzq: { x: 0.3, y: 0.6 } },
      1000,
      1000
    );
    expect(s.ancho).toBe(400);
    expect(s.alto).toBe(300);
  });
});

describe("coeficientesHomografia", () => {
  it("el cuadrado entero no deforma nada", () => {
    const m = coeficientesHomografia(TODA, 100, 50);
    expect(m.g).toBeCloseTo(0, 9);
    expect(m.h).toBeCloseTo(0, 9);
    expect(m.a).toBeCloseTo(100, 6);
    expect(m.e).toBeCloseTo(50, 6);
  });
});

/** Una imagen de 4x4 en escala de grises con un valor distinto por píxel. */
function imagenDePrueba(): Buffer {
  return Buffer.from([
    10, 20, 30, 40,
    50, 60, 70, 80,
    90, 100, 110, 120,
    130, 140, 150, 160,
  ]);
}

describe("enderezar", () => {
  it("un documento ya derecho y a tamaño sale idéntico", () => {
    const salida = enderezar(imagenDePrueba(), 4, 4, 1, TODA, { ancho: 4, alto: 4 });
    expect([...salida]).toEqual([...imagenDePrueba()]);
  });

  it("un documento tumbado sale derecho", () => {
    const salida = enderezar(imagenDePrueba(), 4, 4, 1, TUMBADA, { ancho: 4, alto: 4 });
    // La esquina de abajo a la izquierda de la foto (130) pasa a ser la de
    // arriba a la izquierda del documento.
    expect(salida[0]).toBe(130);
    // Y la de arriba a la izquierda de la foto (10) acaba arriba a la derecha.
    expect(salida[3]).toBe(10);
  });

  it("recorta: lo de fuera del documento no aparece", () => {
    const mitad: Esquinas = {
      supIzq: { x: 0.5, y: 0 },
      supDer: { x: 1, y: 0 },
      infDer: { x: 1, y: 0.5 },
      infIzq: { x: 0.5, y: 0.5 },
    };
    const salida = enderezar(imagenDePrueba(), 4, 4, 1, mitad, { ancho: 2, alto: 2 });
    expect([...salida]).toEqual([30, 40, 70, 80]);
  });

  it("deja negro lo que cae fuera de la foto en vez de inventarlo", () => {
    const asomando: Esquinas = {
      supIzq: { x: -0.5, y: 0 },
      supDer: { x: 0.5, y: 0 },
      infDer: { x: 0.5, y: 1 },
      infIzq: { x: -0.5, y: 1 },
    };
    const salida = enderezar(imagenDePrueba(), 4, 4, 1, asomando, { ancho: 4, alto: 4 });
    expect(salida[0]).toBe(0);
  });

  it("respeta los canales de color", () => {
    const rgb = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // 2x2 RGB
    const salida = enderezar(rgb, 2, 2, 3, TODA, { ancho: 2, alto: 2 });
    expect([...salida]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});
