/**
 * Composición de los documentos.
 *
 * No comprueba píxeles: comprueba que el PDF se genera, que es un PDF, y que el
 * texto que acaba dentro es el que toca — sobre todo el que distingue un
 * documento válido de uno que no vale, como la modalidad de entrega marcada o
 * la línea del achatarramiento.
 */

import { inflateSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  DOCUMENTOS_POR_TIPO,
  aWinAnsi,
  componer,
  fechaEs,
  partirEnLineas,
} from "./documents.ts";
import { PLANTILLAS } from "./templates.ts";
import type { Centro, Expediente } from "./repository.ts";

const CENTRO: Centro = {
  nombre: "COMERCIAL SEA S.A.",
  centroTecnico: "Centro técnico de Tacógrafos",
  numCentro: "E943009",
  direccion1: "Pol.Ind. Riu Clar",
  direccion2: "C/ Coure, 27",
  ciudad: "43006 Tarragona",
  ciudadFirma: "Tarragona",
  email: "centro@example.com",
  destinatarioAdmin: "Direcció General de Transports i Mobilitat",
  responsableTecnico: "Jordi Cruset",
  urlTramite: "",
  urlTramiteOvt: "",
};

function expediente(sobre: Partial<Expediente> = {}): Expediente {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    numInforme: "E943009003781L",
    tipo: "intransferibilidad",
    estado: "borrador",
    empresaCliente: "COMERCIAL TANK FOODS S.L.",
    autorizaNombre: "Joan Pla Serra",
    autorizaNif: "39887654T",
    docTitularidad: true,
    matricula: "7567MPF",
    bastidor: "VF3XXXXXXXXXXXXXX",
    tacMarca: "VDO",
    tacModelo: "1381.7550303006",
    tacSerie: "1000567",
    fechaInforme: "2025-03-10",
    fechaEntrega: "2025-03-14",
    fechaTransferencia: null,
    fechaEnvio: null,
    tecnico: "Marc Roig",
    modalidadEntrega: null,
    receptorNombre: "Marta Solé Vidal",
    receptorDni: "40123456X",
    entregaAparato: false,
    destruccionFecha: null,
    destruccionMetodo: "",
    destruccionPersona: "",
    destruccionHash: "",
    intervencionId: null,
    createdAtMs: 0,
    updatedAtMs: 0,
    ...sobre,
  };
}

const CTX = (e: Expediente) => ({
  expediente: e,
  centro: CENTRO,
  plantillas: PLANTILLAS,
  // Mismo formato que compone `service.pie()`.
  pie: "Formato CTT-F-01 · Plantillas v1 · Emitido 22/08/2026 · Centro E943009 · UNE 66102:2025",
});

/**
 * Texto plano del PDF, para poder afirmar qué hay dentro.
 *
 * pdf-lib comprime los flujos de contenido, así que hay que inflarlos antes de
 * buscar los operadores de dibujo de texto. Se hace aquí, en la prueba, y no
 * con una librería de extracción: lo único que hace falta es leer las cadenas
 * que el propio módulo ha escrito.
 */
function textoDelPdf(pdf: Buffer): string {
  const trozos: string[] = [];
  let desde = 0;
  for (;;) {
    const ini = pdf.indexOf("stream", desde);
    if (ini < 0) break;
    const fin = pdf.indexOf("endstream", ini);
    if (fin < 0) break;
    // Tras "stream" viene un salto de línea (o CRLF) antes de los datos.
    let datos = ini + "stream".length;
    if (pdf[datos] === 0x0d) datos++;
    if (pdf[datos] === 0x0a) datos++;
    const crudo = pdf.subarray(datos, fin);
    try {
      trozos.push(inflateSync(crudo).toString("latin1"));
    } catch {
      trozos.push(crudo.toString("latin1"));
    }
    // Avanzar sólo un byte volvería a encontrar la "stream" que hay dentro de
    // "endstream", y el siguiente tramo se comería la página siguiente.
    desde = fin + "endstream".length;
  }
  // pdf-lib escribe las cadenas en hexadecimal: `<434F4D...> Tj`, no `(COM...) Tj`.
  const contenido = trozos.join("\n");
  return (contenido.match(/<([0-9A-Fa-f]+)>\s*Tj/g) ?? [])
    .map((t) => Buffer.from(t.slice(1, t.indexOf(">")), "hex").toString("latin1"))
    .join(" ");
}

describe("DOCUMENTOS_POR_TIPO", () => {
  it("el justificante es de la transferencia y los otros dos de la intransferibilidad", () => {
    expect(DOCUMENTOS_POR_TIPO.transferencia).toEqual(["justificante"]);
    expect(DOCUMENTOS_POR_TIPO.intransferibilidad).toEqual([
      "acuse_cliente",
      "comunicacion_admin",
    ]);
  });
});

