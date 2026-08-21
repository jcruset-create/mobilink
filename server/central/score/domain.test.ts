/**
 * Cash Health Score. Funciones puras.
 *
 * Lo que se fija: que el número siempre venga con sus motivos, que el descuadre
 * se mida en proporción a lo que mueve la caja, y que «sin datos» no sea un cero.
 */

import { describe, expect, it } from "vitest";
import { puntuar, puntuarGrupo, TOPES, type SenalesCaja } from "./domain.ts";

const sana = (over: Partial<SenalesCaja> = {}): SenalesCaja => ({
  registerId: 1,
  jornadas: 20,
  jornadasConDescuadre: 0,
  descuadreCentimos: 0,
  efectivoCentimos: 500000,
  diasSinCerrar: 1,
  transitoDiasAbierto: null,
  pendienteBancoDias: 2,
  calderillaCentimos: 10000,
  ...over,
});

describe("puntuación de una caja", () => {
  it("una caja sin problemas está en 100 y sin motivos", () => {
    const p = puntuar(sana());
    expect(p.puntos).toBe(100);
    expect(p.nivel).toBe("BUENA");
    expect(p.motivos).toEqual([]);
  });

  /*
   * Ponerle cero a una caja recién dada de alta la colocaría la primera de la
   * lista de problemas sin haber hecho nada; ponerle cien diría que está
   * perfecta sin haberla mirado.
   */
  it("una caja sin jornadas no tiene puntuación, no tiene un cero", () => {
    const p = puntuar(sana({ jornadas: 0 }));
    expect(p.puntos).toBeNull();
    expect(p.nivel).toBe("SIN_DATOS");
  });

  /*
   * Veinte euros descuadrados en una caja que mueve doscientos es grave; los
   * mismos veinte en una que mueve veinte mil es ruido. En absoluto, el
   * indicador solo diría cuál es la caja más grande.
   */
  it("el descuadre se mide en proporción a lo que mueve la caja", () => {
    const pequena = puntuar(
      sana({ descuadreCentimos: 2000, efectivoCentimos: 20000, jornadasConDescuadre: 1 })
    );
    const grande = puntuar(
      sana({ descuadreCentimos: 2000, efectivoCentimos: 2000000, jornadasConDescuadre: 1 })
    );

    expect(pequena.puntos!).toBeLessThan(grande.puntos!);
    const dPequena = pequena.motivos.find((m) => m.factor === "DESCUADRE")!;
    expect(dPequena.puntos).toBe(TOPES.DESCUADRE);
  });

  /*
   * Un descuadre gordo un día es un incidente; descuadrar poco todos los días
   * es un procedimiento que no se sigue, y el importe no distingue una cosa de
   * la otra.
   */
  it("descuadrar a menudo resta aunque el importe sea pequeño", () => {
    const p = puntuar(
      sana({ jornadas: 20, jornadasConDescuadre: 20, descuadreCentimos: 100, efectivoCentimos: 900000 })
    );
    const frecuencia = p.motivos.find((m) => m.factor === "FRECUENCIA_DESCUADRE")!;
    expect(frecuencia.puntos).toBe(TOPES.FRECUENCIA_DESCUADRE);
    expect(frecuencia.detalle).toContain("20 de 20");
  });

  it("tres días sin cerrar es un fin de semana; diez ya no", () => {
    expect(puntuar(sana({ diasSinCerrar: 3 })).puntos).toBe(100);
    const p = puntuar(sana({ diasSinCerrar: 10 }));
    expect(p.motivos.some((m) => m.factor === "SIN_CERRAR")).toBe(true);
    expect(p.puntos!).toBeLessThan(100);
  });

  /*
   * Sin topes, un descuadre enorme se llevaría la puntuación a cero y taparía
   * que además lleva tres semanas sin cerrar: el cero absorbe lo demás y se
   * pierde qué hay que atender primero.
   */
  it("ningún factor puede llevarse la puntuación entera", () => {
    const p = puntuar(
      sana({ descuadreCentimos: 500000, efectivoCentimos: 500000, jornadasConDescuadre: 20 })
    );
    const descuadre = p.motivos.find((m) => m.factor === "DESCUADRE")!;
    expect(descuadre.puntos).toBe(TOPES.DESCUADRE);
    // Queda sitio para que se vean los demás problemas.
    expect(p.puntos!).toBeGreaterThan(0);
  });

  it("nunca baja de cero por muchos problemas que haya", () => {
    const p = puntuar({
      registerId: 9,
      jornadas: 10,
      jornadasConDescuadre: 10,
      descuadreCentimos: 999999,
      efectivoCentimos: 1000,
      diasSinCerrar: 90,
      transitoDiasAbierto: 60,
      pendienteBancoDias: 90,
      calderillaCentimos: 0,
    });
    expect(p.puntos).toBe(0);
    expect(p.nivel).toBe("MALA");
  });

  /*
   * Un 62 no dice nada. Lo que hace falta es por qué es 62 y qué lo arregla,
   * ordenado por lo que más pesa.
   */
  it("los motivos vienen ordenados de lo que más resta a lo que menos", () => {
    const p = puntuar(sana({ diasSinCerrar: 20, calderillaCentimos: 100 }));
    expect(p.motivos.length).toBeGreaterThan(1);
    for (let i = 1; i < p.motivos.length; i++) {
      expect(p.motivos[i - 1].puntos).toBeGreaterThanOrEqual(p.motivos[i].puntos);
    }
  });
});

describe("puntuación de un grupo", () => {
  /*
   * Ponderando por importe, la caja mala desaparecería. Y la caja por la que se
   * escapa el dinero suele ser precisamente la pequeña.
   */
  it("es la media de las cajas, no una ponderación por dinero", () => {
    const buena = puntuar(sana({ registerId: 1, efectivoCentimos: 10_000_000 }));
    const mala = puntuar(
      sana({ registerId: 2, efectivoCentimos: 10000, descuadreCentimos: 5000, jornadasConDescuadre: 15 })
    );

    const g = puntuarGrupo([buena, mala]);
    expect(g.puntos).toBe(Math.round((buena.puntos! + mala.puntos!) / 2));
    expect(g.puntos!).toBeLessThan(buena.puntos!);
  });

  it("las cajas sin datos no entran en la media, ni como cero ni como cien", () => {
    const buena = puntuar(sana());
    const nueva = puntuar(sana({ registerId: 2, jornadas: 0 }));

    const g = puntuarGrupo([buena, nueva]);
    expect(g.puntos).toBe(100);
    expect(g.conDatos).toBe(1);
    expect(g.sinDatos).toBe(1);
  });

  it("un grupo sin ninguna caja con datos no tiene puntuación", () => {
    expect(puntuarGrupo([puntuar(sana({ jornadas: 0 }))]).puntos).toBeNull();
  });

  it("enseña las peores primero: son las que hay que mirar", () => {
    const cajas = [90, 30, 70, 50].map((p, i) =>
      puntuar(sana({ registerId: i + 1, diasSinCerrar: 3 + (100 - p) / 4 }))
    );
    const g = puntuarGrupo(cajas);
    for (let i = 1; i < g.peores.length; i++) {
      expect(g.peores[i - 1].puntos!).toBeLessThanOrEqual(g.peores[i].puntos!);
    }
  });
});
