import { describe, expect, it } from "vitest";
import { cajaDeTinta, cabeSolo, esTicket, PT_POR_MM, recorteFiable, repartir, type Colocacion, type Tamano, type Zona } from "./mosaico.ts";

const mm = (ancho: number, alto: number): Tamano => ({ ancho: ancho * PT_POR_MM, alto: alto * PT_POR_MM });

/** La zona de `montar()`: A4 con 8 mm de margen y 14 mm de cabecera. */
const ZONA: Zona = {
  ancho: (210 - 16) * PT_POR_MM,
  alto: (297 - 14 - 8) * PT_POR_MM,
  separacion: 8,
  rotulo: 11,
};

/** Los tickets de Ivan, semana del 21/09/2026, ya recortados. */
const BAR = mm(68, 119);
const PEAJE = mm(49, 128);
const PEAJE_BORRADO = mm(48, 134);

/** Ni se pisan ni se salen: la comprobación que tiene que pasar cualquier reparto. */
function sinSolapesNiSalidas(hoja: readonly Colocacion[], zona: Zona) {
  for (const c of hoja) {
    expect(c.x).toBeGreaterThanOrEqual(-1e-6);
    expect(c.y).toBeGreaterThanOrEqual(-1e-6);
    expect(c.x + c.ancho).toBeLessThanOrEqual(zona.ancho + 1e-6);
    expect(c.y + zona.rotulo + c.alto).toBeLessThanOrEqual(zona.alto + 1e-6);
  }
  for (const a of hoja)
    for (const b of hoja) {
      if (a === b) continue;
      const aparte =
        a.x + a.ancho <= b.x + 1e-6 ||
        b.x + b.ancho <= a.x + 1e-6 ||
        a.y + zona.rotulo + a.alto <= b.y + 1e-6 ||
        b.y + zona.rotulo + b.alto <= a.y + 1e-6;
      expect(aparte).toBe(true);
    }
}

describe("tickets en A4: cuántos caben y a qué escala", () => {
  it("las dietas de la semana: 4 del bar en UNA hoja al 100 %", () => {
    const r = repartir([BAR, BAR, BAR, BAR], ZONA)!;
    expect(r.escala).toBe(1);
    expect(r.hojas).toHaveLength(1);
    expect(r.hojas[0]).toHaveLength(4);
    sinSolapesNiSalidas(r.hojas[0]!, ZONA);
  });

  it("los peajes de la semana, con el casi borrado: 4 en una hoja al 100 %", () => {
    const r = repartir([PEAJE, PEAJE, PEAJE_BORRADO, PEAJE], ZONA)!;
    expect(r.escala).toBe(1);
    expect(r.hojas).toHaveLength(1);
    sinSolapesNiSalidas(r.hojas[0]!, ZONA);
  });

  it("seis peajes normales caben al 100 %: dos filas de tres", () => {
    const r = repartir(Array(6).fill(PEAJE), ZONA)!;
    expect(r.escala).toBe(1);
    expect(r.hojas).toHaveLength(1);
    expect(new Set(r.hojas[0]!.map((c) => c.y)).size).toBe(2);
  });

  it("reduce solo si con eso sobra una hoja, y lo justo", () => {
    // Ocho peajes al 100 % son dos hojas; al 80 % caben 4 por fila y dos filas: una hoja.
    const r = repartir(Array(8).fill(PEAJE), ZONA)!;
    expect(r.hojas).toHaveLength(1);
    expect(r.escala).toBeLessThan(1);
    expect(r.escala).toBeGreaterThanOrEqual(0.8);
    // Y es la MAYOR que lo consigue: un punto más y ya no cabe en una.
    const unPuntoMas = repartir(Array(8).fill(PEAJE), ZONA, { minima: r.escala + 0.01 })!;
    expect(unPuntoMas.hojas.length).toBeGreaterThan(1);
    sinSolapesNiSalidas(r.hojas[0]!, ZONA);
  });

  it("si reducir no ahorra ninguna hoja, se queda al 100 %", () => {
    // Siete del bar: al 100 % dos hojas (4 + 3); al 80 % también dos (6 + 1).
    const r = repartir(Array(7).fill(BAR), ZONA)!;
    expect(r.hojas).toHaveLength(2);
    expect(r.escala).toBe(1);
  });

  it("nunca baja del 80 %", () => {
    const r = repartir(Array(30).fill(PEAJE), ZONA)!;
    expect(r.escala).toBeGreaterThanOrEqual(0.8);
    for (const h of r.hojas) sinSolapesNiSalidas(h, ZONA);
    expect(r.hojas.flat().map((c) => c.indice)).toEqual([...Array(30).keys()]);
  });

  it("el orden de lectura se respeta: de izquierda a derecha y de arriba abajo", () => {
    const r = repartir([BAR, PEAJE, BAR, PEAJE, PEAJE], ZONA)!;
    const todas = r.hojas.flat();
    expect(todas.map((c) => c.indice)).toEqual([0, 1, 2, 3, 4]);
    for (let i = 1; i < todas.length; i++) {
      const a = todas[i - 1]!;
      const b = todas[i]!;
      expect(b.y > a.y || (b.y === a.y && b.x > a.x)).toBe(true);
    }
  });

  it("cada fila va centrada", () => {
    const r = repartir([BAR], ZONA)!;
    const c = r.hojas[0]![0]!;
    expect(c.x).toBeCloseTo((ZONA.ancho - c.ancho) / 2, 6);
  });

  it("un ticket que no cabe ni al 80 % no entra en el mosaico", () => {
    const supermercado = mm(80, 600);
    expect(cabeSolo(supermercado, ZONA, 0.8)).toBe(false);
    expect(repartir([BAR, supermercado], ZONA)).toBeNull();
  });

  it("nada que repartir, ninguna hoja", () => {
    expect(repartir([], ZONA)).toEqual({ escala: 1, hojas: [] });
  });
});

