import { describe, expect, it } from "vitest";
import type { AlbaranAnalizado, LineaAlbaran, ValidacionAnalisis } from "../types";
import {
  celdasFlojas,
  esHistorico,
  estadoParaPantalla,
  peorEstado,
  sumaDeLineas,
  tituloAnalisis,
} from "./analisis";

const linea = (extra: Partial<LineaAlbaran> = {}): LineaAlbaran => ({
  id: "l1",
  numeroLinea: 1,
  referencia: "990001",
  descripcion: "UNO",
  cantidad: 1,
  precioUnitarioCentimos: 1000,
  importeCentimos: 1000,
  descuentos: [],
  descuentosRaw: "",
  confianza: { referencia: 1, descripcion: 1, cantidad: 1, precio: 1, importe: 1, descuentos: 1 },
  cuadraAritmetica: true,
  rawText: "",
  pagina: 1,
  bbox: null,
  ...extra,
});

describe("el encabezado cambia según lo que se pida hacer", () => {
  it("GRABAR anuncia que eso es lo que se va a teclear", () => {
    expect(tituloAnalisis("GRABAR")).toContain("entrada manual");
  });

  it("MODIFICAR anuncia que es el papel contra el que comparar", () => {
    expect(tituloAnalisis("MODIFICAR")).toContain("modificación");
  });

  it("lo demás tiene un título neutro, no el de grabar", () => {
    expect(tituloAnalisis("REVISAR")).toBe("Albarán estructurado");
  });
});

describe("la suma se recalcula y no se hereda", () => {
  it("suma las líneas", () => {
    expect(sumaDeLineas([linea(), linea({ id: "l2", importeCentimos: 2500 })])).toBe(3500);
  });

  it("si a una le falta el importe, no hay total", () => {
    expect(sumaDeLineas([linea(), linea({ id: "l2", importeCentimos: null })])).toBeNull();
  });

  it("sin líneas no hay total", () => {
    expect(sumaDeLineas([])).toBeNull();
  });
});

describe("celdas flojas", () => {
  it("una celda vacía y una dudosa NO son lo mismo", () => {
    const r = celdasFlojas(
      [
        linea({ referencia: null, confianza: { ...linea().confianza, referencia: 0.3 } }),
        linea({ id: "l2", confianza: { ...linea().confianza, precio: 0.5 } }),
      ],
      0.85
    );
    expect(r.vacias).toBe(1);
    expect(r.dudosas).toBe(1);
  });

  it("con todo leído y confiado no hay nada que marcar", () => {
    expect(celdasFlojas([linea()], 0.85)).toEqual({ dudosas: 0, vacias: 0 });
  });
});

describe("el estado general", () => {
  const v = (estado: ValidacionAnalisis["estado"]): ValidacionAnalisis => ({
    id: estado,
    tipo: "LINEAS",
    estado,
    mensaje: "",
    valorEsperado: null,
    valorObtenido: null,
    metadata: {},
  });

  it("es el PEOR, no la media", () => {
    expect(peorEstado([v("OK"), v("OK"), v("ERROR")])).toBe("ERROR");
    expect(peorEstado([v("OK"), v("REVISAR")])).toBe("REVISAR");
    expect(peorEstado([])).toBe("OK");
  });

  it("mientras está en cola se dice eso y no «0 líneas»", () => {
    const a = { estadoProceso: "PENDIENTE", estadoAnalisis: null } as AlbaranAnalizado;
    expect(estadoParaPantalla(a)).toEqual({ estado: "PENDIENTE", enCurso: true });
  });

  it("terminado, manda el estado del análisis", () => {
    const a = { estadoProceso: "COMPLETADO", estadoAnalisis: "REVISAR" } as AlbaranAnalizado;
    expect(estadoParaPantalla(a)).toEqual({ estado: "REVISAR", enCurso: false });
  });
});

describe("los reanálisis anteriores", () => {
  it("se reconocen por llevar a quién los sustituyó", () => {
    expect(esHistorico({ metadata: { sustituidaPor: "x" } } as AlbaranAnalizado)).toBe(true);
    expect(esHistorico({ metadata: {} } as AlbaranAnalizado)).toBe(false);
  });
});
