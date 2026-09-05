/**
 * Teléfonos: normalizar y comparar. Sin base de datos, para poder probarlo solo.
 */

/**
 * Deja un teléfono en su forma comparable: solo los NUEVE últimos dígitos.
 *
 * Sirve para responder a una única pregunta —¿son el mismo número?— y por eso
 * se queda con lo que de verdad identifica una línea española, ignorando cómo
 * lo haya escrito cada uno: `+34 600 11 22 33`, `0034-600112233` y
 * `(600) 112233` son el mismo.
 *
 * No pretende ser una librería telefónica. Un número extranjero de más de
 * nueve dígitos se compara por sus nueve últimos, que puede dar un falso
 * positivo teórico; el coste de equivocarse aquí es no mandar una segunda
 * encuesta, y el de equivocarse al revés es mandarle dos al mismo. La
 * asimetría manda.
 */
export function normalizarTelefono(valor: unknown): string | null {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  if (digitos.length < 9) return null;
  return digitos.slice(-9);
}

/** ¿Son la misma línea? */
export function mismoTelefono(a: unknown, b: unknown): boolean {
  const x = normalizarTelefono(a);
  const y = normalizarTelefono(b);
  return x != null && y != null && x === y;
}

