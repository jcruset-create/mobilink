import { describe, it, expect } from "vitest";
import { ETIQUETA } from "./medidas";
import { aPuntos } from "./pdf";

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

  it("nada se sale de la página al convertir", () => {
    for (const c of [...ETIQUETA.huecos, ETIQUETA.zonaSuperior]) {
      const p = aPuntos(c);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + p.alto).toBeLessThanOrEqual(ETIQUETA.alto * MM + 0.001);
      expect(p.x + p.ancho).toBeLessThanOrEqual(ETIQUETA.ancho * MM + 0.001);
    }
  });
});
