/**
 * Dejar un texto en algo que la fuente del PDF sepa escribir.
 *
 * pdf-lib con las fuentes estándar (Helvetica) codifica en WinAnsi y LANZA
 * ante el primer carácter que no está en esa tabla. Un nombre con una flecha
 * pegada tiraría la generación del informe entero, así que hay que limpiar.
 *
 * ── Lo que esto arregla ─────────────────────────────────────────────────────
 *
 * La limpieza anterior era `[^\x20-\x7E -ÿ€]`: ASCII imprimible, Latin-1 y el
 * euro. Parecía prudente y se llevaba por delante la RAYA, «—», que es
 * justamente lo que los informes escriben cuando un dato no se sabe. En la
 * hoja del patio se veía así:
 *
 *     ULTIMA REVISION        LA HIZO
 *     (nada)                 (nada)
 *
 * Una etiqueta sin nada debajo no dice «no se sabe»: parece un fallo de
 * impresión, y quien lo lee no distingue el dato que falta del que no se ha
 * medido. WinAnsi SÍ tiene la raya —y el guion corto, las comillas
 * tipográficas, los puntos suspensivos y el bolo—; estaban en el rango
 * 0x80–0x9F, que la expresión anterior no contemplaba.
 *
 * Lo que de verdad no se puede escribir se SUSTITUYE cuando hay un
 * equivalente razonable («→» por «->»), y solo se borra lo que no tiene
 * ninguno. Borrar en silencio es el último recurso, no el primero.
 */

/** Los que WinAnsi tiene en 0x80–0x9F y no están en Latin-1. */
const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/** Lo que no se puede escribir pero sí se puede decir de otra manera. */
const EQUIVALENTES: Record<string, string> = {
  "→": "->", "←": "<-", "↔": "<->", "⇒": "=>",
  "×": "x", "·": "·", "≤": "<=", "≥": ">=", "≠": "!=",
  " ": " ", " ": " ", " ": " ", "​": "",
  "\t": " ", "\n": " ", "\r": " ",
};

const PERMITIDO = new RegExp(`[^\\x20-\\x7E\\xA0-\\xFF${WINANSI_EXTRA}]`, "g");

/**
 * El texto listo para `drawText`.
 *
 * Nunca lanza y nunca devuelve `undefined`: un informe no se cae por un
 * carácter raro en el nombre de un técnico.
 */
export function limpiarParaPdf(s: string | null | undefined): string {
  let t = String(s ?? "");
  for (const [de, a] of Object.entries(EQUIVALENTES)) t = t.split(de).join(a);
  // El 0xA0 (espacio duro) ya se ha cambiado arriba; lo que quede fuera de
  // la tabla y sin equivalente se va.
  return t.replace(PERMITIDO, "");
}
