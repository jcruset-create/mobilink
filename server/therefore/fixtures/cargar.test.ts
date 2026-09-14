import { describe, expect, it } from "vitest";
import { descuadreDeLinea, sumaDeLineas, validarCaso } from "./cargar.ts";
import type { CasoCalibracion, LineaEsperada } from "./tipos.ts";

const linea = (sobre: Partial<LineaEsperada> = {}): LineaEsperada => ({
  referencia: "REF-1",
  descripcion: "ARTÍCULO",
  cantidad: 1,
  precioUnitarioCentimos: 10000,
  descuentos: [],
  importeCentimos: 10000,
  ...sobre,
});

/** Un caso mínimo que valida: se parte de aquí para romperlo a propósito. */
function caso(sobre: Partial<CasoCalibracion> = {}): CasoCalibracion {
  return {
    id: "caso-00-minimo",
    descripcion: "Un albarán con una línea.",
    origen: "sintetico",
    correo: {
      asunto: "Incidencia en factura recibida",
      de: "therefore@example.invalid",
      para: "buzon@example.invalid",
      fecha: "2026-09-02T10:14:00.000Z",
      texto: "Incidencia en factura recibida.\nEmpresa 000 Ejemplo",
      informacionAdicional: "Grabar\n111111",
      messageId: "<uno@example.invalid>",
    },
    adjuntos: [],
    esperado: {
      correo: {
        categoria: "INCIDENCIA_ALBARAN",
        empresaCodigo: "000",
        proveedorCodigo: null,
        proveedorNombre: null,
        cuentaContable: null,
        facturaNumero: null,
        facturaFecha: null,
        importeCentimos: null,
        urgente: false,
        persona: null,
        actuaciones: [{ accion: "GRABAR", albaran: "111111", importeCentimos: 10000 }],
      },
      albaranes: [
        {
          albaranSolicitado: "111111",
          numeroEnDocumento: "111111",
          resultadoMatch: "MATCH",
          lineas: [linea()],
          sumaLineasCentimos: 10000,
          diferenciaCentimos: 0,
          estadoAnalisis: "OK",
        },
      ],
    },
    ...sobre,
  };
}

const problemasEn = (c: CasoCalibracion, donde: string) =>
  validarCaso(c).filter((p) => p.donde.includes(donde));

describe("suma de líneas", () => {
  it("suma en céntimos", () => {
    expect(sumaDeLineas([linea({ importeCentimos: 2790 }), linea({ importeCentimos: 18600 })])).toBe(
      21390
    );
  });

  it("si falta un importe no se inventa un total", () => {
    expect(sumaDeLineas([linea(), linea({ importeCentimos: null })])).toBeNull();
  });
});

describe("aritmética de una línea", () => {
  /*
   * El caso del encargo: 77,50 con 60 % + 10 % da 29,196, que redondea a
   * 27,90. Es lo que permite corroborar cinco campos entre sí en vez de
   * creerse cada uno por separado.
   */
  it("aplica los descuentos encadenados en orden y cuadra", () => {
    const l = linea({
      cantidad: 1,
      precioUnitarioCentimos: 7750,
      descuentos: [
        { orden: 1, porcentaje: 60, raw: "60%" },
        { orden: 2, porcentaje: 10, raw: "10%" },
      ],
      importeCentimos: 2790,
    });
    expect(descuadreDeLinea(l)).toBe(0);
  });

  it("un descuento único también", () => {
    const l = linea({
      cantidad: 2,
      precioUnitarioCentimos: 15500,
      descuentos: [{ orden: 1, porcentaje: 40, raw: "40%" }],
      importeCentimos: 18600,
    });
    expect(descuadreDeLinea(l)).toBe(0);
  });

  /*
   * OJO con esto, porque es contraintuitivo y estuvo a punto de colarse como
   * una prueba que afirmaba lo contrario:
   *
   *   60 % + 10 % encadenados  ==  un 64 % único
   *
   * 0,4 × 0,9 = 0,36 = 1 − 0,64. La aritmética es IDÉNTICA, así que el motivo
   * para conservar los descuentos por separado NO es que salga otro importe.
   * Es que:
   *
   *   · el ERP los pide como están impresos, en dos casillas;
   *   · lo pactado con el proveedor es «60 y 10», no «64», y así es como se
   *     comprueba contra el acuerdo;
   *   · el documento dice una cosa y guardar otra es perder el original.
   *
   * Por eso el validador comprueba el ORDEN de los descuentos y no se
   * conforma con que la línea cuadre: cuadrar, cuadra igual.
   */
  it("encadenar dos descuentos da el mismo importe que el equivalente único", () => {
    const encadenados = linea({
      cantidad: 1,
      precioUnitarioCentimos: 7750,
      descuentos: [
        { orden: 1, porcentaje: 60, raw: "60%" },
        { orden: 2, porcentaje: 10, raw: "10%" },
      ],
      importeCentimos: 2790,
    });
    const unico = linea({
      cantidad: 1,
      precioUnitarioCentimos: 7750,
      descuentos: [{ orden: 1, porcentaje: 64, raw: "64%" }],
      importeCentimos: 2790,
    });
    expect(descuadreDeLinea(encadenados)).toBe(0);
    expect(descuadreDeLinea(unico)).toBe(0);
  });

  it("sin datos suficientes no se calcula nada", () => {
    expect(descuadreDeLinea(linea({ precioUnitarioCentimos: null }))).toBeNull();
  });
});

