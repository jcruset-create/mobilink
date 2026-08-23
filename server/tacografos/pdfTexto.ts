/**
 * Extrae el texto de un PDF generado por este módulo.
 *
 * Existe **para las pruebas**: es lo que permite afirmar qué acaba dentro del
 * papel —la modalidad marcada, el nombre de quien recibe, los siete datos del
 * acta— en vez de comprobar sólo que el fichero se genera.
 *
 * Vive aquí y no dentro de un fichero de pruebas porque lo usan dos, y porque
 * tiene dos trampas que ya costaron un rato:
 *
 *  · pdf-lib escribe las cadenas en **hexadecimal** (`<434F4D...> Tj`), no
 *    entre paréntesis.
 *  · avanzar un byte tras `endstream` vuelve a encontrar la «stream» que lleva
 *    dentro, y el siguiente tramo se come la página siguiente.
 *
 * No es un extractor de PDF de propósito general: sirve para lo que este
 * módulo escribe, y nada más.
 */

import { inflateSync } from "node:zlib";

export function extraerTextoPdf(pdf: Buffer): string {
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
    desde = fin + "endstream".length;
  }

  return (trozos.join("\n").match(/<([0-9A-Fa-f]+)>\s*Tj/g) ?? [])
    .map((t) => Buffer.from(t.slice(1, t.indexOf(">")), "hex").toString("latin1"))
    .join(" ");
}
