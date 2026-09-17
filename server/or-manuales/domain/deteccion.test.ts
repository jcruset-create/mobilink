/**
 * La detección del número de OR, probada con páginas escritas a mano.
 *
 * Interesa sobre todo lo que NO debe pasar: que una fecha o una matrícula se
 * cuelen como número de OR, que dos candidatos empatados se archiven a ciegas,
 * o que un número perfectamente legible que no cae en ningún bloc se dé por
 * bueno. Archivar en la OR equivocada es el peor fallo posible del módulo.
 */

import { describe, expect, it } from "vitest";
import { decidir, detectarNumeroOr, zonaValida, ZONA_POR_DEFECTO, type PaginaAnalizable } from "./deteccion.ts";

const UMBRALES = { automatico: 90, revision: 70 };

/** Una hoja A4 en puntos, con las líneas que se le digan. */
function pagina(lineas: { texto: string; x: number; y: number }[]): PaginaAnalizable {
  return {
    numero: 1,
    ancho: 595,
    alto: 842,
    lineas: lineas.map((l) => ({ ...l, w: 120, h: 14 })),
  };
}

/** Arriba a la derecha, dentro de la zona por defecto. */
const ARRIBA_DERECHA = { x: 420, y: 40 };
/** El cuerpo del parte, fuera de la zona. */
const CUERPO = { x: 60, y: 400 };

const blocDelTaller = (n: number) => n >= 1026 && n <= 1050;

describe("La zona de OCR", () => {
  it("la de por defecto es válida", () => {
    expect(zonaValida(ZONA_POR_DEFECTO)).toBe(true);
  });

  it("rechaza una zona que se sale de la página o no ocupa nada", () => {
    expect(zonaValida({ x: 0.8, y: 0, ancho: 0.5, alto: 0.2 })).toBe(false);
    expect(zonaValida({ x: 0, y: 0, ancho: 0, alto: 0.2 })).toBe(false);
    expect(zonaValida({ x: -0.1, y: 0, ancho: 0.5, alto: 0.2 })).toBe(false);
  });
});

