import { describe, it, expect } from "vitest";
import {
  ETIQUETA, bloquesDeEtiqueta, cabeDentro, componerColumna, componerFila,
  type BloqueEtiqueta, type Caja,
} from "./medidas";

const SERIE = 13; // dígitos típicos de un número de serie

/** ¿Se solapan dos cajas? */
const chocan = (a: Caja, b: Caja) =>
  a.x < b.x + b.ancho && b.x < a.x + a.ancho &&
  a.y < b.y + b.alto && b.y < a.y + a.alto;

describe("las subetiquetas: número a la izquierda y QR a la derecha", () => {
  const b = componerFila(ETIQUETA.huecos[0], SERIE);

  it("el QR va a la DERECHA del número, no encima ni debajo", () => {
    // En 25 mm de alto, uno encima de otro no cabrían los dos legibles.
    expect(b.qr.x).toBeGreaterThanOrEqual(b.numero.x + b.numero.ancho);
  });

  it("el QR es cuadrado", () => {
    expect(b.qr.ancho).toBeCloseTo(b.qr.alto, 5);
  });

  it("el número y el QR no se pisan", () => {
    expect(chocan(b.numero, b.qr)).toBe(false);
  });

  it("todo queda dentro de la caja, con su margen de seguridad", () => {
    const seguro: Caja = {
      x: b.caja.x + ETIQUETA.seguridad, y: b.caja.y + ETIQUETA.seguridad,
      ancho: b.caja.ancho - 2 * ETIQUETA.seguridad,
      alto: b.caja.alto - 2 * ETIQUETA.seguridad,
    };
    expect(cabeDentro(b.numero, seguro)).toBe(true);
    expect(cabeDentro(b.qr, seguro)).toBe(true);
  });

  it("con más dígitos el número se hace más pequeño, no se sale", () => {
    const corto = componerFila(ETIQUETA.huecos[0], 8);
    const largo = componerFila(ETIQUETA.huecos[0], 20);
    expect(largo.numero.tamano).toBeLessThan(corto.numero.tamano);
    expect(cabeDentro(largo.numero, largo.caja)).toBe(true);
  });

  it("el QR no encoge por meter más dígitos: su mínimo es su mínimo", () => {
    expect(componerFila(ETIQUETA.huecos[0], 20).qr.ancho)
      .toBeCloseTo(componerFila(ETIQUETA.huecos[0], 8).qr.ancho, 5);
  });
});

describe("la zona de arriba: número grande y QR grande debajo", () => {
  const b = componerColumna(ETIQUETA.zonaSuperior, SERIE);

  it("el QR va DEBAJO del número, que es lo que pidió el encargo", () => {
    expect(b.qr.y).toBeGreaterThanOrEqual(b.numero.y + b.numero.alto);
  });

  it("aprovecha que no hay troquelado: el número es casi el doble de grande que en una subetiqueta", () => {
    const enSubetiqueta = componerFila(ETIQUETA.huecos[0], SERIE);
    expect(b.numero.tamano).toBeGreaterThan(enSubetiqueta.numero.tamano * 1.5);
  });

  it("y el QR también: por encima de 30 mm se lee de lejos y sucio", () => {
    expect(b.qr.ancho).toBeGreaterThan(30);
  });

  it("el número va centrado; en las subetiquetas, no", () => {
    expect(b.numero.centrado).toBe(true);
    expect(componerFila(ETIQUETA.huecos[0], SERIE).numero.centrado).toBe(false);
  });

  it("no se pisan y todo cae dentro de la caja", () => {
    expect(chocan(b.numero, b.qr)).toBe(false);
    expect(cabeDentro(b.numero, b.caja)).toBe(true);
    expect(cabeDentro(b.qr, b.caja)).toBe(true);
  });
});

describe("no se imprime ningún rótulo", () => {
  it("el bloque solo tiene número y QR: «Nº SERIE» no existe", () => {
    for (const b of bloquesDeEtiqueta(SERIE)) {
      expect(Object.keys(b).sort()).toEqual(["caja", "numero", "qr"]);
    }
  });
});

describe("bloquesDeEtiqueta", () => {
  const bloques = bloquesDeEtiqueta(SERIE);

  it("son TRES y salen del mismo cálculo", () => {
    expect(bloques.length).toBe(3);
  });

  it("LA PRUEBA DEL ENCARGO: los dos de abajo caben en sus troquelados", () => {
    // Lo que se sale del troquelado se pierde al arrancar la pegatina.
    for (let i = 0; i < ETIQUETA.huecos.length; i++) {
      const b = bloques[i + 1];
      expect(cabeDentro(b.numero, ETIQUETA.huecos[i])).toBe(true);
      expect(cabeDentro(b.qr, ETIQUETA.huecos[i])).toBe(true);
    }
  });

  it("los tres caben dentro de la etiqueta entera", () => {
    const etiqueta: Caja = { x: 0, y: 0, ancho: ETIQUETA.ancho, alto: ETIQUETA.alto };
    for (const b of bloques) {
      expect(cabeDentro(b.numero, etiqueta)).toBe(true);
      expect(cabeDentro(b.qr, etiqueta)).toBe(true);
    }
  });

  it("la zona de arriba no invade el primer troquelado", () => {
    const arriba = bloques[0];
    expect(arriba.caja.y + arriba.caja.alto).toBeLessThanOrEqual(ETIQUETA.huecos[0].y);
  });

  it("los bloques no se solapan entre sí", () => {
    const piezas: Caja[] = bloques.flatMap((b: BloqueEtiqueta) => [b.numero, b.qr]);
    for (let i = 0; i < piezas.length; i++) {
      for (let j = i + 1; j < piezas.length; j++) {
        expect(chocan(piezas[i], piezas[j])).toBe(false);
      }
    }
  });

  it("el número se lee: no baja de 3 mm en ningún bloque", () => {
    for (const b of bloques) expect(b.numero.tamano).toBeGreaterThan(3);
  });

  it("ningún QR baja del mínimo escaneable", () => {
    for (const b of bloques) expect(b.qr.ancho).toBeGreaterThanOrEqual(ETIQUETA.qrMinimo);
  });
});

describe("recalibrar", () => {
  it("falla en vez de dar un QR que no se puede escanear", () => {
    // Si la etiqueta cambiara a un troquelado de 10 mm de alto, más vale
    // enterarse aquí que con el rollo impreso.
    expect(() => componerFila({ x: 0, y: 0, ancho: 65, alto: 10 }, SERIE))
      .toThrow(/mínimo escaneable/);
  });

  it("una caja imposible se rechaza y se dice cuál", () => {
    expect(() => componerFila({ x: 0, y: 0, ancho: 2, alto: 2 }, SERIE))
      .toThrow(/demasiado pequeña/);
  });

  it("un troquelado más estrecho sigue dando un bloque que cabe", () => {
    const estrecho: Caja = { x: 12.5, y: 66.98, ancho: 55, alto: 25 };
    const b = componerFila(estrecho, SERIE);
    expect(cabeDentro(b.numero, estrecho)).toBe(true);
    expect(cabeDentro(b.qr, estrecho)).toBe(true);
  });

  it("una zona de arriba más baja encoge el QR, no lo saca de la caja", () => {
    const baja: Caja = { x: 7.5, y: 8, ancho: 75, alto: 40 };
    const b = componerColumna(baja, SERIE);
    expect(cabeDentro(b.qr, baja)).toBe(true);
    expect(b.qr.ancho).toBeLessThan(componerColumna(ETIQUETA.zonaSuperior, SERIE).qr.ancho);
  });
});
