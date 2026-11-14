import { describe, expect, it } from "vitest";
import { comparar, marcado, normalizar, sinMarcado } from "./medidas.ts";
import { medidaCanonica } from "../../../shared/medidas.ts";

/**
 * Las 48 representaciones son las del fichero real del centro, contadas una a
 * una. No es una lista inventada para que pase la prueba: es lo que hay
 * escrito en las 1.744 intervenciones, y si alguna dejara de normalizarse,
 * mil cruces con el catálogo se volverían falsos negativos sin avisar.
 */
const REALES: Array<[string, string]> = [
  // 295/80R22.5 — catorce maneras de escribir lo mismo
  ["295/80R22.5", "295/80R22.5"], ["295/80 R22.5", "295/80R22.5"],
  ["295/80R22,5", "295/80R22.5"], ["295/80/R22.5", "295/80R22.5"],
  ["295.80R22.5", "295/80R22.5"], ["295-80R22.5", "295/80R22.5"],
  ["295 80R22.5", "295/80R22.5"], ["295.80 R22.5", "295/80R22.5"],
  ["295/80-22.5", "295/80R22.5"], ["29580R22.5", "295/80R22.5"],
  ["295/80/R22,5", "295/80R22.5"], ["295/80 R 22.5", "295/80R22.5"],
  ["295/80 R22,5", "295/80R22.5"], ["295/80 22.5", "295/80R22.5"],
  // 315/80R22.5
  ["315/80R22.5", "315/80R22.5"], ["315/80R22,5", "315/80R22.5"],
  ["315/80 R22.5", "315/80R22.5"], ["315/80R 22.5", "315/80R22.5"],
  ["315/80 R 22,5", "315/80R22.5"],
  // 275/70R22.5, incluida la que viene con barra invertida
  ["275/70R22.5", "275/70R22.5"], ["275/70R22,5", "275/70R22.5"],
  ["275\\70 R 22.5", "275/70R22.5"],
  // las de marcado C
  ["225/75R16C", "225/75R16C"], ["225/75 R16C", "225/75R16C"],
  ["205/75R16C", "205/75R16C"], ["195/75R16C", "195/75R16C"],
  ["195/75 R16C", "195/75R16C"], ["225/65R16C", "225/65R16C"],
  ["225/65 R16C", "225/65R16C"], ["215/75R16C", "215/75R16C"],
  // sin marcado
  ["205/75R16", "205/75R16"], ["225/75R16", "225/75R16"],
  ["225/75 R 16", "225/75R16"], ["195/75 R 16", "195/75R16"],
  ["215/75R16", "215/75R16"], ["225/75R17.5", "225/75R17.5"],
  ["235/75R17.5", "235/75R17.5"], ["235/75 R 17.5", "235/75R17.5"],
  ["245/70R17.5", "245/70R17.5"], ["255/70R22.5", "255/70R22.5"],
  ["255/70 R22.5", "255/70R22.5"], ["265/70R17.5", "265/70R17.5"],
  ["265/70R17,5", "265/70R17.5"], ["265/70R19.5", "265/70R19.5"],
  ["305/70R19.5", "305/70R19.5"], ["305/70 R 19.5", "305/70R19.5"],
  ["305/70 R19.5", "305/70R19.5"], ["315/70R22.5", "315/70R22.5"],
];

describe("normalizar · las 48 representaciones del fichero real", () => {
  it("las normaliza todas, ninguna se queda fuera", () => {
    const fallos = REALES.filter(([bruto]) => normalizar(bruto) === null);
    expect(fallos, `sin normalizar: ${JSON.stringify(fallos)}`).toEqual([]);
  });

  for (const [bruto, esperado] of REALES) {
    it(`${JSON.stringify(bruto)} → ${esperado}`, () => {
      expect(normalizar(bruto)).toBe(esperado);
    });
  }

  it("las 48 colapsan en 20 medidas", () => {
    expect(new Set(REALES.map(([b]) => normalizar(b))).size).toBe(20);
  });

  /**
   * La que impide un choque contra la base.
   *
   * `tc_cat_medidas_neumatico` tiene un disparador que pasa todo lo que entra
   * por `tc_medida_normalizada()`, y `valor` es único. Si lo que sale de aquí
   * no fuera ya la forma que produce ese disparador, dar de alta una medida
   * la reescribiría al guardarla y chocaría contra el unique — o peor, se
   * crearía una fila duplicada de la misma rueda.
   *
   * `medidaCanonica` es el gemelo en JavaScript de esa función de la base.
   */
  it("lo que sale ya es la forma canónica del proyecto: nada que reescribir", () => {
    for (const [bruto] of REALES) {
      const n = normalizar(bruto)!;
      expect(medidaCanonica(n), `${bruto} → ${n}`).toBe(n);
    }
  });
});

describe("normalizar · lo que no se reconoce", () => {
  it("devuelve null en vez de adivinar", () => {
    for (const malo of ["", "   ", "sin medida", "22.5", "295/80R", "R22.5",
                        "2950/80R22.5", "295/8R22.5", "295/80R222.5"]) {
      expect(normalizar(malo), `debería ser null: ${JSON.stringify(malo)}`).toBeNull();
    }
  });

  it("nulo y undefined no son un error", () => {
    expect(normalizar(null)).toBeNull();
    expect(normalizar(undefined)).toBeNull();
  });
});

/**
 * El criterio de «es la misma medida» es el del proyecto, no uno nuevo.
 * `baseMedida` ya se queda con ancho/perfil/llanta, y por eso la C no la
 * distingue: lo que añade este módulo es poder DECIR que la diferencia está
 * en el marcado, no un criterio distinto de igualdad.
 */
describe("el marcado", () => {
  it("se conserva al normalizar: es parte de la designación", () => {
    expect(normalizar("225/75 R16C")).toBe("225/75R16C");
  });

  it("se puede quitar y se puede leer", () => {
    expect(sinMarcado("225/75R16C")).toBe("225/75R16");
    expect(sinMarcado("295/80R22.5")).toBe("295/80R22.5");
    expect(marcado("225/75R16C")).toBe("C");
    expect(marcado("295/80R22.5")).toBeNull();
  });

  it("quitar el marcado no se come la R de radial", () => {
    expect(sinMarcado("295/80R22.5")).toBe("295/80R22.5");
  });
});

describe("comparar", () => {
  it("igual es igual", () => {
    expect(comparar("295/80R22.5", "295/80R22.5")).toBe("igual");
  });

  /**
   * El caso que decide 36 de las 55 discrepancias del fichero. Si esto
   * devolviera «distinta», la pantalla de propuestas se llenaría de avisos
   * que no son avisos; si devolviera «igual», se perdería que el dato del
   * tacógrafo dice C y el catálogo no.
   */
  it("solo el marcado C: se dice, no se esconde ni se denuncia", () => {
    expect(comparar("225/75R16C", "225/75R16")).toBe("solo_marcado");
    expect(comparar("225/75R16", "225/75R16C")).toBe("solo_marcado");
  });

  it("medidas de verdad distintas", () => {
    expect(comparar("295/80R22.5", "315/80R22.5")).toBe("distinta");
    expect(comparar("305/70R19.5", "305/70R22.5")).toBe("distinta");
  });

  it("sin una de las dos no se compara nada", () => {
    expect(comparar(null, "295/80R22.5")).toBe("desconocida");
    expect(comparar("295/80R22.5", null)).toBe("desconocida");
    expect(comparar(null, null)).toBe("desconocida");
  });
});
