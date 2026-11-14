import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { aFilaInsert } from "./importar.ts";
import { leerInformePdf, leerInformesDelPdf, lineasDeInforme } from "./informePdf.ts";

/**
 * El parser contra los informes de verdad.
 *
 * Cinco de los seis informes de ejemplo del centro ESTÁN YA IMPORTADOS en
 * producción desde el Excel mensual, y eso los convierte en el juez: lo que
 * el parser saque del PDF tiene que ser, campo a campo, lo que el Excel dejó
 * en la base. Las cifras de abajo no son inventadas ni redondeadas: están
 * copiadas de `tc_tacografo_intervenciones`.
 *
 * ── Por qué esto no se ejecuta solo ─────────────────────────────────────────
 *
 * Los PDF no están en el repositorio. Llevan matrículas, bastidores, el
 * nombre del técnico y el número de su tarjeta profesional, y subirlos sería
 * publicar documentos del cliente en el historial de git para siempre.
 *
 * Así que esta prueba se activa con la carpeta donde estén:
 *
 *     TACOGRAFO_INFORMES_DIR=/ruta/a/los/informes npx vitest run informePdf.reales
 *
 * Los ficheros se buscan como `InfTec_<A1>.pdf`. Sin la variable, se salta y
 * lo dice, que es mejor que pasar en verde sin haber comprobado nada.
 *
 * Las trampas que cubre y que ninguna prueba sintética puede cubrir: que las
 * cruces del impreso real caigan donde se cree (el `resultado` de los cinco),
 * que las dos copias de cada PDF concuerden de verdad, y que las
 * normalizaciones del Excel —puntos, ceros de delante, marca del fabricante—
 * estén todas.
 */

const DIR = process.env.TACOGRAFO_INFORMES_DIR;

