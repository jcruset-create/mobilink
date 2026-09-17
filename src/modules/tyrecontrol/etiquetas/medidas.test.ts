/**
 * Lo que se fija aquí es lo que el encargo pidió que NO se aproximara: que los
 * bloques 2 y 3 quepan ENTEROS dentro de los dos troquelados de la etiqueta
 * física, y que el QR nunca baje del tamaño en que un móvil lo lee.
 *
 * Un bloque que se sale del troquelado no se ve en pantalla: se descubre al
 * arrancar la pegatina, con el rollo ya impreso.
 */

import { describe, expect, it } from "vitest";

import { bloquesDeEtiqueta, cabeDentro, componerBloque, ETIQUETA, type Caja } from "./medidas";

describe("componerBloque", () => {
  it("el QR va a la DERECHA del número, no encima ni debajo", () => {
    const b = componerBloque(ETIQUETA.huecos[0]);
    // A la derecha: empieza donde el número ya ha terminado.
    expect(b.qr.x).toBeGreaterThanOrEqual(b.numero.x + b.numero.ancho);
    // Y a la misma altura: se solapan en vertical, no van apilados.
    const solapanEnVertical =
      b.qr.y < b.numero.y + b.numero.alto && b.numero.y < b.qr.y + b.qr.alto;
    expect(solapanEnVertical).toBe(true);
  });

  it("el QR es cuadrado", () => {
    const b = componerBloque(ETIQUETA.huecos[0]);
    expect(b.qr.ancho).toBeCloseTo(b.qr.alto, 5);
  });

  it("el número y el QR no se pisan", () => {
    const b = componerBloque(ETIQUETA.huecos[0]);
    expect(b.numero.x + b.numero.ancho).toBeLessThanOrEqual(b.qr.x + 0.001);
  });

  it("todo queda dentro de la caja, con su margen de seguridad", () => {
    for (const caja of [ETIQUETA.bloque1, ...ETIQUETA.huecos]) {
      const b = componerBloque(caja);
      expect(cabeDentro(b.numero, caja)).toBe(true);
      expect(cabeDentro(b.qr, caja)).toBe(true);
      // Y respetando el margen: nada toca el borde del troquelado.
      expect(b.numero.x - caja.x).toBeGreaterThanOrEqual(ETIQUETA.seguridad - 0.001);
      expect(caja.x + caja.ancho - (b.qr.x + b.qr.ancho)).toBeGreaterThanOrEqual(
        ETIQUETA.seguridad - 0.001);
    }
  });

  it("falla en vez de dar un QR que no se puede escanear", () => {
    // Mejor enterarse al generar que con doscientas etiquetas impresas.
    const minuscula: Caja = { x: 0, y: 0, ancho: 30, alto: 8 };
    expect(() => componerBloque(minuscula)).toThrow(/mínimo escaneable/);
  });

  it("una caja imposible se rechaza y se dice cuál", () => {
    expect(() => componerBloque({ x: 0, y: 0, ancho: 2, alto: 2 })).toThrow(/demasiado pequeña/);
  });

  it("con más dígitos el número se hace más pequeño, no se sale", () => {
    const corto = componerBloque(ETIQUETA.huecos[0], 8);
    const largo = componerBloque(ETIQUETA.huecos[0], 20);
    expect(largo.numero.tamano).toBeLessThan(corto.numero.tamano);
    expect(cabeDentro(largo.numero, ETIQUETA.huecos[0])).toBe(true);
  });

  it("el QR no encoge por meter más dígitos: su mínimo es su mínimo", () => {
    const a = componerBloque(ETIQUETA.huecos[0], 8);
    const b = componerBloque(ETIQUETA.huecos[0], 20);
    expect(a.qr.ancho).toBeCloseTo(b.qr.ancho, 5);
    expect(b.qr.ancho).toBeGreaterThanOrEqual(ETIQUETA.qrMinimo);
  });
});

describe("bloquesDeEtiqueta", () => {
  it("son TRES y salen del mismo cálculo", () => {
    const bs = bloquesDeEtiqueta();
    expect(bs).toHaveLength(3);
    // Los dos troquelados miden lo mismo, así que sus bloques son idénticos
    // salvo en la posición: eso demuestra que no se ha diseñado ninguno «a ojo».
    expect(bs[1].qr.ancho).toBeCloseTo(bs[2].qr.ancho, 1);
    expect(bs[1].numero.tamano).toBeCloseTo(bs[2].numero.tamano, 1);
  });

  it("LA PRUEBA DEL ENCARGO: los bloques 2 y 3 caben en sus troquelados", () => {
    const bs = bloquesDeEtiqueta();
    for (const [i, hueco] of ETIQUETA.huecos.entries()) {
      const b = bs[i + 1];
      expect(cabeDentro(b.numero, hueco), `bloque ${i + 2}: el número se sale`).toBe(true);
      expect(cabeDentro(b.qr, hueco), `bloque ${i + 2}: el QR se sale`).toBe(true);
    }
  });

  it("los tres caben dentro de la etiqueta entera", () => {
    const etiqueta: Caja = { x: 0, y: 0, ancho: ETIQUETA.ancho, alto: ETIQUETA.alto };
    for (const b of bloquesDeEtiqueta()) {
      expect(cabeDentro(b.numero, etiqueta)).toBe(true);
      expect(cabeDentro(b.qr, etiqueta)).toBe(true);
    }
  });

  it("los bloques no se solapan entre sí", () => {
    const bs = bloquesDeEtiqueta();
    const cajas = bs.map((b) => b.caja);
    for (let i = 0; i < cajas.length; i++) {
      for (let j = i + 1; j < cajas.length; j++) {
        const a = cajas[i], c = cajas[j];
        const seSolapan =
          a.x < c.x + c.ancho && c.x < a.x + a.ancho &&
          a.y < c.y + c.alto && c.y < a.y + a.alto;
        expect(seSolapan, `los bloques ${i + 1} y ${j + 1} se pisan`).toBe(false);
      }
    }
  });

  it("el número se lee: no baja de 3 mm en ningún bloque", () => {
    // 3 mm de altura de carácter es lo que se lee a un brazo de distancia en
    // un almacén. Por debajo habría que acercarse a la goma.
    for (const b of bloquesDeEtiqueta()) {
      expect(b.numero.tamano).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("recalibrar", () => {
  /*
   * Estas dos pruebas son el seguro de la parametrización: si mañana la regla
   * dice que la etiqueta mide otra cosa, se cambian los números de ETIQUETA y
   * el diseño se recoloca solo. Lo que NO puede pasar es que se recoloque
   * saliéndose del hueco o con un QR ilegible.
   */
  it("un troquelado más estrecho sigue dando un bloque que cabe", () => {
    const estrecho: Caja = { x: 10, y: 60, ancho: 55, alto: 20 };
    const b = componerBloque(estrecho);
    expect(cabeDentro(b.numero, estrecho)).toBe(true);
    expect(cabeDentro(b.qr, estrecho)).toBe(true);
    expect(b.qr.ancho).toBeGreaterThanOrEqual(ETIQUETA.qrMinimo);
  });

  it("un troquelado demasiado bajo se niega en vez de encoger el QR", () => {
    expect(() => componerBloque({ x: 10, y: 60, ancho: 64, alto: 13 })).toThrow(/mínimo escaneable/);
  });
});
