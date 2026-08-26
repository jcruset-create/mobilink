/**
 * Importes de la ERP → céntimos exactos.
 *
 * Business Central da los importes como número decimal (`1234.56`) y el módulo
 * de caja trabaja con enteros de céntimos. La conversión evidente,
 * `Math.round(x * 100)`, **está mal**, y no de forma teórica: en coma flotante
 * hay valores que se van al céntimo de al lado. `1.005 * 100` da
 * `100.49999999999999`, que redondea a 100 en vez de a 101.
 *
 * Un céntimo de diferencia en un cobro no se nota; en el arqueo del día sí, y
 * lo peor es que nadie sabría de dónde salió. Por eso la conversión se hace
 * **sobre el texto**, separando parte entera y decimales, sin que el número
 * llegue a pasar por coma flotante.
 *
 * Se acepta también el número por si la ERP lo entrega ya deserializado, pero
 * lo preferible es pedirle el texto: en cuanto `JSON.parse` toca el valor, la
 * precisión que se pierda ya no se recupera.
 */

/** Céntimos exactos a partir de lo que dé la ERP. `null` si no es un importe. */
export function aCentimos(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;

  const texto = String(valor).trim().replace(/\s/g, "");
  if (texto === "") return null;

  // Se admite la coma como separador decimal: hay ERP que la entregan así según
  // la configuración regional de la empresa, y rechazarlo sería quedarse sin
  // importes por un detalle de formato.
  const normalizado = texto.replace(",", ".");

  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(normalizado);
  if (!m) return null;

  const [, signo, entera, decimales = ""] = m;
  if (entera === "" && decimales === "") return null;

  /*
   * Se toman DOS decimales y el tercero decide el redondeo, en decimal y no en
   * binario. `1.005` → entero 1, decimales "005" → 100 céntimos + el tercer
   * dígito es 5, así que sube a 101. Que es lo que cualquiera esperaría y lo
   * que la coma flotante no hace.
   */
  const dosPrimeros = (decimales + "00").slice(0, 2);
  const tercero = Number((decimales + "000")[2]);

  const centimos = Number(entera || "0") * 100 + Number(dosPrimeros) + (tercero >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(centimos)) return null;

  return signo === "-" ? -centimos : centimos;
}

/** Céntimos → el decimal que espera la ERP. Texto, para no perder precisión. */
export function aDecimal(centimos: number): string {
  const signo = centimos < 0 ? "-" : "";
  const abs = Math.abs(centimos);
  return `${signo}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
