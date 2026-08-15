/**
 * Formateo de dinero en la interfaz.
 *
 * Espejo de `server/cash/domain/money.ts`. La regla es la misma a los dos lados
 * de la red: **se calcula en céntimos enteros y solo se formatea al pintar**.
 * En cuanto un importe pasa por un `parseFloat` para hacer una suma, aparecen
 * los 18,699999999999996 y un arqueo que no cuadra por nada.
 */

/** "1.234,50 €" */
export function euros(centimos: number): string {
  const negativo = centimos < 0;
  const abs = Math.abs(centimos);
  const enteros = Math.floor(abs / 100);
  const resto = String(abs % 100).padStart(2, "0");
  const miles = String(enteros).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}${miles},${resto} €`;
}

/** Como `euros`, pero con el signo delante también en positivo (diferencias). */
export function eurosConSigno(centimos: number): string {
  return centimos > 0 ? `+${euros(centimos)}` : euros(centimos);
}

/**
 * Lee un importe escrito por una persona y lo pasa a céntimos.
 *
 * Acepta coma y punto porque el teclado del mostrador escribe "12,50". Devuelve
 * null si no es un importe: null es DESCONOCIDO, no cero, y la pantalla tiene
 * que poder distinguir "no ha escrito nada" de "ha escrito 0".
 */
export function aCentimos(texto: string): number | null {
  const limpio = texto.trim().replace(/\s|€/g, "");
  if (!limpio) return null;

  const m = /^(-?)(\d*)(?:[.,](\d{0,2}))?$/.exec(limpio);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;

  const signo = m[1] === "-" ? -1 : 1;
  const e = m[2] === "" ? 0 : Number(m[2]);
  const c = Number((m[3] ?? "").padEnd(2, "0"));
  const total = signo * (e * 100 + c);
  return Number.isSafeInteger(total) ? total : null;
}

/** Céntimos a texto editable ("18700" → "187,00"). */
export function aTextoEditable(centimos: number): string {
  const negativo = centimos < 0;
  const abs = Math.abs(centimos);
  return `${negativo ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Suma de líneas de denominación, en céntimos. Nunca con decimales. */
export function totalLineas(lineas: readonly { valor: number; cantidad: number }[]): number {
  return lineas.reduce((a, l) => a + l.valor * l.cantidad, 0);
}

/** Número de piezas: lo que distingue 100 € en billete de 100 € en monedas. */
export function totalPiezas(lineas: readonly { valor: number; cantidad: number }[]): number {
  return lineas.reduce((a, l) => a + l.cantidad, 0);
}
