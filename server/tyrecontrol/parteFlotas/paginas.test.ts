/**
 * Partir el PDF de los partes en una hoja por página.
 *
 * Los PDF de estas pruebas se fabrican aquí con la misma librería que usa el
 * generador de partes, así que no hace falta un fichero de muestra en el
 * repositorio ni subir documentos de un cliente.
 */

import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import { esPdf, MAX_PAGINAS, partirEnHojas } from "./paginas.ts";

/** Un PDF de `n` páginas, como data URI. */
async function pdfDe(n: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([595, 842]);
  const bytes = await doc.save();
  return `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Cuántas páginas tiene un data URI de PDF. */
async function cuentaPaginas(dataUri: string): Promise<number> {
  const bytes = Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64");
  return (await PDFDocument.load(bytes)).getPageCount();
}

const hojas = (r: Awaited<ReturnType<typeof partirEnHojas>>) =>
  "paginas" in r ? r.paginas : null;

describe("partir el fichero en hojas", () => {
  it("catorce páginas dan catorce hojas de una página", async () => {
    // Es el caso real: un día de revisiones llega en un PDF de 14 páginas,
    // una por vehículo.
    const r = await partirEnHojas(await pdfDe(14));
    const ps = hojas(r)!;
    expect(ps).toHaveLength(14);
    expect(await cuentaPaginas(ps[0])).toBe(1);
    expect(await cuentaPaginas(ps[13])).toBe(1);
  });

  it("mantiene el orden", async () => {
    // Importa: la hoja 3 del PDF tiene que seguir siendo la tercera, porque
    // es lo que se le enseña al usuario para cotejar con el papel.
    const r = await partirEnHojas(await pdfDe(3));
    expect(hojas(r)).toHaveLength(3);
    expect("total" in r && r.total).toBe(3);
  });

  it("un PDF de una página se devuelve tal cual, sin volver a guardarlo", async () => {
    // Re-serializar no aporta nada y puede degradar un escaneo.
    const uno = await pdfDe(1);
    const r = await partirEnHojas(uno);
    expect(hojas(r)).toEqual([uno]);
  });

  it("una foto ya es una hoja", async () => {
    const foto = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const r = await partirEnHojas(foto);
    expect(hojas(r)).toEqual([foto]);
    expect(esPdf(foto)).toBe(false);
  });

  it("pone techo a lo que puede costar un fichero subido por error", async () => {
    // Cada página es una llamada que se paga.
    const r = await partirEnHojas(await pdfDe(MAX_PAGINAS + 1));
    expect(hojas(r)).toBeNull();
    expect("motivo" in r && r.motivo).toContain(`${MAX_PAGINAS}`);
  });

  it("justo en el tope sí entra", async () => {
    const r = await partirEnHojas(await pdfDe(MAX_PAGINAS));
    expect(hojas(r)).toHaveLength(MAX_PAGINAS);
  });

  it("un PDF que no se puede abrir se dice, no revienta", async () => {
    const roto = "data:application/pdf;base64,bm8gc295IHVuIHBkZg==";
    const r = await partirEnHojas(roto);
    expect(hojas(r)).toBeNull();
    expect("motivo" in r && r.motivo).toContain("No se ha podido abrir");
  });

  it("un data URI sin coma tampoco", async () => {
    const r = await partirEnHojas("data:application/pdf;base64");
    expect(hojas(r)).toBeNull();
  });
});
