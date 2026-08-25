/**
 * La tubería de importación con PDF de verdad.
 *
 * Aquí no se inventa cómo reparte mupdf las columnas: se genera un PDF **a dos
 * columnas**, como el impreso de la extranet, se extrae su texto y se analiza.
 * Es lo único que responde a la pregunta que importa —¿sobrevive el analizador
 * al reparto en columnas?— sin tener el fichero real delante.
 *
 * El camino de OCR no se prueba aquí: depende de un servicio externo. Lo que
 * sí se prueba es que un PDF sin texto ni se intenta analizar.
 */

import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { parsearAnexoII } from "./anexoII.ts";
import { textoDePdf } from "./importar.ts";

const IZQUIERDA: Array<[string, string]> = [
  ["1. Número de matrícula del vehículo:", "8843KWW"],
  ["2. Número de bastidor del vehículo:", "YS2K4X20001910616"],
  ["3. Fabricante del vehículo:", "Scania"],
  ["4. Modelo del vehículo:", "Sunsundegui 1125"],
  ["5. Nombre de la empresa de transportes:", "TERESA Y JOSE PLANA EMPRESA PLANA S.L."],
  ["6. Dirección de la empresa de transportes:", "LES CREUS, 29"],
  ["7. Detalles de la tarjeta de empresa:", ""],
  ["13. Nombre del fabricante del tacógrafo:", "Aumovio Germany GmbH"],
  ["14. Modelo de la unidad:", "1381.4521302001"],
  ["15. Número de serie de la unidad:", "15944384"],
  ["16. Fecha de fabricación de la unidad:", "2021"],
  ["17. Situación de la unidad en la cabina:", "SI"],
  ["18. Marca de homologación de la unidad:", "e1-84"],
  ["19. Visibilidad de la placa (Req. 169/170):", "SI"],
];

const DERECHA: Array<[string, string]> = [
  ["8. Nombre del Centro Técnico:", "COMERCIAL SEA, S.A."],
  ["9. Dirección del Centro Técnico:", "C/ Coure, 27"],
  ["10. Contraseña del Centro Técnico:", "E943009"],
  ["11. Detalles de la tarjeta del Centro Técnico:", "EA43044379001203 (G1)"],
  ["12. Nombre del técnico que interviene", "JORDI CRUSET COMAJUNCOSAS"],
  ["20. ¿Se ven los datos en pantalla?", "SI"],
  ["21. ¿Era posible imprimir los datos?", "SI"],
  ["22. ¿Era posible transferir los datos?", "NO"],
  ["23. ¿Se pudieron descargar todos los datos?", "NO"],
  ["24. En caso negativo de 23, ¿por qué?", "ERROR LECTURA TARJETAS"],
  ["25. Fecha de transferencia de los datos desde la unidad intravehicular:", ""],
  ["26. ¿Han sido los datos enviados a la empresa?", "NO"],
  ["27. Fecha de envío:", ""],
];

/** Un PDF con la misma disposición que el impreso: cabecera y dos columnas. */
async function pdfDosColumnas(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const escribir = (t: string, x: number, y: number, size = 8) =>
    pagina.drawText(t, { x, y, size, font: fuente });

  escribir("Informe sobre transferencia de datos/certificado de intransferibilidad", 90, 800, 10);
  escribir("NÚMERO DE INFORME / CERTIFICADO: E943009001015B", 60, 780);
  escribir("Fecha: 07-01-2021 17:04:38", 380, 780);

  let y = 750;
  for (const [etiqueta, valor] of IZQUIERDA) {
    escribir(etiqueta, 40, y);
    escribir(valor, 50, y - 10);
    y -= 24;
  }
  y = 750;
  for (const [etiqueta, valor] of DERECHA) {
    escribir(etiqueta, 310, y);
    escribir(valor, 320, y - 10);
    y -= 24;
  }
  return Buffer.from(await doc.save());
}

describe("importación de un PDF a dos columnas", () => {
  it("extrae el texto y reconoce las 29 etiquetas del impreso", async () => {
    const texto = textoDePdf(await pdfDosColumnas());
    const r = parsearAnexoII(texto);
    expect(r.avisos).toEqual([]);
    expect(r.encontradas).toBe(r.total);
  });

  it("cada valor va con su etiqueta, no con la de la columna de al lado", async () => {
    // Éste es el riesgo real del reparto en columnas: que el nº de serie de la
    // izquierda acabe pegado a la contraseña del centro, que está a su derecha.
    const { campos } = parsearAnexoII(textoDePdf(await pdfDosColumnas()));
    expect(campos.matricula).toBe("8843KWW");
    expect(campos.tacSerie).toBe("15944384");
    expect(campos.centroContrasena).toBe("E943009");
    expect(campos.tecnico).toBe("JORDI CRUSET COMAJUNCOSAS");
    expect(campos.transferir).toBe("NO");
    expect(campos.numInforme).toBe("E943009001015B");
  });

  it("los campos vacíos del impreso siguen vacíos", async () => {
    const { campos } = parsearAnexoII(textoDePdf(await pdfDosColumnas()));
    expect(campos.fechaTransferencia).toBe("");
    expect(campos.fechaEnvio).toBe("");
  });

  it("distingue el anexo II del informe técnico", async () => {
    const { importarAnexoII } = await import("./importar.ts");
    const r = await importarAnexoII(await pdfDosColumnas(), "application/pdf");
    expect(r.impreso).toBe("anexo_ii");
    expect(r.origen).toBe("pdf_texto");
    // Y con el anexo II delante, la casilla 22 sigue decidiendo el tipo.
    expect(r.datos.tipo).toBe("intransferibilidad");
  });

  it("un PDF sin capa de texto no da nada que analizar", async () => {
    // Es el caso del escaneo: `encontradas` sale a cero y por eso el
    // importador se va al OCR en vez de devolver un expediente vacío.
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const vacio = Buffer.from(await doc.save());
    expect(parsearAnexoII(textoDePdf(vacio)).encontradas).toBe(0);
  });
});
