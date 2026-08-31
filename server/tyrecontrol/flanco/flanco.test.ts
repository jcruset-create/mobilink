import { describe, it, expect } from "vitest";
import {
  valorFiable, normalizarMedida, normalizarNombre, normalizarDot,
  prepararPropuesta, buscarEnCatalogo, CONFIANZA_MINIMA,
  type LecturaFlanco, type ReferenciaCatalogo,
} from "./flanco.ts";

const c = (valor: string | null, confianza: number | null = 0.95) => ({ valor, confianza });
const lectura = (over: Partial<LecturaFlanco> = {}): LecturaFlanco => ({
  marca: c("Michelin"), modelo: c("X Multi D"), medida: c("315/80R22.5"),
  indice_carga_simple: c("156"), indice_carga_doble: c("150"), codigo_velocidad: c("L"),
  dot: c("2325"), otros_textos: [], ...over,
});

describe("qué se considera legible", () => {
  it("descarta lo que el modelo no ve claro", () => {
    expect(valorFiable(c("156", 0.4))).toBeNull();
    expect(valorFiable(c("156", 0.95))).toBe("156");
  });
  it("acepta cuando no declara confianza: no siempre la da y descartar tiraría lecturas buenas", () => {
    expect(valorFiable(c("156", null))).toBe("156");
  });
  it("un valor vacío es vacío por muy seguro que esté", () => {
    expect(valorFiable(c("   ", 1))).toBeNull();
    expect(valorFiable(c(null, 1))).toBeNull();
  });
  it("el umbral es inclusivo: justo en el límite pasa", () => {
    expect(valorFiable(c("156", CONFIANZA_MINIMA))).toBe("156");
  });
});

describe("normalizar", () => {
  it("la misma medida escrita de varias maneras es la misma", () => {
    const formas = ["315/80R22.5", "315/80 R22.5", "315/80 R 22.5", " 315/80r22.5 "];
    const n = formas.map(normalizarMedida);
    expect(new Set(n).size).toBe(1);
    expect(n[0]).toBe("315/80R22.5");
  });
  it("en marcas y modelos el guion y el espacio no cuentan", () => {
    expect(normalizarNombre("X-Multi D")).toBe(normalizarNombre("x multi d"));
    expect(normalizarNombre("MICHELIN")).toBe(normalizarNombre(" michelin "));
  });
});

describe("el DOT", () => {
  it("coge los cuatro últimos dígitos, que es donde va", () => {
    expect(normalizarDot("DOT B9 YR HXXX 2325")).toBe("2325");
    expect(normalizarDot("2325")).toBe("2325");
  });
  it("no da por DOT un número de cuatro cifras con semana imposible", () => {
    // 6323 seria la semana 63: no existe. Es otro texto del flanco.
    expect(normalizarDot("6323")).toBeNull();
    expect(normalizarDot("0023")).toBeNull();
  });
  it("sin dígitos, ninguno: no se inventa", () => {
    expect(normalizarDot("ILEGIBLE")).toBeNull();
    expect(normalizarDot(null)).toBeNull();
  });
});

describe("la propuesta que ve el técnico", () => {
  it("no rellena huecos: lo dudoso se deja vacío y se dice", () => {
    const p = prepararPropuesta(lectura({ indice_carga_simple: c("156", 0.2) }));
    expect(p.indice_carga_simple).toBeNull();
    expect(p.dudosos).toContain("indice_carga_simple");
  });
  it("un campo que el flanco no llevaba NO sale como dudoso", () => {
    // Distinguirlo importa: dudoso = habia algo y no se leyo; vacio = no habia.
    const p = prepararPropuesta(lectura({ indice_carga_doble: c(null) }));
    expect(p.dudosos).not.toContain("indice_carga_doble");
    expect(p.indice_carga_doble).toBeNull();
  });
  it("normaliza la medida y pone en mayúsculas los índices", () => {
    const p = prepararPropuesta(lectura({ medida: c("315/80 r 22.5"), codigo_velocidad: c("l") }));
    expect(p.medida).toBe("315/80R22.5");
    expect(p.codigo_velocidad).toBe("L");
  });
  it("con marca y medida ya se puede buscar; sin ellas no", () => {
    expect(prepararPropuesta(lectura()).suficienteParaBuscar).toBe(true);
    expect(prepararPropuesta(lectura({ marca: c(null) })).suficienteParaBuscar).toBe(false);
    expect(prepararPropuesta(lectura({ medida: c("315/80R22.5", 0.1) })).suficienteParaBuscar).toBe(false);
  });
  it("si no hay lectura, se dice, y el técnico sigue a mano", () => {
    const p = prepararPropuesta(null);
    expect(p.suficienteParaBuscar).toBe(false);
    expect(p.aviso).toBeTruthy();
  });
});

const CATALOGO: ReferenciaCatalogo[] = [
  { id: "1", marca: "Michelin", modelo: "X Multi D", medida: "315/80R22.5", referencia_completa: "Michelin X Multi D 315/80R22.5" },
  { id: "2", marca: "Michelin", modelo: "X Multi Z", medida: "315/80R22.5", referencia_completa: "Michelin X Multi Z 315/80R22.5" },
  { id: "3", marca: "Michelin", modelo: "X Multi D", medida: "295/80R22.5", referencia_completa: "Michelin X Multi D 295/80R22.5" },
  { id: "4", marca: "Bridgestone", modelo: "R297", medida: "315/80R22.5", referencia_completa: "Bridgestone R297 315/80R22.5" },
];

describe("buscar en el catálogo", () => {
  it("la exacta va primera, y detrás la misma medida con otro modelo", () => {
    const r = buscarEnCatalogo(prepararPropuesta(lectura()), CATALOGO);
    expect(r[0].tipo).toBe("exacta");
    expect(r[0].referencia.id).toBe("1");
    expect(r[1].tipo).toBe("medida");
    expect(r[1].referencia.id).toBe("2");
    // Ni la otra medida ni la otra marca.
    expect(r.map((x) => x.referencia.id)).not.toContain("3");
    expect(r.map((x) => x.referencia.id)).not.toContain("4");
  });
  it("una exacta no sale además como candidata: no se repite", () => {
    const r = buscarEnCatalogo(prepararPropuesta(lectura()), CATALOGO);
    expect(r.filter((x) => x.referencia.id === "1")).toHaveLength(1);
  });
  it("sin modelo legible enseña todo lo de esa marca y medida, para elegir", () => {
    const r = buscarEnCatalogo(prepararPropuesta(lectura({ modelo: c(null) })), CATALOGO);
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.tipo === "medida")).toBe(true);
  });
  it("la grafía no impide encontrarla", () => {
    const r = buscarEnCatalogo(prepararPropuesta(lectura({ marca: c("MICHELIN"), modelo: c("x-multi-d"), medida: c("315/80 R22.5") })), CATALOGO);
    expect(r[0].referencia.id).toBe("1");
  });
  it("sin datos suficientes no propone nada en vez de proponer cualquier cosa", () => {
    expect(buscarEnCatalogo(prepararPropuesta(lectura({ marca: c(null) })), CATALOGO)).toEqual([]);
  });
  it("una marca que no está en el catálogo no casa con ninguna parecida", () => {
    const r = buscarEnCatalogo(prepararPropuesta(lectura({ marca: c("Michelan") })), CATALOGO);
    expect(r).toEqual([]);
  });
});
