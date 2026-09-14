import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { leerPdf, redibujarPdf, tieneTexto } from "./pdf.ts";
import { matriculaFalsa, sustituir } from "./anonimizar.ts";

/**
 * Fabrica un PDF con la forma de una factura de proveedor.
 *
 * Los valores son inventados. Lo que se prueba aquí es la MECÁNICA de leer y
 * redibujar, no un caso real: un lote de calibración de verdad sale de correos
 * reales y no se versiona (ver README.md).
 */
async function facturaDePrueba(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const alto = 842;
  const pagina = doc.addPage([595, alto]);

  const lineas: [string, number][] = [
    ["PROVEEDOR EJEMPLO, S.L.   NIF B12345674", 800],
    ["Albaran: ENT-770199-0501234   Fecha: 24/08/2026", 770],
    ["Referencia      Descripcion            Cant.  Precio  Dto.       Importe", 745],
    ["4400111222333   PASTILLA FRENO DELT.    1,00   77,50  60% + 10%    27,90", 725],
    ["4400111222444   DISCO DE FRENO TRAS.    2,00  155,00  40%         186,00", 705],
    ["Matricula: 4417KDT   Bastidor: WZ10A2BCDEF345678", 675],
    ["Albaran: ENT-770199-0501235   Fecha: 25/08/2026", 640],
    ["4400111222555   PASTILLA FRENO TRAS.    1,00   88,60  60% + 10%    31,90", 620],
    ["Total factura                                                    245,80", 80],
  ];
  for (const [texto, y] of lineas) {
    pagina.drawText(texto, { x: 40, y, size: 9, font });
  }
  return Buffer.from(await doc.save());
}

describe("leer la capa de texto", () => {
  it("saca las líneas con su página y su tamaño", async () => {
    const t = leerPdf(await facturaDePrueba());
    expect(t.paginas).toHaveLength(1);
    expect(t.paginas[0].alto).toBeCloseTo(842, 0);
    expect(tieneTexto(t)).toBe(true);
    expect(t.lineas.length).toBeGreaterThanOrEqual(9);
    expect(t.lineas.map((l) => l.texto).join("\n")).toContain("ENT-770199-0501234");
  });

  /*
   * mupdf mide desde ARRIBA. Una línea dibujada en y=800 sobre una página de
   * 842 tiene que leerse cerca de 42, no de 800. Es la comprobación que sujeta
   * el volteo de coordenadas del redibujado.
   */
  it("la Y viene medida desde arriba", async () => {
    const t = leerPdf(await facturaDePrueba());
    const arriba = t.lineas.find((l) => l.texto.includes("PROVEEDOR EJEMPLO"))!;
    const abajo = t.lineas.find((l) => l.texto.includes("Total factura"))!;
    expect(arriba.y).toBeLessThan(60);
    expect(abajo.y).toBeGreaterThan(750);
  });
});

describe("redibujar", () => {
  it("conserva el tamaño de la página y todas las líneas", async () => {
    const original = leerPdf(await facturaDePrueba());
    const copia = leerPdf(await redibujarPdf(original));

    expect(copia.paginas[0].ancho).toBeCloseTo(original.paginas[0].ancho, 0);
    expect(copia.paginas[0].alto).toBeCloseTo(original.paginas[0].alto, 0);
    expect(copia.lineas).toHaveLength(original.lineas.length);
  });

  /*
   * El fallo que no se ve al validar un JSON: si no se voltea la Y, el PDF sale
   * del revés y sólo se nota al abrirlo, cuando ya nadie mira. Aquí se
   * comprueba que lo de arriba sigue arriba.
   */
  it("cada línea vuelve a su sitio y no del revés", async () => {
    const original = leerPdf(await facturaDePrueba());
    const copia = leerPdf(await redibujarPdf(original));

    for (const l of original.lineas) {
      const misma = copia.lineas.find((c) => c.texto.trim() === l.texto.trim());
      expect(misma, `no está la línea «${l.texto}»`).toBeDefined();
      expect(Math.abs(misma!.y - l.y), `la línea «${l.texto}» se ha movido`).toBeLessThan(2);
      expect(Math.abs(misma!.x - l.x)).toBeLessThan(2);
    }
  });

  it("el orden vertical se mantiene", async () => {
    const copia = leerPdf(await redibujarPdf(leerPdf(await facturaDePrueba())));
    const y = (t: string) => copia.lineas.find((l) => l.texto.includes(t))!.y;
    expect(y("PROVEEDOR EJEMPLO")).toBeLessThan(y("ENT-770199-0501234"));
    expect(y("ENT-770199-0501234")).toBeLessThan(y("Total factura"));
  });
});

describe("redibujar anonimizando", () => {
  /*
   * La prueba que resume el encargo: de la factura desaparece la matrícula y
   * no se mueve ni un número que el parser tenga que leer.
   */
  it("quita lo identificativo y no toca ni un importe", async () => {
    const original = leerPdf(await facturaDePrueba());
    const mapa = {
      "PROVEEDOR EJEMPLO, S.L.": "PROVEEDOR UNO, S.L.",
      "4417KDT": matriculaFalsa("4417KDT"),
      "WZ10A2BCDEF345678": "SALVLBRVMVK2CXAJK",
      B12345674: "B00000000",
    };
    const anonimo = leerPdf(await redibujarPdf(original, (t) => sustituir(t, mapa)));
    const texto = anonimo.lineas.map((l) => l.texto).join("\n");

    // Lo identificativo, fuera.
    expect(texto).not.toContain("PROVEEDOR EJEMPLO");
    expect(texto).not.toContain("4417KDT");
    expect(texto).not.toContain("WZ10A2BCDEF345678");

    // Todo lo que el parser tiene que leer, intacto.
    for (const intacto of [
      "ENT-770199-0501234",
      "ENT-770199-0501235",
      "4400111222333",
      "77,50",
      "60% + 10%",
      "27,90",
      "186,00",
      "245,80",
      "24/08/2026",
    ]) {
      expect(texto, `se ha perdido ${intacto}`).toContain(intacto);
    }

    // Y sigue habiendo algo con forma de matrícula, que es lo que se prueba.
    expect(texto).toMatch(/\d{4}[BCDFGHJKLMNPRSTVWXYZ]{3}/);
  });
});