/** Lo que hay en producción, columna a columna. */
const ESPERADO: Record<string, Record<string, unknown>> = {
  E943009005028K: {
    fecha: "2026-06-05",
    tipoOperacion: "Calibrado o Parametrización / Control / Reparación",
    resultado: "Favorable",
    matriculaNorm: "0008JDJ", bastidor: "YV3T7U522FA170360", marca: "Volvo", modelo: "B8",
    medidaNorm: "295/80R22.5", kmAnterior: 579108, kmNuevo: 579104,
    paramW: "10410", paramK: "10410", paramL: "3240",
    fabricante: "VDO", referencia: "13811012009005", version: "21010",
    numSerie: "3587186", numSensor: "12488466",
    precintos: "PR04072572/43009/PR04019031",
    tecnico: "PEDRO RAMON FERRAN GONZALEZ", tecnicoTarjeta: "EA43044379001308",
    tecnicoTarjetaCad: "2027-01-08",
    bRodillos: "voiliv006860217", eqCalibrado: "499", manometro: "251113012",
    cronometro: "30233WG24261", tgdFichero: "V_0008JDJ_E_20260605_1032.tgd",
    comprobaciones: {
      reloj: "-0.2", limitador: "No", velocidad: "Sí",
      distanciaBanco: "1105", distanciaError: "0", distanciaTacografo: "1105",
    },
  },
  E943009005396O: {
    fecha: "2026-11-02",
    tipoOperacion: "Calibrado o Parametrización / Control / Reparación",
    resultado: "Favorable",
    matriculaNorm: "7555JNT", bastidor: "WEB63440211000650", marca: "Mercedes Benz",
    modelo: "1613.35 ( nº 1011 )",
    medidaNorm: "295/80R22.5", kmAnterior: 357278, kmNuevo: 357273,
    paramW: "15701", paramK: "15701", paramL: "3196",
    fabricante: "VDO", referencia: "13811070109010", version: "21010",
    numSerie: "3909265", numSensor: "13162638",
    precintos: "PR04265189/43009/PR02340104",
    tecnico: "PEDRO RAMON FERRAN GONZALEZ", tecnicoTarjeta: "EA43044379001308",
    tecnicoTarjetaCad: "2027-01-08",
    bRodillos: "voiliv006860217", eqCalibrado: "499", manometro: "251113012",
    cronometro: "30233WG24261", tgdFichero: "V_7555JNT_E_20261102_1150.tgd",
    comprobaciones: {
      reloj: "0", limitador: "No", velocidad: "Sí",
      distanciaBanco: "1105", distanciaError: "0", distanciaTacografo: "1105",
    },
  },
  E943009005397P: {
    fecha: "2026-11-02",
    tipoOperacion: "Calibrado o Parametrización / Control / Reparación",
    resultado: "Favorable",
    matriculaNorm: "8318JVM", bastidor: "VS914AD00G1016703", marca: "Irizar",
    modelo: "NºBUS 1333",
    medidaNorm: "295/80R22.5", kmAnterior: 719103, kmNuevo: 719098,
    paramW: "10946", paramK: "10946", paramL: "3270",
    fabricante: "VDO", referencia: "13817550303005", version: "30041",
    numSerie: "1037739", numSensor: "13943961",
    precintos: "PR04265162/43009/PR00886029",
    // Otro técnico y otra tarjeta: el impreso no siempre lo firma el mismo.
    tecnico: "JOSE HERRERA PASCUA", tecnicoTarjeta: "EA43044379001407",
    tecnicoTarjetaCad: "2027-09-25",
    bRodillos: "voiliv006860217", eqCalibrado: "7977", manometro: "251113012",
    cronometro: "3019A0017091", tgdFichero: "V_8318JVM_E_20261102_1715.tgd",
    comprobaciones: {
      reloj: "-0.2", limitador: "No", velocidad: "Sí",
      distanciaBanco: "1110", distanciaError: "0", distanciaTacografo: "1110",
    },
  },
  E943009005405X: {
    fecha: "2026-11-04",
    tipoOperacion: "Calibrado o Parametrización / Control / Reparación",
    resultado: "Favorable",
    matriculaNorm: "8235JDF", bastidor: "YV3T7U520FA170454", marca: "Volvo", modelo: "B8R",
    medidaNorm: "295/80R22.5", kmAnterior: 652266, kmNuevo: 652259,
    paramW: "10399", paramK: "10399", paramL: "3248",
    fabricante: "VDO", referencia: "13817550303007", version: "30041",
    numSerie: "840533", numSensor: "15105011",
    precintos: "PR04265152/43009/PR03238952",
    tecnico: "PEDRO RAMON FERRAN GONZALEZ", tecnicoTarjeta: "EA43044379001308",
    tecnicoTarjetaCad: "2027-01-08",
    bRodillos: "voiliv006860217", eqCalibrado: "499", manometro: "251113012",
    cronometro: "30233WG24261", tgdFichero: "V_8235JDF_E_20261104_1017.tgd",
    comprobaciones: {
      reloj: "-0.2", limitador: "No", velocidad: "Sí",
      distanciaBanco: "1105", distanciaError: "0", distanciaTacografo: "1105",
    },
  },
  /*
   * La transferencia. Trae vacíos TODOS los campos de calibrado —km, medida,
   * parámetros, equipos, precintos— y el resultado en «-----», que es lo que
   * llevan las 201 transferencias del Excel. Si el parser se inventara un
   * cero o un null donde va «-----», el vencimiento de este vehículo
   * cambiaría de criterio.
   */
  E943009005308E: {
    fecha: "2026-10-02",
    tipoOperacion: "Transferencia / Certificado de intransferibilidad / Sustitución",
    resultado: "-----",
    matriculaNorm: "9204HMM", marca: "MAN",
    medidaNorm: null, kmAnterior: null, kmNuevo: null,
    paramW: null, paramK: null, paramL: null,
    fabricante: "VDO", referencia: "13817550303007", version: null,
    numSerie: "731555", numSensor: null, precintos: null,
    tecnico: "PEDRO RAMON FERRAN GONZALEZ", tecnicoTarjeta: "EA43044379001308",
    tecnicoTarjetaCad: "2027-01-08",
    bRodillos: null, eqCalibrado: null, manometro: null, cronometro: null,
    tgdFichero: null,
    comprobaciones: { limitador: "No comprobado", velocidad: "No" },
  },
};