describe("Encontrar el número", () => {
  it("lee el número con rótulo en la zona y se fía del todo", () => {
    const d = detectarNumeroOr(pagina([{ texto: "OR Nº 1043", ...ARRIBA_DERECHA }]), {
      dentroDeAlgunBloc: blocDelTaller,
    });
    expect(d.candidato?.numero).toBe(1043);
    expect(d.candidato?.enZona).toBe(true);
    expect(d.candidato?.conRotulo).toBe(true);
    expect(d.candidato?.enBloc).toBe(true);
    expect(d.candidato?.confianza).toBe(100);
    expect(d.candidato?.metodo).toBe("TEXTO_ZONA");
    expect(decidir(d.candidato, UMBRALES)).toBe("ARCHIVAR");
  });

  it("entiende las formas de escribir el rótulo que salen de un teclado", () => {
    for (const rotulo of ["OR Nº", "O.R.", "Orden", "N.", "Nº", "NUM.", "Número"]) {
      const d = detectarNumeroOr(pagina([{ texto: `${rotulo} 1043`, ...ARRIBA_DERECHA }]), {
        dentroDeAlgunBloc: blocDelTaller,
      });
      expect(d.candidato?.conRotulo, rotulo).toBe(true);
    }
  });

  it("no confunde la fecha ni la matrícula con la OR", () => {
    const d = detectarNumeroOr(
      pagina([
        { texto: "OR Nº 1043", ...ARRIBA_DERECHA },
        { texto: "Matrícula 1234 ABC   Fecha 15/09/2026", ...CUERPO },
      ]),
      { dentroDeAlgunBloc: blocDelTaller }
    );
    expect(d.candidato?.numero).toBe(1043);
    // El 2026 es un año y ni siquiera compite.
    expect(d.otros.map((o) => o.numero)).not.toContain(2026);
  });

  it("un número suelto fuera de la zona y sin rótulo se queda muy abajo", () => {
    const d = detectarNumeroOr(pagina([{ texto: "referencia 4471", ...CUERPO }]), {
      dentroDeAlgunBloc: () => false,
    });
    expect(d.candidato?.confianza).toBeLessThan(UMBRALES.revision);
    expect(decidir(d.candidato, UMBRALES)).toBe("NO_IDENTIFICADO");
  });

  it("dos números igualmente plausibles NO se archivan a ciegas", () => {
    // Los dos en la zona, los dos con rótulo, los dos dentro del bloc: una
    // moneda al aire. Se rebaja para que lo mire una persona.
    const d = detectarNumeroOr(
      pagina([
        { texto: "OR Nº 1043", x: 420, y: 40 },
        { texto: "OR Nº 1044", x: 420, y: 60 },
      ]),
      { dentroDeAlgunBloc: blocDelTaller }
    );
    expect(d.candidato?.confianza).toBeLessThan(UMBRALES.automatico);
    expect(decidir(d.candidato, UMBRALES)).not.toBe("ARCHIVAR");
  });

  it("no inventa nada si la página no trae números", () => {
    const d = detectarNumeroOr(pagina([{ texto: "Orden de reparación manual", ...ARRIBA_DERECHA }]), {});
    expect(d.candidato).toBeNull();
    expect(decidir(d.candidato, UMBRALES)).toBe("NO_IDENTIFICADO");
  });

  it("el mismo número repetido es UN candidato con más motivos, no dos", () => {
    const d = detectarNumeroOr(
      pagina([
        { texto: "1043", ...ARRIBA_DERECHA },
        { texto: "OR Nº 1043", ...CUERPO },
      ]),
      { dentroDeAlgunBloc: blocDelTaller }
    );
    expect(d.otros).toHaveLength(0);
    expect(d.candidato?.enZona).toBe(true);
    expect(d.candidato?.conRotulo).toBe(true);
  });

  it("leer de una imagen vale menos que leer del PDF", () => {
    const linea = [{ texto: "OR Nº 1043", ...ARRIBA_DERECHA }];
    const texto = detectarNumeroOr(pagina(linea), { dentroDeAlgunBloc: blocDelTaller, origen: "texto" });
    const ocr = detectarNumeroOr(pagina(linea), { dentroDeAlgunBloc: blocDelTaller, origen: "ocr" });
    expect(ocr.candidato!.confianza).toBeLessThan(texto.candidato!.confianza);
    expect(ocr.candidato!.metodo).toBe("OCR_ZONA");
  });

  it("una lectura de imagen buena pero no perfecta cae en la banda de revisión", () => {
    // En la zona, en un bloc, único, pero sin rótulo y leído por OCR.
    const d = detectarNumeroOr(pagina([{ texto: "1043", ...ARRIBA_DERECHA }]), {
      dentroDeAlgunBloc: blocDelTaller,
      origen: "ocr",
    });
    expect(decidir(d.candidato, UMBRALES)).toBe("REVISAR");
  });
});

describe("Qué hacer con lo leído", () => {
  const candidato = (confianza: number, enBloc = true) => ({
    numero: 1043,
    confianza,
    metodo: "TEXTO_ZONA" as const,
    texto: "OR Nº 1043",
    enZona: true,
    conRotulo: true,
    enBloc,
  });

  it("aplica los umbrales del encargo", () => {
    expect(decidir(candidato(95), UMBRALES)).toBe("ARCHIVAR");
    expect(decidir(candidato(90), UMBRALES)).toBe("ARCHIVAR");
    expect(decidir(candidato(89), UMBRALES)).toBe("REVISAR");
    expect(decidir(candidato(70), UMBRALES)).toBe("REVISAR");
    expect(decidir(candidato(69), UMBRALES)).toBe("NO_IDENTIFICADO");
  });

  it("los umbrales se pueden apretar sin tocar la detección", () => {
    expect(decidir(candidato(92), { automatico: 95, revision: 80 })).toBe("REVISAR");
  });

  it("un número que no cae en ningún bloc NO se archiva por muy claro que se lea", () => {
    expect(decidir(candidato(100, false), UMBRALES)).toBe("NO_IDENTIFICADO");
  });

  it("sin candidato, a la bandeja", () => {
    expect(decidir(null, UMBRALES)).toBe("NO_IDENTIFICADO");
  });
});
