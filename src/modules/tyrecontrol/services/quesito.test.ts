import { describe, expect, it } from "vitest";

import { arcosDeQuesito } from "./quesito";

const p = (etiqueta: string, valor: number) => ({ etiqueta, valor });

describe("arcosDeQuesito()", () => {
  it("una porción por cada valor, en el mismo orden", () => {
    const a = arcosDeQuesito([p("a", 1), p("b", 2), p("c", 3)]);
    expect(a.map((x) => x.indice)).toEqual([0, 1, 2]);
    expect(a.map((x) => x.fraccion)).toEqual([1 / 6, 2 / 6, 3 / 6]);
  });

  /*
   * Un arco de 360° empieza y acaba en el mismo punto, así que el trazo
   * desaparece: el quesito saldría vacío justo cuando una categoría se lo
   * lleva todo, que es cuando más importa verlo.
   */
  it("el 100 % se dibuja como círculo, no como un arco que no se ve", () => {
    const [a] = arcosDeQuesito([p("todo", 7)]);
    expect(a.fraccion).toBe(1);
    // Dos medias vueltas, y sin el vértice del centro que tienen las cuñas.
    expect(a.d.match(/A /g)).toHaveLength(2);
    expect(a.d).not.toContain("L ");
  });

  it("y sigue siendo un círculo aunque haya otras porciones a cero", () => {
    const a = arcosDeQuesito([p("nada", 0), p("todo", 5), p("tampoco", 0)]);
    expect(a).toHaveLength(1);
    expect(a[0].indice).toBe(1);
    expect(a[0].fraccion).toBe(1);
  });

  /*
   * SVG no sabe por qué lado ir de un punto a otro: sin levantar la bandera,
   * una porción del 70 % se dibuja igual que la del 30 %.
   */
  it("levanta el arco mayor en cuanto se pasa de media vuelta", () => {
    const [grande, pequena] = arcosDeQuesito([p("grande", 7), p("pequena", 3)]);
    expect(grande.d).toMatch(/A 55 55 0 1 1/);
    expect(pequena.d).toMatch(/A 55 55 0 0 1/);
  });

  it("justo la mitad NO es arco mayor", () => {
    const [a] = arcosDeQuesito([p("mitad", 1), p("otra", 1)]);
    expect(a.d).toMatch(/A 55 55 0 0 1/);
  });

  // Un path sin superficie no se ve pero sí se puede pulsar, y ensucia el SVG.
  it("las porciones a cero no se dibujan", () => {
    const a = arcosDeQuesito([p("a", 5), p("vacia", 0), p("b", 5)]);
    expect(a).toHaveLength(2);
    expect(a.map((x) => x.indice)).toEqual([0, 2]);
  });

  it("un quesito de nada no es un círculo de la primera categoría", () => {
    expect(arcosDeQuesito([])).toEqual([]);
    expect(arcosDeQuesito([p("a", 0), p("b", 0)])).toEqual([]);
  });

  it("los valores negativos no restan superficie a los demás", () => {
    const a = arcosDeQuesito([p("mala", -5), p("buena", 10)]);
    expect(a).toHaveLength(1);
    expect(a[0].fraccion).toBe(1);
  });

  // La primera porción tiene que arrancar arriba del todo, o el quesito sale
  // girado y las etiquetas dejan de corresponder con lo que se ve.
  it("empieza arriba y gira en el sentido del reloj", () => {
    const [primera] = arcosDeQuesito([p("a", 1), p("b", 3)]);
    expect(primera.d).toContain("L 60 5");          // arriba del centro
    expect(primera.d).toMatch(/A 55 55 0 0 1 115 60/); // un cuarto: a la derecha
  });

  // El caso real del informe: 0 recauchutadas, 2 reesculturadas y 2.114 resto.
  it("una porción diminuta se dibuja igual, sin tragarse el círculo", () => {
    const a = arcosDeQuesito([p("Recauchutadas", 0), p("Reesculturadas", 2), p("Resto", 2114)]);
    expect(a).toHaveLength(2);
    expect(a[0].fraccion).toBeCloseTo(2 / 2116, 6);
    expect(a[1].fraccion).toBeCloseTo(2114 / 2116, 6);
    expect(a[1].d).toMatch(/A 55 55 0 1 1/);
  });
});
