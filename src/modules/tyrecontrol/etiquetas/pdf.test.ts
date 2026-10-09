import { describe, it, expect } from "vitest";
import { ETIQUETA } from "./medidas";
import { aPuntos } from "./pdf";
import { bloquesDeEtiqueta, bloquesParaImprimir } from "./medidas";

const MM = 72 / 25.4;

describe("de nuestras cajas a las del PDF", () => {
  it("la X no cambia de sitio, solo de unidad", () => {
    expect(aPuntos({ x: 12.5, y: 0, ancho: 65, alto: 25 }).x).toBeCloseTo(12.5 * MM, 6);
  });

  it("la Y se da la vuelta: en el PDF se mide desde ABAJO", () => {
    // Una caja pegada al borde superior queda, en el PDF, a (alto - su alto).
    const arriba = aPuntos({ x: 0, y: 0, ancho: 10, alto: 20 });
    expect(arriba.y).toBeCloseTo((ETIQUETA.alto - 20) * MM, 6);
  });

  it("y se refiere al borde INFERIOR de la caja, no al superior", () => {
    const hueco = ETIQUETA.huecos[1];
    expect(aPuntos(hueco).y).toBeCloseTo((ETIQUETA.alto - hueco.y - hueco.alto) * MM, 6);
  });

  it("una caja pegada al borde de abajo queda en cero", () => {
    expect(aPuntos({ x: 0, y: ETIQUETA.alto - 10, ancho: 5, alto: 10 }).y).toBeCloseTo(0, 6);
  });

  it("el ajuste de la impresora baja lo impreso sin tocar la geometría", () => {
    const hueco = ETIQUETA.huecos[0];
    const sin = aPuntos(hueco);
    const con = aPuntos(hueco, ETIQUETA.alto, { x: 0, y: 3.5 });
    // 3,5 mm más abajo = 3,5 mm MENOS de Y en el PDF, que mide desde abajo.
    expect(sin.y - con.y).toBeCloseTo(3.5 * MM, 6);
    expect(con.x).toBeCloseTo(sin.x, 6);
  });

  it("los QR de los troquelados bajan 1 mm más que el resto; el número no", () => {
    const geo = bloquesDeEtiqueta(10), imp = bloquesParaImprimir(10);
    const a = ETIQUETA.ajusteImpresora.y;
    expect(imp[0].qr.y - geo[0].qr.y).toBeCloseTo(a, 6);
    expect(imp[0].numero.y - geo[0].numero.y).toBeCloseTo(a, 6);
    for (const i of [1, 2]) {
      expect(imp[i].qr.y - geo[i].qr.y).toBeCloseTo(a + 1, 6);
      expect(imp[i].numero.y - geo[i].numero.y).toBeCloseTo(a, 6);
      expect(imp[i].caja).toEqual(geo[i].caja); // el troquelado no se mueve
    }
  });

  it("«Nº de serie:» va encima del número grande y solo ahí", () => {
    const imp = bloquesParaImprimir(10);
    const r = imp[0].rotulo!;
    expect(r.texto).toBe("Nº de serie:");
    expect(r.y + r.alto).toBeCloseTo(imp[0].numero.y, 6);   // justo encima
    expect(r.y).toBeGreaterThanOrEqual(0);                  // dentro de la etiqueta
    expect(imp[1].rotulo).toBeUndefined();
    expect(imp[2].rotulo).toBeUndefined();
  });

  it("con el ajuste puesto, nada se sale de la página", () => {
    for (const c of [...ETIQUETA.huecos, ETIQUETA.zonaSuperior]) {
      const p = aPuntos(c, ETIQUETA.alto, ETIQUETA.ajusteImpresora);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + p.alto).toBeLessThanOrEqual(ETIQUETA.alto * MM + 0.001);
    }
  });

  it("nada se sale de la página al convertir", () => {
    for (const c of [...ETIQUETA.huecos, ETIQUETA.zonaSuperior]) {
      const p = aPuntos(c);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + p.alto).toBeLessThanOrEqual(ETIQUETA.alto * MM + 0.001);
      expect(p.x + p.ancho).toBeLessThanOrEqual(ETIQUETA.ancho * MM + 0.001);
    }
  });
});
