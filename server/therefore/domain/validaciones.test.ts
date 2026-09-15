/**
 * Las validaciones, una a una.
 *
 * Lo que se comprueba aquí no es que el análisis sea correcto —de eso van las
 * pruebas del parser— sino que CUANDO ALGO ESTÁ MAL SE DICE, y se dice con el
 * motivo concreto. Es la diferencia entre una pantalla que manda revisar y una
 * pantalla que explica qué mirar.
 *
 * Y una regla que se prueba explícitamente: el estado general es el PEOR de
 * todos, no la media. Nueve OK y un ERROR es un ERROR.
 */

import { describe, expect, it } from "vitest";
import type { AnalisisAlbaran } from "./documento/index.ts";
import type { LineaArticulo } from "./documento/lineas.ts";
import type { SeccionAlbaran } from "./documento/secciones.ts";
import { MENSAJE_DESCUADRE, peorEstado, validacionDocumentoIlegible, validarAnalisis } from "./validaciones.ts";

const seccion = (extra: Partial<SeccionAlbaran> = {}): SeccionAlbaran => ({
  indice: 0,
  numeroDocumento: "0501234",
  lineas: [],
  paginaInicio: 1,
  paginaFin: 1,
  cajaInicio: null,
  finPor: "TOTALES",
  documentoEntero: false,
  vecinaAnterior: null,
  vecinaSiguiente: null,
  huerfanas: 0,
  ...extra,
});

const linea = (extra: Partial<LineaArticulo> = {}): LineaArticulo => ({
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
  rawText: "990001 UNO 1,00 10,00 10,00",
  pagina: 1,
  caja: null,
  ...extra,
});

const analisis = (extra: Partial<AnalisisAlbaran> = {}): AnalisisAlbaran => ({
  numeroSolicitado: "0501234",
  numeroDocumento: "0501234",
  numeroNormalizado: "501234",
  resultadoMatch: "MATCH",
  confianzaMatch: 1,
  motivoMatch: "El documento lo escribe igual: 0501234.",
  parecidos: [],
  seccion: seccion({ lineas: [] }),
  lineas: [linea()],
  conceptos: [],
  complementarios: { matricula: null, bastidor: null, fecha: null, observaciones: null, otros: {} },
  sumaLineasCentimos: 1000,
  paginaInicio: 1,
  paginaFin: 1,
  parserUsado: "generico",
  modoTabla: "CABECERA",
  filasDescartadas: 0,
  lineasRepetidasRetiradas: 0,
  ...extra,
});

const de = (vs: ReturnType<typeof validarAnalisis>, tipo: string) => vs.find((v) => v.tipo === tipo)!;

