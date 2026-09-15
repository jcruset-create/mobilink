/**
 * El análisis de punta a punta, sobre PDF de verdad.
 *
 * Las pruebas del dominio montan las páginas a mano y comprueban la mecánica.
 * Éstas generan el PDF, lo abren con mupdf y comprueban que lo que sale del
 * papel es lo que había escrito. Hacen falta las dos: entre un objeto escrito a
 * mano y un PDF hay una capa —agrupar caracteres en palabras y palabras en
 * filas— donde caben sus propios fallos, y es justo la capa que no se ve.
 *
 * Todos los valores son inventados y se escriben aquí mismo. El caso de
 * referencia reproduce la ARITMÉTICA del ejemplo del encargo (una línea con
 * 60 % y 10 % encadenados) con números propios, y la suma se calcula en la
 * prueba en vez de copiarse: un total escrito a mano que nadie recalcula acaba
 * siendo el total de otra versión del fixture.
 */

import { describe, expect, it } from "vitest";
import { pdfDeFactura, pdfEscaneado, type LineaFixture } from "../fixtures/albaranPdf.ts";
import { analizarAlbaran, analizarCabecera, albaranesDelDocumento } from "../domain/documento/index.ts";
import { peorEstado, validarAnalisis } from "../domain/validaciones.ts";
import { DocumentoIlegible, esEscaneado, leerDocumento } from "./texto.ts";

/** Las cuatro líneas del caso de referencia. Aritmética comprobada abajo. */
const LINEAS_REFERENCIA: LineaFixture[] = [
  { ref: "4400111222333", desc: "PASTILLA FRENO DELT", cant: "1,00", precio: "77,50", dto: "60% + 10%", importe: "27,90" },
  { ref: "4400111222444", desc: "DISCO FRENO TRAS", cant: "2,00", precio: "155,00", dto: "40%", importe: "186,00" },
  { ref: "4400111222555", desc: "PASTILLA FRENO TRAS", cant: "1,00", precio: "88,60", dto: "60% + 10%", importe: "31,90" },
  { ref: "4400111222666", desc: "LIQUIDO DE FRENOS", cant: "4,00", precio: "22,00", dto: "28%", importe: "63,36" },
];

const SUMA_REFERENCIA = 2790 + 18600 + 3190 + 6336;

describe("leer el PDF", () => {
  it("un documento vacío o ilegible se rechaza con un mensaje para la pantalla", () => {
    expect(() => leerDocumento(Buffer.alloc(0))).toThrow(DocumentoIlegible);
    expect(() => leerDocumento(Buffer.from("esto no es un pdf"))).toThrow(DocumentoIlegible);
  });

  it("un PDF con más páginas de las permitidas se rechaza diciendo cuántas", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [{ numero: "0501234", lineas: LINEAS_REFERENCIA, partirTras: 1 }],
    });
    expect(() => leerDocumento(pdf, { maxPaginas: 0 })).toThrow(/páginas/);
  });

  it("una página sin texto se reconoce como escaneada y NO se degrada un PDF digital", async () => {
    expect(esEscaneado(leerDocumento(await pdfEscaneado()))).toBe(true);
    const digital = leerDocumento(
      await pdfDeFactura({ albaranes: [{ numero: "0501234", lineas: LINEAS_REFERENCIA }] })
    );
    expect(esEscaneado(digital)).toBe(false);
  });

  it("las palabras salen separadas y con su posición, no pegadas entre filas", async () => {
    const doc = leerDocumento(
      await pdfDeFactura({ albaranes: [{ numero: "0501234", lineas: [LINEAS_REFERENCIA[0]] }] })
    );
    const fila = doc.paginas[0].lineas.find((l) => l.texto.includes("4400111222333"));
    expect(fila).toBeDefined();
    expect(fila!.palabras.map((p) => p.texto)).toContain("77,50");
    // Cada palabra en su columna: la referencia a la izquierda del importe.
    const ref = fila!.palabras.find((p) => p.texto === "4400111222333")!;
    const imp = fila!.palabras.find((p) => p.texto === "27,90")!;
    expect(ref.x).toBeLessThan(imp.x);
  });
});