/**
 * Lo que el PDF trae y el Excel dejó vacío.
 *
 * En la transferencia, el impreso lleva el bastidor y el modelo y el Excel
 * del centro no los exportó. Van aparte y no en `ESPERADO` porque no son una
 * discrepancia: son la prueba de que el PDF a veces COMPLETA lo que ya hay,
 * que es de lo que vive la idea de dar de alta desde el informe.
 */
const AÑADE: Record<string, Record<string, unknown>> = {
  E943009005308E: { bastidor: "WMAR33ZZ3CC017186", modelo: "BUS N1137" },
};

const ruta = (id: string) => join(DIR ?? "", `InfTec_${id}.pdf`);

describe.skipIf(!DIR)("el parser contra los informes reales del centro", () => {
  for (const [id, esperado] of Object.entries(ESPERADO)) {
    describe(id, () => {
      it("se lee sin problemas y trae las dos copias del impreso", async () => {
        if (!existsSync(ruta(id))) throw new Error(`No está ${ruta(id)}`);
        const r = leerInformePdf(await lineasDeInforme(readFileSync(ruta(id))));
        expect(r.problemas).toEqual([]);
        expect(r.copias).toBe(2);
        expect(r.fila).not.toBeNull();
      });

      it("y dice campo a campo lo que el Excel dejó en producción", async () => {
        const r = leerInformePdf(await lineasDeInforme(readFileSync(ruta(id))));
        expect(r.fila).toMatchObject({ idOrigen: id, ...esperado });
      });

      const anade = AÑADE[id];
      if (anade) {
        it("y además completa lo que el Excel dejó vacío", async () => {
          const r = leerInformePdf(await lineasDeInforme(readFileSync(ruta(id))));
          expect(r.fila).toMatchObject(anade);
        });
      }
    });
  }

  /*
   * El sexto informe no está en producción: es el caso de «la revisión no
   * está dada de alta». Y es el único con un tacógrafo Stoneridge, que es el
   * único que trae la versión de software en el campo I46 (los VDO lo dejan
   * vacío y el Excel la saca de la impresión de datos técnicos del aparato,
   * que no es parte del impreso).
   */
  describe("E943009005411D · el que NO está en la base", () => {
    it("se lee entero, con el fabricante y la versión del Stoneridge", async () => {
      const r = leerInformePdf(await lineasDeInforme(readFileSync(ruta("E943009005411D"))));
      expect(r.problemas).toEqual([]);
      expect(r.fila).toMatchObject({
        idOrigen: "E943009005411D",
        fecha: "2026-11-07",
        tipoOperacion: "Calibrado o Parametrización / Control / Reparación",
        resultado: "Favorable",
        matriculaNorm: "9832LXT", bastidor: "YS2K6X20001921611",
        marca: "Irizar", modelo: "i6",
        medidaNorm: "315/80R22.5", kmAnterior: 586971, kmNuevo: 586966,
        paramW: "8895", paramK: "8895", paramL: "3302",
        fabricante: "STONERIDGE", version: "PABF.S0L",
        numSerie: "1684227", numSensor: "21317476",
        tecnico: "JORDI CRUSET COMAJUNCOSAS",
      });
    });
  });
});

  /*
   * Y el tramo que de verdad escribe: del PDF a la fila de la tabla, por el
   * mismo `aFilaInsert()` que usa el importador del Excel. Si esto se
   * rompiera, el parser seguiría en verde y la intervención entraría mal.
   */
  describe.skipIf(!DIR)("de un informe real a la fila que se insertaría", () => {
    it("lleva la clave del Excel, sin lote y marcada como creada de un PDF", async () => {
      const r = leerInformePdf(await lineasDeInforme(readFileSync(ruta("E943009005411D"))));
      const insert = aFilaInsert(r.fila!, {
        empresa: "emp-1", sistemaOrigen: "informe_intervenciones", vehiculoId: "veh-1",
        loteId: null, archivo: "InfTec_E943009005411D.pdf", hoja: null,
        usuarioId: "u-1", kmSospechoso: false, creadaDePdf: true,
      });
      expect(insert).toMatchObject({
        empresa_id: "emp-1",
        vehiculo_id: "veh-1",
        // La MISMA clave que el Excel: de eso vive que no se pueda duplicar.
        sistema_origen: "informe_intervenciones",
        id_origen: "E943009005411D",
        fecha: "2026-11-07",
        matricula_norm: "9832LXT",
        resultado: "Favorable",
        medida_neumatico_norm: "315/80R22.5",
        km_anterior: 586971,
        km_nuevo: 586966,
        param_w: "8895",
        fabricante: "STONERIDGE",
        version: "PABF.S0L",
        lote_id: null,
        creada_de_pdf: true,
      });
    });
  });

  /*
   * Un PDF con VARIAS intervenciones dentro, montado con informes de verdad.
   *
   * Es el caso del panel de importación: el centro manda los informes de uno
   * en uno, pero el mes entero junto en un fichero es lo que llega por
   * correo. Las pruebas sintéticas fijan la regla de agrupar por A1; esta
   * comprueba que la regla sobrevive a los PDF reales, que traen 7 páginas
   * por informe con una en blanco en medio.
   */
  describe.skipIf(!DIR)("un PDF con el mes entero dentro", () => {
    /** Tres informes reales en un solo fichero, como los junta un correo. */
    async function juntar(ids: string[]): Promise<Buffer> {
      const { PDFDocument } = await import("pdf-lib");
      const salida = await PDFDocument.create();
      for (const id of ids) {
        const origen = await PDFDocument.load(readFileSync(ruta(id)));
        for (const p of await salida.copyPages(origen, origen.getPageIndices())) salida.addPage(p);
      }
      return Buffer.from(await salida.save());
    }

    const IDS = ["E943009005405X", "E943009005411D", "E943009005308E"];

    it("saca las tres intervenciones, cada una con sus dos ejemplares", async () => {
      const r = leerInformesDelPdf(await lineasDeInforme(await juntar(IDS)));
      expect(r.map((x) => x.fila?.idOrigen)).toEqual(IDS);
      expect(r.map((x) => x.copias)).toEqual([2, 2, 2]);
      expect(r.map((x) => x.paginas)).toEqual([6, 6, 6]);
      expect(r.flatMap((x) => x.problemas)).toEqual([]);
    });

    // Y cada una con lo suyo: tres vehículos, dos tipos y dos resultados
    // distintos en el mismo fichero.
    it("y no se contagian los datos de unas a otras", async () => {
      const r = leerInformesDelPdf(await lineasDeInforme(await juntar(IDS)));
      expect(r.map((x) => x.fila!.matriculaNorm)).toEqual(["8235JDF", "9832LXT", "9204HMM"]);
      expect(r.map((x) => x.fila!.fecha)).toEqual(["2026-11-04", "2026-11-07", "2026-10-02"]);
      expect(r.map((x) => x.fila!.resultado)).toEqual(["Favorable", "Favorable", "-----"]);
      expect(r[2].fila!.tipoOperacion)
        .toBe("Transferencia / Certificado de intransferibilidad / Sustitución");
    });

    // La ficha de un vehículo adjunta UN informe: con un fichero así no
    // elige, porque elegir dejaría las otras dos sin adjuntar y sin que
    // nadie se entere.
    it("la ficha de un vehículo se niega a elegir una de las tres", async () => {
      const r = leerInformePdf(await lineasDeInforme(await juntar(IDS)));
      expect(r.fila).toBeNull();
      expect(r.problemas[0].motivo).toContain("3 intervenciones");
    });
  });

describe.skipIf(!!DIR)("los informes reales", () => {
  it("se saltan porque no se ha dicho dónde están (TACOGRAFO_INFORMES_DIR)", () => {
    expect(DIR).toBeUndefined();
  });
});
