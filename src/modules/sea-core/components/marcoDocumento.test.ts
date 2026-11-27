import { describe, expect, it } from "vitest";

import { ALTO_GUARDADO, ANCHO_GUARDADO, MARGEN, PROPORCION_TARJETA, marcoEnPantalla, recorteDeCamara } from "./marcoDocumento";

describe("el marco en la pantalla", () => {
  it("tiene la forma de un DNI y va centrado", () => {
    const m = marcoEnPantalla(390, 700);
    expect(m.ancho / m.alto).toBeCloseTo(PROPORCION_TARJETA, 5);
    expect(m.x).toBeCloseTo((390 - m.ancho) / 2, 5);
    expect(m.y).toBeCloseTo((700 - m.alto) / 2, 5);
  });

  it("en un móvil en vertical, casi todo el ancho; en una pantalla apaisada, no se sale por arriba", () => {
    expect(marcoEnPantalla(390, 700).ancho).toBeCloseTo(390 * 0.86, 5);
    const apaisada = marcoEnPantalla(1280, 600);
    expect(apaisada.alto).toBeLessThanOrEqual(600 * 0.56);
    expect(apaisada.y).toBeGreaterThan(0);
  });

  it("lo que se guarda tiene también la forma de la tarjeta", () => {
    expect(ANCHO_GUARDADO / ALTO_GUARDADO).toBeCloseTo(PROPORCION_TARJETA, 2);
  });
});

describe("del marco a los píxeles de la cámara", () => {
  it("si la cámara y la pantalla tienen el mismo tamaño, es el marco más el margen", () => {
    const marco = { x: 100, y: 200, ancho: 200, alto: 126 };
    const r = recorteDeCamara({ ancho: 400, alto: 600 }, { ancho: 400, alto: 600 }, marco);
    const extra = 200 * MARGEN;
    expect(r).toEqual({ x: Math.round(100 - extra), y: Math.round(200 - extra), ancho: 224, alto: 150 });
  });

  it("deshace el «cover»: cámara apaisada en un móvil en vertical se corta por los lados", () => {
    // Cámara 1920×1080 en una pantalla de 360×640: escala 640/1080, y se
    // cortan (1920·0,5926 − 360)/2 ≈ 388,9 px de pantalla por cada lado.
    const pantalla = { ancho: 360, alto: 640 };
    const marco = marcoEnPantalla(pantalla.ancho, pantalla.alto);
    const r = recorteDeCamara({ ancho: 1920, alto: 1080 }, pantalla, marco, 0);
    const escala = 640 / 1080;
    const despl = (1920 * escala - 360) / 2;
    expect(r.x).toBe(Math.round((marco.x + despl) / escala));
    expect(r.y).toBe(Math.round(marco.y / escala));
    expect(r.ancho / r.alto).toBeCloseTo(PROPORCION_TARJETA, 1);
    // El centro del marco cae en el centro de la imagen de la cámara.
    expect(r.x + r.ancho / 2).toBeCloseTo(960, -1);
    expect(r.y + r.alto / 2).toBeCloseTo(540, -1);
  });

  it("el margen nunca se sale de la imagen", () => {
    const r = recorteDeCamara({ ancho: 400, alto: 300 }, { ancho: 400, alto: 300 }, { x: 2, y: 2, ancho: 396, alto: 250 });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.x + r.ancho).toBeLessThanOrEqual(400);
    expect(r.y + r.alto).toBeLessThanOrEqual(300);
  });
});
