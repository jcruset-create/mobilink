import { describe, expect, it } from "vitest";

import {
  kMiniaturasEnTarjeta,
  nombreDeFoto,
  tiraDeFotos,
  type FotoTarjeta,
} from "./roadsideFotosTarjeta";

const foto = (id: number, kind = "foto_averia"): FotoTarjeta => ({
  id,
  url: `https://ficheros/${id}.jpg`,
  kind,
});

const varias = (n: number) => Array.from({ length: n }, (_, i) => foto(i + 1));

describe("cuántas se ven y cuántas se resumen", () => {
  it("sin fotos, no hay tira", () => {
    expect(tiraDeFotos([], 0)).toEqual({ miniaturas: [], resto: 0 });
    expect(tiraDeFotos(null, 0)).toEqual({ miniaturas: [], resto: 0 });
    expect(tiraDeFotos(undefined)).toEqual({ miniaturas: [], resto: 0 });
  });

  it("con menos de cuatro se ven todas y no hay «+N»", () => {
    const r = tiraDeFotos(varias(3), 3);
    expect(r.miniaturas).toHaveLength(3);
    expect(r.resto).toBe(0);
  });

  it("con cuatro justas tampoco hay «+N»", () => {
    const r = tiraDeFotos(varias(4), 4);
    expect(r.miniaturas).toHaveLength(kMiniaturasEnTarjeta);
    expect(r.resto).toBe(0);
  });

  it("con más de cuatro, las cuatro primeras y el resto contado", () => {
    const r = tiraDeFotos(varias(5), 9);
    expect(r.miniaturas.map((f) => f.id)).toEqual([1, 2, 3, 4]);
    expect(r.resto).toBe(5);
  });

  /*
   * Lo importante de esta prueba: el «+N» se calcula contra el TOTAL del
   * servidor, no contra lo que ha llegado. El listado manda solo las primeras
   * para no arrastrar cien URLs por asistencia; contra lo recibido, una
   * asistencia con veinte fotos diria «+1» y estaria mintiendo.
   */
  it("el «+N» sale del total, no de las fotos recibidas", () => {
    const r = tiraDeFotos(varias(5), 20);
    expect(r.miniaturas).toHaveLength(4);
    expect(r.resto).toBe(16);
  });
});

describe("el total viene de fuera, así que no se fía", () => {
  it("un total más corto que lo recibido no borra fotos", () => {
    // Mas vale quedarse corto en el «+N» que esconder lo que se tiene.
    const r = tiraDeFotos(varias(5), 2);
    expect(r.miniaturas).toHaveLength(4);
    expect(r.resto).toBe(1);
  });

  it("sin total se cuenta lo que hay", () => {
    expect(tiraDeFotos(varias(6)).resto).toBe(2);
    expect(tiraDeFotos(varias(6), null).resto).toBe(2);
  });

  it("un total que no es un número no rompe nada", () => {
    expect(tiraDeFotos(varias(6), Number.NaN).resto).toBe(2);
    expect(tiraDeFotos(varias(6), "muchas" as unknown as number).resto).toBe(2);
  });

  it("un total con decimales no pinta «+2.7»", () => {
    expect(tiraDeFotos(varias(4), 6.7).resto).toBe(2);
  });
});

describe("lo que no se puede pintar", () => {
  it("una foto sin URL no ocupa un hueco", () => {
    // Una miniatura rota es peor que una miniatura menos: parece que la foto
    // se ha perdido cuando lo que falta es el dato.
    const rotas = [foto(1), { id: 2, url: "", kind: "foto" }, foto(3)];
    const r = tiraDeFotos(rotas as FotoTarjeta[], 3);
    expect(r.miniaturas.map((f) => f.id)).toEqual([1, 3]);
  });

  it("si no llega una lista, no revienta", () => {
    expect(tiraDeFotos("no es una lista" as unknown as FotoTarjeta[])).toEqual({
      miniaturas: [],
      resto: 0,
    });
  });
});

describe("cómo se llama cada foto", () => {
  it("los tipos conocidos tienen nombre en castellano", () => {
    expect(nombreDeFoto("matricula_camion")).toBe("Matrícula");
    expect(nombreDeFoto("foto_averia")).toBe("Avería");
    expect(nombreDeFoto("trabajo_realizado")).toBe("Trabajo");
  });

  it("un tipo nuevo sale tal cual en vez de esconderse", () => {
    // Devolver el `kind` en crudo es feo, pero permite reconocer una foto de
    // un tipo nuevo; un «Foto» generico la haria invisible.
    expect(nombreDeFoto("foto_termografica")).toBe("foto_termografica");
  });

  it("sin tipo, «Foto»", () => {
    expect(nombreDeFoto(null)).toBe("Foto");
    expect(nombreDeFoto("")).toBe("Foto");
    expect(nombreDeFoto("   ")).toBe("Foto");
  });
});
