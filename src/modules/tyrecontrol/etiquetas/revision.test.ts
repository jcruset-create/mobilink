import { describe, it, expect } from "vitest";
import type { FotoEtiqueta } from "./datos";
import {
  claveSerie, normalizarSerie, serieEditable, imprimible, porRevisar,
  clavesRepetidas, esRepetida, resumirLote, sinLeer,
} from "./revision";

const foto = (over: Partial<FotoEtiqueta> = {}): FotoEtiqueta => ({
  id: over.id ?? "f1", lote_id: "l1", empresa_id: "e1", foto_url: "x.jpg",
  serie_detectada: null, confianza: null, dudoso: false, serie_confirmada: null,
  estado: "pendiente", revisado_por: null, revisado_at: null, impreso_at: null,
  created_at: "2026-09-17T10:00:00Z", ...over,
});

describe("el número que se propone en la casilla", () => {
  it("manda lo que ya confirmó una persona: recargar no le deshace la corrección", () => {
    expect(serieEditable(foto({ serie_detectada: "AAA", serie_confirmada: "BBB" }))).toBe("BBB");
  });
  it("si nadie ha confirmado, se propone lo leído", () => {
    expect(serieEditable(foto({ serie_detectada: "AAA" }))).toBe("AAA");
  });
  it("sin ninguno de los dos, la casilla sale VACÍA: no se inventa un número", () => {
    expect(serieEditable(foto())).toBe("");
  });
  it("se limpia igual que al guardar", () => {
    expect(normalizarSerie(" ab 12 ")).toBe("AB12");
  });
});

describe("qué se puede imprimir", () => {
  it("solo lo confirmado por una persona", () => {
    expect(imprimible(foto({ estado: "confirmada", serie_confirmada: "A1" }))).toBe(true);
    expect(imprimible(foto({ estado: "detectada", serie_detectada: "A1" }))).toBe(false);
    expect(imprimible(foto({ estado: "revisar", serie_detectada: "A1" }))).toBe(false);
  });
  it("una ya impresa se puede volver a imprimir: las etiquetas se rompen", () => {
    expect(imprimible(foto({ estado: "impresa", serie_confirmada: "A1" }))).toBe(true);
  });
  it("confirmada pero sin número no se imprime: sería una etiqueta en blanco", () => {
    expect(imprimible(foto({ estado: "confirmada", serie_confirmada: "   " }))).toBe(false);
  });
  it("una descartada no se imprime ni con número", () => {
    expect(imprimible(foto({ estado: "descartada", serie_confirmada: "A1" }))).toBe(false);
  });
});

describe("la misma rueda fotografiada dos veces", () => {
  it("se marcan las dos, no una", () => {
    const fotos = [
      foto({ id: "1", serie_detectada: "1234567890123" }),
      foto({ id: "2", serie_detectada: "1234567890123" }),
      foto({ id: "3", serie_detectada: "9999999999999" }),
    ];
    const rep = clavesRepetidas(fotos);
    expect(esRepetida(fotos[0], rep)).toBe(true);
    expect(esRepetida(fotos[1], rep)).toBe(true);
    expect(esRepetida(fotos[2], rep)).toBe(false);
  });

  it("un guion de más no hace de dos ruedas una", () => {
    expect(claveSerie("123-456")).toBe(claveSerie("123456"));
    const rep = clavesRepetidas([
      foto({ id: "1", serie_detectada: "123-456" }),
      foto({ id: "2", serie_confirmada: "123456" }),
    ]);
    expect(rep.size).toBe(1);
  });

  it("descartar la repetida es cómo se arregla: deja de estar marcada", () => {
    const fotos = [
      foto({ id: "1", serie_detectada: "AAA111" }),
      foto({ id: "2", serie_detectada: "AAA111", estado: "descartada" }),
    ];
    expect(clavesRepetidas(fotos).size).toBe(0);
  });

  it("dos fotos SIN número no son la misma rueda", () => {
    expect(clavesRepetidas([foto({ id: "1" }), foto({ id: "2" })]).size).toBe(0);
  });

  it("manda el número confirmado: si se corrige uno de los dos, ya no hay duplicado", () => {
    const fotos = [
      foto({ id: "1", serie_detectada: "AAA111" }),
      foto({ id: "2", serie_detectada: "AAA111", serie_confirmada: "AAA112" }),
    ];
    expect(clavesRepetidas(fotos).size).toBe(0);
  });
});

describe("los recuentos de la cabecera", () => {
  const fotos = [
    foto({ id: "1", estado: "pendiente" }),
    foto({ id: "2", estado: "revisar", serie_detectada: "A1" }),
    foto({ id: "3", estado: "confirmada", serie_confirmada: "B2" }),
    foto({ id: "4", estado: "impresa", serie_confirmada: "C3" }),
    foto({ id: "5", estado: "descartada" }),
    foto({ id: "6", estado: "confirmada", serie_confirmada: "B2" }),
  ];
  const r = resumirLote(fotos);

  it("cuenta todas las fotos, descartadas incluidas", () => {
    expect(r.total).toBe(6);
  });
  it("por revisar son las que nadie ha mirado todavía", () => {
    expect(r.porRevisar).toBe(2);
    expect(porRevisar(foto({ estado: "no_detectada" }))).toBe(true);
    expect(porRevisar(foto({ estado: "confirmada" }))).toBe(false);
  });
  it("confirmadas e impresas se cuentan aparte: una impresa ya no está pendiente de imprimir", () => {
    expect(r.confirmadas).toBe(2);
    expect(r.impresas).toBe(1);
  });
  it("una descartada no se cuenta como que le falte el número", () => {
    expect(r.descartadas).toBe(1);
    expect(r.sinNumero).toBe(1); // la 1, pendiente y sin leer
  });
  it("avisa de cuántas están repetidas", () => {
    expect(r.repetidas).toBe(2); // la 3 y la 6, las dos con B2
  });
  it("un lote vacío no revienta", () => {
    const v = resumirLote([]);
    expect(v.total).toBe(0);
    expect(v.repetidas).toBe(0);
  });
});

describe("qué fotos hay que analizar", () => {
  it("las que la tablet acaba de subir y nadie ha leído", () => {
    expect(sinLeer([foto({ id: "1" }), foto({ id: "2" })]).length).toBe(2);
  });

  it("una ya leída NO se vuelve a analizar: costaría otra llamada para el mismo número", () => {
    expect(sinLeer([foto({ estado: "detectada", serie_detectada: "A1" })])).toEqual([]);
    expect(sinLeer([foto({ estado: "revisar", serie_detectada: "A1" })])).toEqual([]);
    expect(sinLeer([foto({ estado: "no_detectada" })])).toEqual([]);
  });

  it("y mucho menos una que una persona ya confirmó, imprimió o descartó", () => {
    for (const estado of ["confirmada", "impresa", "descartada"] as const) {
      expect(sinLeer([foto({ estado })])).toEqual([]);
    }
  });

  it("un lote vacío no da trabajo", () => {
    expect(sinLeer([])).toEqual([]);
  });
});
