/**
 * Pasar el subrayador por el PDF de verdad.
 *
 * Se abre el original, se pintan rectángulos amarillos translúcidos sobre las
 * cajas que dice `domain/documento/resaltado.ts` y se devuelve un fichero
 * NUEVO. El original no se toca nunca: es el documento que mandó el proveedor
 * y es la prueba de lo que decía.
 *
 * ── Translúcido, no opaco ───────────────────────────────────────────────────
 *
 * El amarillo va con transparencia para que el texto se siga leyendo por
 * debajo, como un rotulador. Un rectángulo opaco taparía justo lo que se
 * quiere enseñar.
 *
 * ── Las páginas giradas no se pintan ────────────────────────────────────────
 *
 * Las coordenadas que da el lector son de la página TAL Y COMO SE VE, y las de
 * PDF van desde abajo y sin girar. Con la página derecha la conversión es una
 * resta; con `/Rotate 90` hay que girar también el rectángulo, y no se ha visto
 * todavía ninguna factura así. Pintar a ciegas es peor que no pintar: el
 * amarillo caería sobre otro albarán. Esas páginas se devuelven intactas y el
 * resultado dice cuántas fueron.
 */

import { PDFDocument, rgb } from "pdf-lib";
import type { CajaResaltada } from "../domain/documento/resaltado.ts";
import type { DocumentoTexto } from "../domain/documento/tipos.ts";

/** Amarillo de rotulador. */
const AMARILLO = rgb(1, 0.93, 0.15);
const OPACIDAD_BLOQUE = 0.32;
/** El número del albarán, más marcado: es lo que se busca al abrirlo. */
const OPACIDAD_NUMERO = 0.55;

export type Resaltado = {
  pdf: Buffer;
  cajasPintadas: number;
  /** Páginas que se han dejado intactas por venir giradas. */
  paginasGiradas: number[];
};

export async function pintarResaltado(
  original: Buffer,
  cajas: CajaResaltada[],
  doc: DocumentoTexto
): Promise<Resaltado> {
  const pdf = await PDFDocument.load(original, { ignoreEncryption: true });
  const paginas = pdf.getPages();
  const altoLeido = new Map(doc.paginas.map((p) => [p.numero, p.alto]));

  let cajasPintadas = 0;
  const giradas = new Set<number>();

  for (const caja of cajas) {
    const pagina = paginas[caja.pagina - 1];
    if (!pagina) continue;

    if (pagina.getRotation().angle % 360 !== 0) {
      giradas.add(caja.pagina);
      continue;
    }

    /*
     * El alto que manda es el que leyó el parser, que es contra el que están
     * medidas las cajas. Si por lo que sea no lo tuviéramos, el de la página
     * sirve: en un PDF sin girar son el mismo número.
     */
    const alto = altoLeido.get(caja.pagina) ?? pagina.getSize().height;

    pagina.drawRectangle({
      x: caja.x,
      y: alto - (caja.y + caja.h),
      width: caja.w,
      height: caja.h,
      color: AMARILLO,
      opacity: caja.tipo === "NUMERO" ? OPACIDAD_NUMERO : OPACIDAD_BLOQUE,
      borderWidth: 0,
    });
    cajasPintadas++;
  }

  return {
    pdf: Buffer.from(await pdf.save()),
    cajasPintadas,
    paginasGiradas: [...giradas].sort((a, b) => a - b),
  };
}