describe("validar un caso", () => {
  it("el caso mínimo está bien", () => {
    expect(validarCaso(caso())).toEqual([]);
  });

  it("exige el bloque de Información Adicional", () => {
    const c = caso();
    c.correo.informacionAdicional = "";
    expect(problemasEn(c, "informacionAdicional")).toHaveLength(1);
  });

  it("exige Message-ID, que es lo que prueba la idempotencia", () => {
    const c = caso();
    c.correo.messageId = "";
    expect(problemasEn(c, "messageId")).toHaveLength(1);
  });

  /*
   * El fallo caro: un caso que parece bueno y no comprueba nada. Un albarán
   * que se espera encontrar sin líneas pasaría aunque el parser no extrajera
   * ninguna.
   */
  it("un albarán que se espera encontrar sin líneas no vale", () => {
    const c = caso();
    c.esperado.albaranes[0].lineas = [];
    expect(problemasEn(c, "lineas")).toHaveLength(1);
  });

  it("un albarán que se espera NO encontrar sí puede ir sin líneas", () => {
    const c = caso();
    c.esperado.albaranes[0] = {
      albaranSolicitado: "999999",
      numeroEnDocumento: null,
      resultadoMatch: "NO_MATCH",
      lineas: [],
      sumaLineasCentimos: null,
      diferenciaCentimos: null,
      estadoAnalisis: "ERROR",
      validacionesNoConformes: [
        { tipo: "ALBARAN_MATCH", estado: "ERROR", porque: "no está en el documento" },
      ],
    };
    expect(validarCaso(c)).toEqual([]);
  });

  it("caza una suma mal escrita a mano", () => {
    const c = caso();
    c.esperado.albaranes[0].sumaLineasCentimos = 9999;
    const p = problemasEn(c, "sumaLineasCentimos");
    expect(p).toHaveLength(1);
    expect(p[0].mensaje).toContain("10000");
  });

  it("caza una diferencia mal escrita a mano", () => {
    const c = caso();
    c.esperado.albaranes[0].diferenciaCentimos = 500;
    expect(problemasEn(c, "diferenciaCentimos")).toHaveLength(1);
  });

  /*
   * «REVISAR» sin decir por qué es un comodín: el caso pasaría aunque el
   * parser lo mandara a revisión por un motivo equivocado.
   */
  it("esperar REVISAR obliga a decir qué validación falla", () => {
    const c = caso();
    c.esperado.albaranes[0].estadoAnalisis = "REVISAR";
    expect(problemasEn(c, "validacionesNoConformes")).toHaveLength(1);

    c.esperado.albaranes[0].validacionesNoConformes = [
      { tipo: "IMPORTE", estado: "REVISAR", porque: "la suma no cuadra con la incidencia" },
    ];
    expect(problemasEn(c, "validacionesNoConformes")).toHaveLength(0);
  });

  it("los descuentos tienen que ir numerados en orden", () => {
    const c = caso();
    c.esperado.albaranes[0].lineas[0].descuentos = [
      { orden: 2, porcentaje: 10, raw: "10%" },
      { orden: 1, porcentaje: 60, raw: "60%" },
    ];
    expect(problemasEn(c, "descuentos")).toHaveLength(1);
  });

  it("un adjunto declarado que no existe se detecta", () => {
    const c = caso();
    c.adjuntos = [{ fichero: "no-esta.pdf", mimeType: "application/pdf", nombreOriginal: "f.pdf" }];
    expect(validarCaso(c, "/tmp/no-existe-esta-carpeta").some((p) => p.donde.includes("no-esta.pdf"))).toBe(
      true
    );
  });
});
