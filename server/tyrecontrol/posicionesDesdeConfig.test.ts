import { describe, it, expect } from "vitest";
import { generarPosiciones, ruedasPorEje } from "./posicionesDesdeConfig.ts";

describe("ruedasPorEje", () => {
  it("2x4x2 son tres ejes con 2, 4 y 2 neumáticos", () => {
    expect(ruedasPorEje("2x4x2")).toEqual([2, 4, 2]);
  });
  it("acepta la X en mayúscula", () => {
    expect(ruedasPorEje("2X4")).toEqual([2, 4]);
  });
  it("rechaza un número de ruedas que no sea 2 ni 4", () => {
    expect(ruedasPorEje("2x3")).toEqual([]);
  });
  it("sin configuración no devuelve nada", () => {
    expect(ruedasPorEje(null)).toEqual([]);
    expect(ruedasPorEje("")).toEqual([]);
  });
});

describe("generarPosiciones — el caso del camión 2x4x2", () => {
  const p = generarPosiciones("2x4x2");

  it("crea 8 posiciones", () => {
    expect(p).toHaveLength(8);
  });

  it("eje 1: dos ruedas, izquierda y derecha", () => {
    expect(p.filter((x) => x.eje === 1).map((x) => x.codigo_posicion)).toEqual(["E1_IZQ", "E1_DER"]);
  });

  it("eje 2: cuatro ruedas gemelas, exterior e interior a cada lado", () => {
    expect(p.filter((x) => x.eje === 2).map((x) => x.codigo_posicion))
      .toEqual(["E2_IZQ_EXT", "E2_IZQ_INT", "E2_DER_INT", "E2_DER_EXT"]);
  });

  it("eje 3: dos ruedas, izquierda y derecha", () => {
    expect(p.filter((x) => x.eje === 3).map((x) => x.codigo_posicion)).toEqual(["E3_IZQ", "E3_DER"]);
  });

  it("el orden visual es correlativo y sin huecos", () => {
    expect(p.map((x) => x.orden_visual)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("generarPosiciones — colocación en el plano", () => {
  it("la izquierda queda a la izquierda y la derecha a la derecha", () => {
    // Este es justo el fallo que tenía calibrado a mano el tipo tractora_2_ejes.
    for (const config of ["2x2", "2x4", "2x4x2", "2x4x4", "2x2x2"]) {
      for (const x of generarPosiciones(config)) {
        if (x.lado === "izq") expect(x.pos_x, `${config} ${x.codigo_posicion}`).toBeLessThan(50);
        else expect(x.pos_x, `${config} ${x.codigo_posicion}`).toBeGreaterThan(50);
      }
    }
  });

  it("en un eje gemelado la interior queda más cerca del centro que la exterior", () => {
    const p = generarPosiciones("2x4");
    const izqExt = p.find((x) => x.codigo_posicion === "E2_IZQ_EXT")!;
    const izqInt = p.find((x) => x.codigo_posicion === "E2_IZQ_INT")!;
    const derInt = p.find((x) => x.codigo_posicion === "E2_DER_INT")!;
    const derExt = p.find((x) => x.codigo_posicion === "E2_DER_EXT")!;
    expect(izqInt.pos_x).toBeGreaterThan(izqExt.pos_x);
    expect(derInt.pos_x).toBeLessThan(derExt.pos_x);
  });

  it("los ejes se reparten de delante hacia atrás sin solaparse", () => {
    const p = generarPosiciones("2x4x2");
    const yPorEje = [1, 2, 3].map((e) => p.find((x) => x.eje === e)!.pos_y);
    expect(yPorEje[0]).toBeLessThan(yPorEje[1]);
    expect(yPorEje[1]).toBeLessThan(yPorEje[2]);
  });

  it("todas las ruedas de un mismo eje están a la misma altura", () => {
    const p = generarPosiciones("2x4x2");
    for (const eje of [1, 2, 3]) {
      const ys = new Set(p.filter((x) => x.eje === eje).map((x) => x.pos_y));
      expect(ys.size).toBe(1);
    }
  });

  it("todas las posiciones caben dentro del recuadro", () => {
    for (const x of generarPosiciones("2x4x4")) {
      expect(x.pos_x).toBeGreaterThanOrEqual(0);
      expect(x.pos_x + x.pos_w).toBeLessThanOrEqual(100);
      expect(x.pos_y).toBeGreaterThanOrEqual(0);
      expect(x.pos_y + x.pos_h).toBeLessThanOrEqual(100);
    }
  });
});

describe("generarPosiciones — no inventa planos", () => {
  it("una configuración inválida no genera nada", () => {
    expect(generarPosiciones("2x3")).toEqual([]);
    expect(generarPosiciones("pepe")).toEqual([]);
    expect(generarPosiciones(null)).toEqual([]);
  });

  it("el total de posiciones coincide siempre con la suma de la configuración", () => {
    const casos: [string, number][] = [["2x2", 4], ["2x4", 6], ["2x2x2", 6], ["2x4x2", 8], ["2x4x4", 10], ["2x2x2x2", 8]];
    for (const [config, total] of casos) {
      expect(generarPosiciones(config), config).toHaveLength(total);
    }
  });
});