describe("qué es un ticket", () => {
  it("los de la semana: el bar y el peaje, tal cual salen del escáner", () => {
    expect(esTicket({ ancho: 79, alto: 136 }, { ancho: 68, alto: 119 })).toBe(true);
    expect(esTicket({ ancho: 59, alto: 144 }, { ancho: 49, alto: 128 })).toBe(true);
  });

  it("un ticket en medio de un A4 que el escáner no recortó", () => {
    expect(esTicket({ ancho: 210, alto: 297 }, { ancho: 70, alto: 120 })).toBe(true);
  });

  it("una factura A4 no, ni su última hoja con solo los totales", () => {
    expect(esTicket({ ancho: 210, alto: 297 }, { ancho: 190, alto: 277 })).toBe(false);
    expect(esTicket({ ancho: 210, alto: 297 }, { ancho: 186, alto: 40 })).toBe(false);
  });

  it("un A4 con algo estrecho pero largo, que ocupa más de un cuarto de hoja, no", () => {
    expect(esTicket({ ancho: 210, alto: 297 }, { ancho: 100, alto: 200 })).toBe(false);
  });

  it("una página en blanco no es nada", () => {
    expect(esTicket({ ancho: 79, alto: 136 }, { ancho: 0, alto: 0 })).toBe(false);
  });
});

describe("dónde hay tinta", () => {
  /** Una página de 100×50 en blanco con un rectángulo negro. */
  function pagina(dibujar: (poner: (x: number, y: number) => void) => void, ancho = 100, alto = 50) {
    const g = new Uint8Array(ancho * alto).fill(255);
    dibujar((x, y) => (g[y * ancho + x] = 0));
    return g;
  }

  it("encuentra la caja del texto", () => {
    const g = pagina((p) => {
      for (let y = 10; y < 30; y++) for (let x = 20; x < 60; x++) p(x, y);
    });
    expect(cajaDeTinta(g, 100, 50, 100)).toEqual({ x0: 20, y0: 10, x1: 60, y1: 30 });
  });

  it("una mota suelta no estira la caja", () => {
    const g = pagina((p) => {
      for (let y = 10; y < 30; y++) for (let x = 20; x < 60; x++) p(x, y);
      p(98, 48);
    });
    // Con una proporción que exige 2 píxeles por fila y por columna, la mota sola no cuenta.
    expect(cajaDeTinta(g, 100, 50, 100, { proporcion: 0.04 })).toEqual({ x0: 20, y0: 10, x1: 60, y1: 30 });
  });

  it("respeta el paso de fila del rasterizado", () => {
    const g = new Uint8Array(120 * 50).fill(255);
    for (let y = 5; y < 15; y++) for (let x = 3; x < 9; x++) g[y * 120 + x] = 0;
    expect(cajaDeTinta(g, 100, 50, 120)).toEqual({ x0: 3, y0: 5, x1: 9, y1: 15 });
  });

  it("el gris claro de un ticket desvaído también es tinta (el peaje de Calafell)", () => {
    // A 72 ppp sus letras salen entre 130 y 220: con el umbral de 140 se perdían.
    const g = new Uint8Array(100 * 50).fill(245);
    for (let y = 5; y < 45; y++) for (let x = 10; x < 90; x++) g[y * 100 + x] = 180;
    expect(cajaDeTinta(g, 100, 50, 100)).toEqual({ x0: 10, y0: 5, x1: 90, y1: 45 });
  });

  it("en blanco, null", () => {
    expect(cajaDeTinta(new Uint8Array(100 * 50).fill(255), 100, 50, 100)).toBeNull();
  });
});

describe("cuándo se fía del recorte", () => {
  it("los de la semana pierden un 15 % por lado: se recortan", () => {
    expect(recorteFiable({ ancho: 79, alto: 136 }, { ancho: 68, alto: 119 })).toBe(true);
    expect(recorteFiable({ ancho: 59, alto: 144 }, { ancho: 49, alto: 128 })).toBe(true);
  });

  it("el peaje de Calafell visto solo por su código de barras: no, página entera", () => {
    expect(recorteFiable({ ancho: 59, alto: 143 }, { ancho: 34, alto: 17 })).toBe(false);
    expect(recorteFiable({ ancho: 59, alto: 143 }, { ancho: 50, alto: 60 })).toBe(false);
    expect(recorteFiable({ ancho: 59, alto: 143 }, { ancho: 30, alto: 130 })).toBe(false);
  });

  it("en papel grande sí: ahí el ticket es por fuerza una parte de la hoja", () => {
    expect(recorteFiable({ ancho: 210, alto: 297 }, { ancho: 64, alto: 115 })).toBe(true);
  });
});
