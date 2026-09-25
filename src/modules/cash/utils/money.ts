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
 * Acepta coma y punto porque el teclado del mostrador escribe "12,50", y
 * **acepta el punto de los miles**, que es por donde se rompía: «1.797,00» daba
 * null, y con null el botón de confirmar decía «0,00 €» y no dejaba registrar
 * el cobro. Todo lo que llegaba a mil euros era incobrable desde la pantalla.
 *
 * Devuelve null si no es un importe: null es DESCONOCIDO, no cero, y la
 * pantalla tiene que poder distinguir «no ha escrito nada» de «ha escrito 0».
 *
 * ── Cómo se deshace la ambigüedad ────────────────────────────────────────────
 *
 * Es la misma pregunta que en la lectura del ERP —¿el punto separa decimales o
 * miles?— y aquí se responde con reglas, no adivinando:
 *
 * · **Si hay coma, la coma manda**: es el decimal y los puntos son miles.
 *   «1.797,00» → 1797,00. Sin excepciones.
 * · **Sin coma, decide cuántas cifras van tras el último punto.** Tres es
 *   siempre separador de miles, porque un importe no tiene tres decimales:
 *   «1.797» → 1797,00. Una o dos son decimales: «12.5» → 12,50.
 * · **Lo mezclado se rechaza.** «1,797.00» —formato inglés— no se interpreta:
 *   devolver null y que alguien lo escriba otra vez es barato; equivocarse por
 *   un factor de mil, no.
 */
export function aCentimos(texto: string): number | null {
  const limpio = texto.trim().replace(/\s|€/g, "");
  if (!limpio) return null;

  const signo = limpio.startsWith("-") ? -1 : 1;
  const cuerpo = limpio.replace(/^-/, "");
  if (!cuerpo) return null;

  let enteros: string;
  let decimales: string;

  if (cuerpo.includes(",")) {
    const partes = cuerpo.split(",");
    // Dos comas no es un importe, es un error de tecleo.
    if (partes.length !== 2) return null;
    enteros = partes[0]!;
    decimales = partes[1]!;
  } else {
    const trozos = cuerpo.split(".");
    const ultimo = trozos[trozos.length - 1]!;
    if (trozos.length > 1 && ultimo.length === 3) {
      // Tres cifras tras el punto: son miles. Un importe no tiene 3 decimales.
      enteros = cuerpo;
      decimales = "";
    } else if (trozos.length > 1) {
      enteros = trozos.slice(0, -1).join(".");
      decimales = ultimo;
    } else {
      enteros = cuerpo;
      decimales = "";
    }
  }

  /*
   * Los puntos que queden en la parte entera son separadores de miles, y se
   * exige que estén DONDE TOCA: «1.797» sí, «17.97» no. Sin esta comprobación,
   * «17.97,5» se colaría como 1797,50 — un factor de cien sobre lo que alguien
   * quiso escribir.
   */
  if (enteros.includes(".")) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(enteros)) return null;
    enteros = enteros.replace(/\./g, "");
  }

  if (enteros !== "" && !/^\d+$/.test(enteros)) return null;
  if (decimales !== "" && !/^\d{1,2}$/.test(decimales)) return null;
  if (enteros === "" && decimales === "") return null;

  const e = enteros === "" ? 0 : Number(enteros);
  const c = decimales === "" ? 0 : Number(decimales.padEnd(2, "0"));
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

/**
 * Fecha contable de una jornada, para pantalla.
 *
 * El servidor la devuelve unas veces como `YYYY-MM-DD` y otras como el
 * timestamp entero que da el driver de Postgres, y en Informes salía tal cual:
 * «2026-08-18T00:00:00.000Z» en una columna que solo quiere el día. Se recorta
 * y se escribe como se lee en España.
 *
 * No se construye un `Date`: la fecha de la jornada es un día del calendario,
 * no un instante, y pasarla por la zona horaria del navegador la correría un
 * día en cuanto alguien abriera la pantalla desde otro huso.
 */
export function fechaJornada(valor: string | null | undefined): string {
  const dia = (valor ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return dia;
  const [anio, mes, d] = dia.split("-");
  return `${d}/${mes}/${anio}`;
}
