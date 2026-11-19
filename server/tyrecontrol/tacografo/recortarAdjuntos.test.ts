import { PDFDocument, StandardFonts } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";

import { recortarAdjuntos, rutaDelRecortado, type AdjuntoGuardado, type Almacen } from "./recortarAdjuntos.ts";

/**
 * El recorte de los informes que ya estaban adjuntos borra ficheros, así que
 * lo que se fija es el ORDEN y qué pasa cuando un paso falla: nunca puede
 * quedar un informe apuntando a un fichero que no existe.
 *
 * Los PDF son de verdad —el recorte los abre con mupdf—, hechos aquí con el
 * mínimo que el lector necesita: el número de orden y el pie de cada ejemplar.
 */
async function informe(idOrigen: string, ejemplares: Array<"taller" | "cliente">): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  for (const [i, ej] of ejemplares.entries()) {
    if (i > 0) doc.addPage([595, 842]); // la página en blanco entre ejemplares
    const p = doc.addPage([595, 842]);
    const pon = (t: string, x: number, y: number) => p.drawText(t, { x, y: 842 - y, size: 8, font: fuente });
    pon("A1. Nº de orden de la intervención:", 25, 60); pon(idOrigen, 190, 60);
    pon("A3. Fecha:", 25, 80); pon("04-11-2026 11:22:37", 80, 80);
    pon("E22.Matrícula:", 25, 100); pon("8235JDF", 90, 100);
    pon(`Ejemplar para el ${ej}`, 480, 800);
  }
  return Buffer.from(await doc.save());
}
const paginas = async (pdf: Buffer) => (await PDFDocument.load(pdf)).getPageCount();

let ficheros: Map<string, Buffer>;
let docs: (AdjuntoGuardado & { paginas?: number; bytes?: number })[];
let pasos: string[];
let falla: "apuntar" | "borrar" | null;

const almacen: Almacen = {
  listar: async () => docs.map((d) => ({ ...d })),
  descargar: async (ruta) => {
    const f = ficheros.get(ruta);
    if (!f) throw new Error("No existe en el almacén");
    return f;
  },
  subir: async (ruta, pdf) => { pasos.push(`subir ${ruta}`); ficheros.set(ruta, pdf); },
  apuntar: async (id, c) => {
    pasos.push(`apuntar ${id}`);
    if (falla === "apuntar") throw new Error("la base no contesta");
    const d = docs.find((x) => x.id === id)!;
    d.ruta = c.ruta; d.paginas = c.paginas; d.bytes = c.bytes;
  },
  borrar: async (ruta) => {
    pasos.push(`borrar ${ruta}`);
    if (falla === "borrar" && !ruta.endsWith("-cliente.pdf")) throw new Error("el almacén no contesta");
    ficheros.delete(ruta);
  },
};

beforeEach(async () => {
  pasos = []; falla = null;
  ficheros = new Map([["e/v/tacografo/E1-1.pdf", await informe("E1", ["taller", "cliente"])]]);
  docs = [{ id: "d1", ruta: "e/v/tacografo/E1-1.pdf", nombre: "InfTec_E1.pdf", idOrigen: "E1", matricula: "8235JDF" }];
});

describe("recortarAdjuntos", () => {
  it("el lector de verdad entiende los PDF de esta prueba", async () => {
    // Si esto falla, lo demás no prueba nada: se estaría midiendo el doble.
    const r = await recortarAdjuntos(almacen, true);
    expect(r[0].accion).toBe("se_recortaria");
  });

  it("simular no sube, no apunta y no borra", async () => {
    const [r] = await recortarAdjuntos(almacen, true);
    expect(r).toMatchObject({ accion: "se_recortaria", paginas: 1 });
    expect(pasos).toEqual([]);
    expect(docs[0].ruta).toBe("e/v/tacografo/E1-1.pdf");
  });

  it("sube el recortado, apunta el informe y solo entonces borra el antiguo", async () => {
    const [r] = await recortarAdjuntos(almacen, false);
    expect(r.accion).toBe("recortado");
    expect(pasos).toEqual([
      "subir e/v/tacografo/E1-1-cliente.pdf", "apuntar d1", "borrar e/v/tacografo/E1-1.pdf",
    ]);
    expect(docs[0]).toMatchObject({ ruta: "e/v/tacografo/E1-1-cliente.pdf", paginas: 1 });
    expect([...ficheros.keys()]).toEqual(["e/v/tacografo/E1-1-cliente.pdf"]);
    expect(await paginas(ficheros.get(docs[0].ruta)!)).toBe(1);
    expect(r.bytesDespues!).toBeLessThan(r.bytesAntes!);
  });

  it("repetir no toca lo que ya es solo el ejemplar del cliente", async () => {
    await recortarAdjuntos(almacen, false);
    pasos = [];
    const [r] = await recortarAdjuntos(almacen, false);
    expect(r.accion).toBe("ya_estaba");
    expect(pasos).toEqual([]);
  });

  it("si no se puede apuntar, el informe sigue como estaba y no queda nada suelto", async () => {
    falla = "apuntar";
    const [r] = await recortarAdjuntos(almacen, false);
    expect(r).toMatchObject({ accion: "no_se_puede", motivo: "la base no contesta" });
    expect(docs[0].ruta).toBe("e/v/tacografo/E1-1.pdf");
    expect([...ficheros.keys()]).toEqual(["e/v/tacografo/E1-1.pdf"]);
    expect(pasos).not.toContain("borrar e/v/tacografo/E1-1.pdf");
  });

  it("si no se puede borrar el antiguo, el informe ya enseña el recortado y se avisa", async () => {
    falla = "borrar";
    const [r] = await recortarAdjuntos(almacen, false);
    expect(r.accion).toBe("recortado");
    expect(r.aviso).toContain("no se ha podido borrar");
    expect(docs[0].ruta).toBe("e/v/tacografo/E1-1-cliente.pdf");
  });

  it("sin ejemplar del cliente no se toca, y se dice por qué", async () => {
    ficheros.set("e/v/tacografo/E1-1.pdf", await informe("E1", ["taller"]));
    const [r] = await recortarAdjuntos(almacen, false);
    expect(r.accion).toBe("no_se_puede");
    expect(r.motivo).toContain("Ejemplar para el cliente");
    expect(pasos).toEqual([]);
  });

  it("un fichero que ya no está en el almacén no detiene a los demás", async () => {
    docs.push({ id: "d2", ruta: "e/v/tacografo/perdido.pdf", nombre: "perdido.pdf", idOrigen: "E2", matricula: null });
    const r = await recortarAdjuntos(almacen, false);
    expect(r.map((x) => x.accion).sort()).toEqual(["no_se_puede", "recortado"]);
  });

  it("sin intervención enlazada vale el número de orden del propio PDF", async () => {
    docs[0].idOrigen = null;
    const [r] = await recortarAdjuntos(almacen, false);
    expect(r).toMatchObject({ accion: "recortado", idOrigen: "E1" });
  });
});

describe("rutaDelRecortado", () => {
  it("cuelga «-cliente» antes de la extensión", () => {
    expect(rutaDelRecortado("a/b/E1-17.pdf")).toBe("a/b/E1-17-cliente.pdf");
    expect(rutaDelRecortado("a/b/sin-extension")).toBe("a/b/sin-extension-cliente.pdf");
  });
});
