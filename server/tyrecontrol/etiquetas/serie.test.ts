import { describe, it, expect } from "vitest";
import { prepararPropuesta, type LecturaFlanco } from "../flanco/flanco.ts";
import {
  normalizarSerie, claveSerie, clasificarLectura, seriesRepetidas, esRepetida,
  CONFIANZA_PARA_ETIQUETAR,
} from "./serie.ts";

const c = (valor: string | null, confianza: number | null = 0.95) => ({ valor, confianza });
const vacio = c(null);
/** Una lectura de flanco donde lo único que importa es el número de serie. */
const conSerie = (serie: ReturnType<typeof c>, aviso: string | null = null) =>
  prepararPropuesta({
    marca: vacio, modelo: vacio, medida: vacio, indice_carga_simple: vacio,
    indice_carga_doble: vacio, codigo_velocidad: vacio, dot: vacio,
    numero_serie: serie, otros_textos: [], aviso,
  } as LecturaFlanco);

describe("limpiar el número", () => {
  it("quita espacios y pone mayúsculas", () => {
    expect(normalizarSerie("  ab 12 34  ")).toBe("AB1234");
  });
  it("lo que no tiene nada dentro es nada", () => {
    expect(normalizarSerie("   ")).toBeNull();
    expect(normalizarSerie(null)).toBeNull();
  });
  it("NO recorta ni da forma: cada fabricante estampa el suyo a su manera", () => {
    expect(normalizarSerie("1234-5678-90123")).toBe("1234-5678-90123");
  });
});

describe("cuándo dos números son el mismo", () => {
  it("un guion de más no hace de dos ruedas una", () => {
    expect(claveSerie("1234-567")).toBe(claveSerie("1234567"));
  });
  it("mayúsculas y minúsculas tampoco", () => {
    expect(claveSerie("ab12")).toBe(claveSerie("AB12"));
  });
  it("dos números distintos siguen siendo distintos", () => {
    expect(claveSerie("1234567890123")).not.toBe(claveSerie("1234567890124"));
  });
});

describe("qué se hace con lo que se lee", () => {
  it("un número claro queda detectado y sin aviso", () => {
    const r = clasificarLectura(conSerie(c("1234567890123", 0.95)));
    expect(r.serie).toBe("1234567890123");
    expect(r.estado).toBe("detectada");
    expect(r.dudoso).toBe(false);
    expect(r.aviso).toBeNull();
  });

  it("un número dudoso NO se tira: se guarda y se manda a revisar", () => {
    const r = clasificarLectura(conSerie(c("1234567890123", 0.4)));
    // Tirarlo obligaría a teclear trece dígitos a mano de una foto que el
    // modelo había leído.
    expect(r.serie).toBe("1234567890123");
    expect(r.estado).toBe("revisar");
    expect(r.dudoso).toBe(true);
    expect(r.aviso).toMatch(/compru/i);
  });

  it("justo en el límite pasa como bueno", () => {
    const r = clasificarLectura(conSerie(c("1234567890123", CONFIANZA_PARA_ETIQUETAR)));
    expect(r.estado).toBe("detectada");
  });

  it("una foto sin número no es un fallo, es un dato", () => {
    const r = clasificarLectura(conSerie(vacio));
    expect(r.serie).toBeNull();
    expect(r.estado).toBe("no_detectada");
    expect(r.aviso).toMatch(/no se ve/i);
  });

  it("si la IA dice POR QUÉ no se lee, se repite tal cual", () => {
    const r = clasificarLectura(conSerie(vacio, "El flanco está embarrado"));
    expect(r.aviso).toBe("El flanco está embarrado");
  });

  it("una lectura que no llegó nunca no revienta", () => {
    expect(clasificarLectura(null).estado).toBe("no_detectada");
    expect(clasificarLectura(undefined).serie).toBeNull();
  });

  it("con la confianza a mano, manda la confianza", () => {
    const r = clasificarLectura(conSerie(c("1234567890123", 0.95)), 0.2);
    expect(r.estado).toBe("revisar");
    expect(r.confianza).toBe(0.2);
  });

  it("de todo el flanco se queda SOLO con el número: aquí no se busca catálogo", () => {
    const r: Record<string, unknown> = clasificarLectura(conSerie(c("1234567890123")));
    for (const campo of ["marca", "modelo", "medida", "dot", "codigo_velocidad"]) {
      expect(r[campo]).toBeUndefined();
    }
  });
});

describe("la misma rueda fotografiada dos veces", () => {
  it("se detecta el número repetido", () => {
    const rep = seriesRepetidas(["AAA111", "BBB222", "AAA111"]);
    expect(rep).toEqual([claveSerie("AAA111")]);
    expect(esRepetida("AAA111", rep)).toBe(true);
    expect(esRepetida("BBB222", rep)).toBe(false);
  });
  it("con guiones de por medio también: es la misma rueda", () => {
    expect(seriesRepetidas(["123-456", "123456"]).length).toBe(1);
  });
  it("las fotos sin número no cuentan como repetidas entre sí", () => {
    expect(seriesRepetidas([null, null, "", "  "])).toEqual([]);
    expect(esRepetida(null, [])).toBe(false);
  });
  it("un lote entero sin repeticiones no marca nada", () => {
    const series = Array.from({ length: 12 }, (_, i) => `SER${i}`);
    expect(seriesRepetidas(series)).toEqual([]);
  });
});
