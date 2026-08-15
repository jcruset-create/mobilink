/**
 * Aritmética monetaria de Mobilink Cash.
 *
 * El dinero de una caja física es un entero de céntimos y nada más: no existe
 * ninguna pieza por debajo de 1 c, así que no hay nada que redondear y no hace
 * falta la escala de diezmilésimas de `server/connect/pricing/money.ts` (allí
 * sí, porque hay precios por kilómetro y porcentajes de descuento).
 *
 * Con enteros el algoritmo de cambio indexa directamente por importe y las
 * comprobaciones de cuadre son igualdades exactas, no comparaciones con
 * tolerancia. En coma flotante `0.1 + 0.2 !== 0.3`, y un arqueo que descuadra
 * por 0,000000004 € es un arqueo que nadie se cree.
 *
 * `number` es exacto para enteros hasta 2^53, muy por encima de cualquier caja.
 */

/** Importe en céntimos. Siempre entero; puede ser negativo (diferencias). */
export type Centimos = number;

export const CERO: Centimos = 0;

/** Techo defensivo: 100 millones de euros. Por encima es un error de entrada. */
const MAXIMO_CENTIMOS = 10_000_000_000;

export function esCentimosValido(valor: unknown): valor is Centimos {
  return (
    typeof valor === "number" &&
    Number.isSafeInteger(valor) &&
    Math.abs(valor) <= MAXIMO_CENTIMOS
  );
}

/** Exige un importe entero en céntimos; si no lo es, revienta con el campo. */
export function exigirCentimos(valor: unknown, campo: string): Centimos {
  if (!esCentimosValido(valor)) {
    throw new Error(`Importe no válido en ${campo}: ${String(valor)}`);
  }
  return valor;
}

/** Exige un importe entero en céntimos mayor que cero. */
export function exigirCentimosPositivos(valor: unknown, campo: string): Centimos {
  const c = exigirCentimos(valor, campo);
  if (c <= 0) throw new Error(`El importe de ${campo} debe ser mayor que cero`);
  return c;
}

/**
 * Convierte a céntimos un importe escrito por una persona o devuelto por la
 * base de datos.
 *
 * Acepta texto porque node-postgres devuelve NUMERIC como texto para no perder
 * precisión: pasarlo por `Number` antes de tiempo desharía justamente lo que se
 * quiere conservar. Acepta coma y punto porque el teclado del taller escribe
 * "12,50".
 *
 * Devuelve null si no es un importe reconocible. Null es DESCONOCIDO, no cero.
 */
export function aCentimos(valor: string | number | null | undefined): Centimos | null {
  if (valor == null || valor === "") return null;

  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return null;
    // El origen es un euro con decimales; se redondea al céntimo más cercano
    // porque un `number` como 18.699999999999996 tiene que acabar en 1870.
    const c = Math.round(valor * 100);
    return esCentimosValido(c) ? c : null;
  }

  const texto = valor.trim().replace(/\s|€/g, "");
  const m = /^(-?)(\d*)(?:[.,](\d{0,2}))?$/.exec(texto);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;

  const signo = m[1] === "-" ? -1 : 1;
  const euros = m[2] === "" ? 0 : Number(m[2]);
  const centimos = Number((m[3] ?? "").padEnd(2, "0"));
  const total = signo * (euros * 100 + centimos);
  return esCentimosValido(total) ? total : null;
}

/** Igual que `aCentimos`, pero exige que el valor exista y sea válido. */
export function exigirAcentimos(valor: string | number | null | undefined, campo: string): Centimos {
  const c = aCentimos(valor);
  if (c == null) throw new Error(`Importe no válido en ${campo}: ${String(valor)}`);
  return c;
}

/** "1.234,50" — para pantalla. Nunca para volver a calcular con el resultado. */
export function formatearEuros(c: Centimos): string {
  const negativo = c < 0;
  const abs = Math.abs(c);
  const enteros = Math.floor(abs / 100);
  const resto = String(abs % 100).padStart(2, "0");
  const miles = String(enteros).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}${miles},${resto}`;
}

/** "1234.50" — para guardar en un NUMERIC o mandar a una ERP. */
export function aTextoDecimal(c: Centimos): string {
  const negativo = c < 0;
  const abs = Math.abs(c);
  return `${negativo ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function sumar(...valores: Centimos[]): Centimos {
  return valores.reduce((a, b) => a + b, CERO);
}