describe("componer", () => {
  it("el justificante cabe en una sola hoja", async () => {
    // Es lo que el cliente firma en el mostrador: una segunda página con la
    // firma sola invita a que se traspapele. Si algún día crece el texto legal,
    // esta prueba avisa antes de que salga por la impresora.
    const e = expediente({ tipo: "transferencia", modalidadEntrega: "en_mano" });
    const pdf = await componer("justificante", CTX(e));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it("el acuse y la comunicación también caben en una hoja", async () => {
    for (const tipo of ["acuse_cliente", "comunicacion_admin"] as const) {
      const pdf = await componer(tipo, CTX(expediente()));
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    }
  });

  it("el justificante lleva los datos del cliente, del centro y del tacógrafo", async () => {
    const e = expediente({ tipo: "transferencia", modalidadEntrega: "email" });
    const texto = textoDelPdf(await componer("justificante", CTX(e)));
    for (const esperado of [
      "Joan Pla Serra", "39887654T", "COMERCIAL TANK FOODS S.L.", "7567MPF",
      "E943009", "VDO", "1381.7550303006", "1000567", "Marc Roig", "10/03/2025",
    ]) {
      expect(texto).toContain(esperado);
    }
  });

  it("marca una única modalidad de entrega", async () => {
    const e = expediente({ tipo: "transferencia", modalidadEntrega: "mensajeria" });
    const texto = textoDelPdf(await componer("justificante", CTX(e)));
    // Las cuatro opciones se imprimen siempre; sólo una lleva la X.
    expect(texto).toContain("Entrega a través de empresa de mensajería");
    expect(texto).toContain("Entrega por correo certificado");
    expect((texto.match(/(?:^|\s)X(?:\s|$)/g) ?? []).length).toBe(1);
  });

  it("sin modalidad elegida no marca ninguna casilla", async () => {
    const e = expediente({ tipo: "transferencia", modalidadEntrega: null });
    const texto = textoDelPdf(await componer("justificante", CTX(e)));
    expect((texto.match(/(?:^|\s)X(?:\s|$)/g) ?? []).length).toBe(0);
  });

  it("el acuse lleva a la persona receptora, no a quien autoriza", async () => {
    const texto = textoDelPdf(await componer("acuse_cliente", CTX(expediente())));
    expect(texto).toContain("Marta Solé Vidal");
    expect(texto).toContain("40123456X");
    // Quien autoriza la descarga no pinta nada en el acuse de recibo.
    expect(texto).not.toContain("39887654T");
  });

  it("el acuse imprime el achatarramiento cuando el aparato no se entrega", async () => {
    const texto = textoDelPdf(await componer("acuse_cliente", CTX(expediente({ entregaAparato: false }))));
    expect(texto).toContain("El tacógrafo se achatarrará");
    expect(texto).not.toContain("Se entrega tacógrafo Averiado");
  });

  it("y la entrega cuando sí se entrega: nunca las dos", async () => {
    const texto = textoDelPdf(await componer("acuse_cliente", CTX(expediente({ entregaAparato: true }))));
    expect(texto).toContain("Se entrega tacógrafo Averiado");
    expect(texto).not.toContain("El tacógrafo se achatarrará");
  });

  it("la comunicación va dirigida a la administración, no al cliente", async () => {
    const texto = textoDelPdf(await componer("comunicacion_admin", CTX(expediente())));
    expect(texto).toContain("Direcció General de Transports i Mobilitat");
    expect(texto).toContain("Jordi Cruset");
    expect(texto).not.toContain("COMERCIAL TANK FOODS S.L.");
  });

  it("todos los documentos llevan el pie de identificación del formato", async () => {
    for (const tipo of ["justificante", "acuse_cliente", "comunicacion_admin"] as const) {
      const texto = textoDelPdf(await componer(tipo, CTX(expediente({ tipo: "transferencia" }))));
      expect(texto).toContain("UNE 66102:2025");
    }
  });

  it("la cita del real decreto lleva barra, no dos puntos", async () => {
    const texto = textoDelPdf(await componer("acuse_cliente", CTX(expediente())));
    expect(texto).toContain("Real decreto 125/2017");
    expect(texto).not.toContain("125:2017");
  });

  it("dos composiciones del mismo expediente dan el mismo texto", async () => {
    // El PDF lleva fecha de creación, así que los bytes difieren; lo que tiene
    // que ser estable es el contenido.
    const e = expediente();
    const a = textoDelPdf(await componer("acuse_cliente", CTX(e)));
    const b = textoDelPdf(await componer("acuse_cliente", CTX(e)));
    expect(a).toBe(b);
  });

  it("un carácter que la fuente no sabe pintar no rompe la emisión", async () => {
    // Pasó de verdad con un nombre pegado desde un correo: comillas
    // tipográficas y un emoji sueltos reventaban drawText.
    const e = expediente({ empresaCliente: 'TRANSPORTES “ÑU” 🚚 S.L.' });
    const pdf = await componer("acuse_cliente", CTX(e));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(textoDelPdf(pdf)).toContain('TRANSPORTES "ÑU"');
  });
});

describe("partirEnLineas", () => {
  it("no deja ninguna línea más ancha que el límite", async () => {
    const doc = await PDFDocument.create();
    const fuente = await doc.embedFont(StandardFonts.TimesRoman);
    const lineas = partirEnLineas(PLANTILLAS.just_p4, fuente, 11, 480);
    expect(lineas.length).toBeGreaterThan(1);
    for (const l of lineas) expect(fuente.widthOfTextAtSize(l, 11)).toBeLessThanOrEqual(480);
  });
});

describe("aWinAnsi", () => {
  it("conserva los acentos del castellano y del catalán", () => {
    expect(aWinAnsi("Sol·licito açò, més ràpid: ñ á é í ó ú ü")).toBe(
      "Sol·licito açò, més ràpid: ñ á é í ó ú ü"
    );
  });

  it("normaliza las comillas tipográficas y quita lo impintable", () => {
    expect(aWinAnsi("“hola” — 🚚")).toBe('"hola" - ');
  });
});

describe("fechaEs", () => {
  it("pasa de aaaa-mm-dd a dd/mm/aaaa", () => {
    expect(fechaEs("2025-03-10")).toBe("10/03/2025");
  });
  it("sin fecha, cadena vacía", () => {
    expect(fechaEs(null)).toBe("");
  });
});