describe("validaciones del análisis", () => {
  it("todo en orden sale OK y el estado general también", () => {
    const vs = validarAnalisis({ analisis: analisis(), importeIncidenciaCentimos: 1000 });
    expect(peorEstado(vs)).toBe("OK");
    expect(de(vs, "ALBARAN_MATCH").estado).toBe("OK");
    expect(de(vs, "IMPORTE").estado).toBe("OK");
  });

  it("un albarán no encontrado es ERROR y corta: no se valida lo que no tiene dueño", () => {
    const vs = validarAnalisis({
      analisis: analisis({ resultadoMatch: "NO_MATCH", seccion: null, lineas: [], parecidos: ["0501235"] }),
      importeIncidenciaCentimos: 1000,
    });
    expect(de(vs, "ALBARAN_MATCH").estado).toBe("ERROR");
    expect(de(vs, "ALBARAN_MATCH").mensaje).toContain("Albarán no encontrado");
    // El parecido se dice, porque casi nunca es casualidad.
    expect(de(vs, "ALBARAN_MATCH").mensaje).toContain("0501235");
    expect(vs.some((v) => v.tipo === "LINEAS")).toBe(false);
    expect(peorEstado(vs)).toBe("ERROR");
  });

  it("un match dudoso es REVISAR, no ERROR: las líneas pueden servir", () => {
    const vs = validarAnalisis({
      analisis: analisis({ resultadoMatch: "UNCERTAIN", confianzaMatch: 0.85 }),
      importeIncidenciaCentimos: 1000,
    });
    expect(de(vs, "ALBARAN_MATCH").estado).toBe("REVISAR");
    expect(de(vs, "LINEAS").estado).toBe("OK");
  });

  it("una sección de documento entero avisa de que nadie separó nada", () => {
    const vs = validarAnalisis({
      analisis: analisis({ resultadoMatch: "UNCERTAIN", seccion: seccion({ documentoEntero: true, numeroDocumento: null }) }),
      importeIncidenciaCentimos: 1000,
    });
    expect(de(vs, "SEPARACION_ALBARANES").estado).toBe("REVISAR");
  });

  it("las líneas sueltas entre dos albaranes se cuentan y se enseñan", () => {
    const vs = validarAnalisis({
      analisis: analisis({ seccion: seccion({ huerfanas: 3, vecinaSiguiente: "0501235" }) }),
      importeIncidenciaCentimos: 1000,
    });
    expect(de(vs, "SEPARACION_ALBARANES").estado).toBe("REVISAR");
    expect(de(vs, "SEPARACION_ALBARANES").valorObtenido).toBe("3");
  });

  it("una línea que no cuadra manda a revisión diciendo cuál", () => {
    const vs = validarAnalisis({
      analisis: analisis({ lineas: [linea(), linea({ numeroLinea: 2, cuadraAritmetica: false })] }),
      importeIncidenciaCentimos: 2000,
    });
    expect(de(vs, "LINEAS").estado).toBe("REVISAR");
    expect(de(vs, "LINEAS").metadata.lineas).toEqual([2]);
  });

  it("una sección con texto pero sin líneas es REVISAR; vacía del todo, ERROR", () => {
    const conTexto = validarAnalisis({
      analisis: analisis({ lineas: [], sumaLineasCentimos: null, seccion: seccion({ lineas: [{} as never] }) }),
      importeIncidenciaCentimos: null,
    });
    expect(de(conTexto, "LINEAS").estado).toBe("REVISAR");

    const vacia = validarAnalisis({
      analisis: analisis({ lineas: [], sumaLineasCentimos: null, seccion: seccion({ lineas: [] }) }),
      importeIncidenciaCentimos: null,
    });
    expect(de(vacia, "LINEAS").estado).toBe("ERROR");
  });

  it("lo leído por la IA nunca sale OK sólo porque cuadre", () => {
    const vs = validarAnalisis({ analisis: analisis(), importeIncidenciaCentimos: 1000, origen: "PDF_IA" });
    expect(de(vs, "LINEAS").estado).toBe("REVISAR");
  });

  it("una celda de descuento con texto raro se dice, con la celda delante", () => {
    const vs = validarAnalisis({
      analisis: analisis({
        lineas: [linea({ descuentosRaw: "60% segun acuerdo", confianza: { ...linea().confianza, descuentos: 0.4 } })],
      }),
      importeIncidenciaCentimos: 1000,
    });
    expect(de(vs, "DESCUENTOS").estado).toBe("REVISAR");
    expect(de(vs, "DESCUENTOS").valorObtenido).toContain("acuerdo");
  });

  it("un campo crítico flojo o sin leer sale por su nombre", () => {
    const vs = validarAnalisis({
      analisis: analisis({
        lineas: [linea({ referencia: null, confianza: { ...linea().confianza, referencia: 0.3 } })],
      }),
      importeIncidenciaCentimos: 1000,
    });
    expect(de(vs, "CAMPOS_CRITICOS").estado).toBe("REVISAR");
    expect(de(vs, "CAMPOS_CRITICOS").valorObtenido).toContain("referencia");
  });

  it("el descuadre usa el mensaje literal y guarda la diferencia con su signo", () => {
    const vs = validarAnalisis({ analisis: analisis(), importeIncidenciaCentimos: 400 });
    expect(de(vs, "IMPORTE").estado).toBe("REVISAR");
    expect(de(vs, "IMPORTE").mensaje).toBe(MENSAJE_DESCUADRE);
    expect(de(vs, "IMPORTE").metadata.diferencia).toBe(600);
  });

  it("una diferencia de un céntimo es un redondeo, no un descuadre", () => {
    const vs = validarAnalisis({ analisis: analisis(), importeIncidenciaCentimos: 999 });
    expect(de(vs, "IMPORTE").estado).toBe("OK");
  });

  it("sin importe en la incidencia no hay nada que comparar, y eso no es un fallo", () => {
    const vs = validarAnalisis({ analisis: analisis(), importeIncidenciaCentimos: null });
    expect(de(vs, "IMPORTE").estado).toBe("OK");
  });

  it("el número de factura del correo y el del papel se comparan sin sobrescribir ninguno", () => {
    const vs = validarAnalisis({
      analisis: analisis(),
      importeIncidenciaCentimos: 1000,
      correo: { facturaNumero: "F-2026-0001", importeCentimos: 1000 },
      documento: { facturaNumero: "F 2026 0001", totalCentimos: 1210 },
    });
    expect(de(vs, "CORREO_VS_DOCUMENTO").estado).toBe("OK");

    const distintos = validarAnalisis({
      analisis: analisis(),
      importeIncidenciaCentimos: 1000,
      correo: { facturaNumero: "F-2026-0001", importeCentimos: 1000 },
      documento: { facturaNumero: "F-2026-0999", totalCentimos: 1210 },
    });
    expect(de(distintos, "CORREO_VS_DOCUMENTO").estado).toBe("REVISAR");
    expect(de(distintos, "CORREO_VS_DOCUMENTO").valorEsperado).toBe("F-2026-0001");
  });

  it("un documento que no se puede abrir es ERROR con el motivo dentro", () => {
    const v = validacionDocumentoIlegible("El documento pesa 20 MB y el máximo son 15 MB.");
    expect(v.estado).toBe("ERROR");
    expect(v.mensaje).toContain("20 MB");
  });
});
