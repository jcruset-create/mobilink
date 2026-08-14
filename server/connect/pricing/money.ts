/**
 * Aritmética decimal del motor de tarifas.
 *
 * En coma flotante binaria 0,1 + 0,2 no es 0,3. Sumando cien líneas de
 * factura el error se acumula hasta que se ve en el total, y entonces alguien
 * tiene que explicar por qué la factura no cuadra con la suma de sus líneas.
 *
 * Aquí el dinero es un entero escalado a cuatro decimales (diezmilésimas), en
 * `bigint`, que en JavaScript es exacto. Cuatro decimales porque un precio por
 * kilómetro o un porcentaje de descuento los necesita; las líneas se redondean
 * a dos al cerrarse.
 *
 * No se añade ninguna dependencia: la aritmética que hace falta es sumar,
 * restar, multiplicar por una cantidad y aplicar un porcentaje.
 */

/** Importe en diezmilésimas de la unidad monetaria. */
export type Dinero = bigint;

export const DECIMALES = 4;
export const ESCALA = 10n ** BigInt(DECIMALES);
export const CERO: Dinero = 0n;

/**
 * Convierte texto o número a Dinero.
 *
 * Acepta texto porque node-postgres devuelve NUMERIC como texto para no
 * perder precisión, y ese texto es la fuente de verdad: pasarlo por `Number`
 * antes de tiempo desharía justamente lo que se quiere conservar.
 *
 * Devuelve null si no es un importe reconocible. Null significa DESCONOCIDO,
 * no cero: un taller sin tarifa de compra no cuesta cero euros.
 */
export function aDinero(valor: string | number | null | undefined): Dinero | null {
  if (valor == null || valor === "") return null;

  const texto = String(valor).trim();
  const m = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(texto);
  if (!m) return null;

  const signo = m[1] === "-" ? -1n : 1n;
  const entero = BigInt(m[2]);
  // Se recorta a los decimales que se guardan; no se redondea hacia arriba
  // porque el origen es un dato ya fijado, no el resultado de una operación.
  const decimales = (m[3] ?? "").slice(0, DECIMALES).padEnd(DECIMALES, "0");
  return signo * (entero * ESCALA + BigInt(decimales));
}

/** Igual que `aDinero`, pero exige que el valor exista. */
export function exigirDinero(valor: string | number | null | undefined, campo: string): Dinero {
  const d = aDinero(valor);
  if (d == null) throw new Error(`Importe no válido en ${campo}: ${String(valor)}`);
  return d;
}

/** Texto con los decimales pedidos, listo para guardar o mostrar. */
export function formatear(d: Dinero, decimales = 2): string {
  const redondeado = redondearA(d, decimales);
  const negativo = redondeado < 0n;
  const abs = negativo ? -redondeado : redondeado;
  const entero = abs / ESCALA;
  const resto = (abs % ESCALA).toString().padStart(DECIMALES, "0").slice(0, decimales);
  const signo = negativo ? "-" : "";
  return decimales > 0 ? `${signo}${entero}.${resto}` : `${signo}${entero}`;
}

/** División entera con redondeo al más cercano; el 0,5 se aleja del cero. */
function dividirRedondeando(numerador: bigint, denominador: bigint): bigint {
  if (denominador === 0n) throw new Error("División por cero en el cálculo de importes");
  const negativo = (numerador < 0n) !== (denominador < 0n);
  const a = numerador < 0n ? -numerador : numerador;
  const b = denominador < 0n ? -denominador : denominador;
  const q = (a * 2n + b) / (b * 2n);
  return negativo ? -q : q;
}

/** Redondea a un número de decimales, manteniendo la escala interna. */
export function redondearA(d: Dinero, decimales: number): Dinero {
  if (decimales >= DECIMALES) return d;
  const factor = 10n ** BigInt(DECIMALES - decimales);
  return dividirRedondeando(d, factor) * factor;
}

/** Redondeo a céntimos: lo que se hace al cerrar cada línea. */
export const redondearCentimos = (d: Dinero): Dinero => redondearA(d, 2);

export function sumar(...valores: Dinero[]): Dinero {
  return valores.reduce((a, b) => a + b, CERO);
}

export function restar(a: Dinero, b: Dinero): Dinero {
  return a - b;
}

/**
 * Importe × cantidad, donde la cantidad viene también escalada.
 * Ejemplo: 1,25 €/km × 25 km.
 */
export function multiplicar(importe: Dinero, cantidad: Dinero): Dinero {
  return dividirRedondeando(importe * cantidad, ESCALA);
}

/** Porcentaje de un importe: `porcentaje(331 €, 50 %) = 165,50 €`. */
export function porcentaje(importe: Dinero, pct: Dinero): Dinero {
  return dividirRedondeando(importe * pct, ESCALA * 100n);
}

/**
 * Qué porcentaje representa `parte` sobre `total`, escalado como los demás
 * valores. Devuelve null si el total es cero: un margen sobre cero no es cero,
 * es indeterminado, y presentarlo como 0 % engañaría.
 */
export function porcentajeDe(parte: Dinero, total: Dinero): Dinero | null {
  if (total === 0n) return null;
  return dividirRedondeando(parte * 100n * ESCALA, total);
}

/** Número corriente (km, minutos, unidades) a la escala interna. */
export function aCantidad(n: number): Dinero {
  if (!Number.isFinite(n)) throw new Error(`Cantidad no válida: ${n}`);
  return BigInt(Math.round(n * Number(ESCALA)));
}

/** Vuelta a número, solo para presentar o para métricas. Nunca para calcular. */
export function aNumero(d: Dinero): number {
  return Number(d) / Number(ESCALA);
}