describe("analizar un albarán de un PDF", () => {
  it("el caso de referencia: cuatro líneas, todas cuadran, y la suma sale sola", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [
        {
          numero: "ENT-770199-0501234",
          lineas: LINEAS_REFERENCIA,
          matricula: "4417KDT",
          bastidor: "WZ10A2BCDEF345678",
          observaciones: "ENTREGAR EN EL MUELLE",
        },
      ],
      totales: { base: "309,16", iva: "64,92", total: "374,08" },
    });

    const a = analizarAlbaran(leerDocumento(pdf), "0501234");
    expect(a.resultadoMatch).toBe("MATCH");
    expect(a.numeroDocumento).toBe("ENT-770199-0501234");
    expect(a.lineas).toHaveLength(4);
    expect(a.lineas.every((l) => l.cuadraAritmetica)).toBe(true);
    expect(a.sumaLineasCentimos).toBe(SUMA_REFERENCIA);

    // Los descuentos encadenados llegan como dos, con lo impreso intacto.
    expect(a.lineas[0].descuentos.map((d) => d.raw)).toEqual(["60%", "10%"]);
    expect(a.lineas[0].descuentosRaw).toBe("60% + 10%");

    expect(a.complementarios.matricula).toBe("4417KDT");
    expect(a.complementarios.bastidor).toBe("WZ10A2BCDEF345678");
    expect(a.complementarios.observaciones).toBe("ENTREGAR EN EL MUELLE");

    // Cada línea sabe de dónde salió.
    expect(a.lineas[0].caja).not.toBeNull();
    expect(a.lineas[0].rawText).toContain("4400111222333");
  });

  it("con cinco albaranes, sólo se cogen las líneas del que se pide", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [1, 2, 3, 4, 5].map((n) => ({
        numero: `050123${n}`,
        lineas: [{ ref: `99000${n}`, desc: `ARTICULO ${n}`, cant: "1,00", precio: `${n}0,00`, dto: "-", importe: `${n}0,00` }],
      })),
      totales: { base: "150,00", total: "181,50" },
    });
    const doc = leerDocumento(pdf);

    expect(albaranesDelDocumento(doc)).toHaveLength(5);
    const a = analizarAlbaran(doc, "0501233");
    expect(a.lineas).toHaveLength(1);
    expect(a.lineas[0].referencia).toBe("990003");
    expect(a.sumaLineasCentimos).toBe(3000);

    const validaciones = validarAnalisis({ analisis: a, importeIncidenciaCentimos: 3000 });
    expect(peorEstado(validaciones)).toBe("OK");
    expect(validaciones.find((v) => v.tipo === "SEPARACION_ALBARANES")!.estado).toBe("OK");
  });

  it("un albarán partido entre dos páginas sigue siendo uno, con todas sus líneas", async () => {
    const pdf = await pdfDeFactura({
      conCabeceraYPie: true,
      albaranes: [{ numero: "0501234", lineas: LINEAS_REFERENCIA, partirTras: 2 }],
      totales: { base: "309,16", total: "374,08" },
    });
    const a = analizarAlbaran(leerDocumento(pdf), "0501234");
    expect(a.lineas).toHaveLength(4);
    expect(a.sumaLineasCentimos).toBe(SUMA_REFERENCIA);
    expect(a.paginaInicio).toBe(1);
    expect(a.paginaFin).toBe(2);
    expect(a.lineasRepetidasRetiradas).toBeGreaterThan(0);
  });

  it("dos albaranes que se diferencian en un dígito no se confunden", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [
        { numero: "0501234", lineas: [{ ref: "990001", desc: "UNO", cant: "1,00", precio: "10,00", dto: "-", importe: "10,00" }] },
        { numero: "0501235", lineas: [{ ref: "990002", desc: "DOS", cant: "1,00", precio: "20,00", dto: "-", importe: "20,00" }] },
      ],
      totales: { base: "30,00", total: "36,30" },
    });
    const doc = leerDocumento(pdf);
    expect(analizarAlbaran(doc, "0501234").sumaLineasCentimos).toBe(1000);
    expect(analizarAlbaran(doc, "0501235").sumaLineasCentimos).toBe(2000);

    // Y uno que no está no se lleva las líneas del parecido.
    const ausente = analizarAlbaran(doc, "0501236");
    expect(ausente.resultadoMatch).toBe("NO_MATCH");
    expect(ausente.parecidos.length).toBeGreaterThan(0);
    expect(ausente.lineas).toHaveLength(0);
  });

  it("un concepto global detrás de las líneas no es un artículo ni entra en la suma", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [{ numero: "0501234", lineas: [LINEAS_REFERENCIA[0]] }],
      conceptos: [{ etiqueta: "Portes", importe: "12,50" }],
      totales: { base: "40,40", total: "48,88" },
    });
    const a = analizarAlbaran(leerDocumento(pdf), "0501234");
    expect(a.lineas).toHaveLength(1);
    expect(a.sumaLineasCentimos).toBe(2790);
    expect(a.conceptos.map((c) => c.importeCentimos)).toEqual([1250]);
  });

  it("sin cabecera de columnas se lee por posición, y la validación lo dice", async () => {
    const pdf = await pdfDeFactura({
      sinCabeceraDeTabla: true,
      albaranes: [{ numero: "0501234", lineas: [LINEAS_REFERENCIA[1]] }],
      totales: { base: "186,00", total: "225,06" },
    });
    const a = analizarAlbaran(leerDocumento(pdf), "0501234");
    expect(a.modoTabla).toBe("POSICIONAL");
    expect(a.lineas).toHaveLength(1);
    expect(a.lineas[0].importeCentimos).toBe(18600);

    const v = validarAnalisis({ analisis: a, importeIncidenciaCentimos: 18600 });
    expect(v.find((x) => x.tipo === "LINEAS")!.estado).toBe("REVISAR");
  });

  it("la cabecera del documento sale con su número de factura y sus totales", async () => {
    const pdf = await pdfDeFactura({
      facturaNumero: "F-2026-0042",
      albaranes: [{ numero: "0501234", lineas: [LINEAS_REFERENCIA[0]] }],
      totales: { base: "27,90", iva: "5,86", total: "33,76" },
    });
    const { cabecera, parserUsado } = analizarCabecera(leerDocumento(pdf));
    expect(cabecera.numeroDocumento).toBe("F-2026-0042");
    expect(cabecera.totalCentimos).toBe(3376);
    expect(cabecera.baseCentimos).toBe(2790);
    expect(parserUsado).toBe("generico");
  });

  it("el descuadre con la incidencia sale con el mensaje que ve quien decide", async () => {
    const pdf = await pdfDeFactura({
      albaranes: [{ numero: "0501234", lineas: LINEAS_REFERENCIA }],
      totales: { base: "309,16", total: "374,08" },
    });
    const a = analizarAlbaran(leerDocumento(pdf), "0501234");
    const v = validarAnalisis({ analisis: a, importeIncidenciaCentimos: 19995 });
    const importe = v.find((x) => x.tipo === "IMPORTE")!;
    expect(importe.estado).toBe("REVISAR");
    expect(importe.metadata.diferencia).toBe(SUMA_REFERENCIA - 19995);
    expect(peorEstado(v)).toBe("REVISAR");
  });
});
