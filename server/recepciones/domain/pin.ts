/**
 * La política del PIN del operario. Código PURO: se prueba con números.
 *
 * El PIN identifica a QUIEN CUENTA la mercancía, que casi nunca es quien tiene
 * la sesión de Mobilink abierta. Cuatro dígitos son 10.000 combinaciones: sin
 * freno, probarlas todas es cuestión de minutos. Por eso cada fallo cuenta y a
 * los cinco el operario queda bloqueado un rato; un acierto lo pone a cero.
 *
 * El bloqueo es por operario, no por sesión ni por IP: lo que se protege es la
 * firma de una persona concreta, y quien lo intenta está delante del mismo
 * tablet que el resto.
 */

/** Ni menos de 4 (adivinable) ni más de 8 (nadie lo recuerda en el muelle). */
export const PIN_MIN = 4;
export const PIN_MAX = 8;

export const INTENTOS_MAX = 5;
export const BLOQUEO_MS = 5 * 60_000;

/** Un PIN válido: sólo dígitos, y de la longitud pactada. */
export function pinValido(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

/** ¿Sigue bloqueado a esta hora? */
export function estaBloqueado(bloqueadoHasta: Date | null, ahora: Date = new Date()): boolean {
  return bloqueadoHasta !== null && bloqueadoHasta.getTime() > ahora.getTime();
}

/**
 * Lo que toca guardar tras un intento fallido: los fallos acumulados y, al
 * llegar al tope, hasta cuándo queda bloqueado. Al bloquear se vuelve a cero,
 * para que el siguiente bloqueo pida otros cinco fallos y no caiga al primero.
 */
export function trasFallo(intentos: number, ahora: Date = new Date()): { intentos: number; bloqueadoHasta: Date | null } {
  const n = Math.max(0, intentos) + 1;
  if (n < INTENTOS_MAX) return { intentos: n, bloqueadoHasta: null };
  return { intentos: 0, bloqueadoHasta: new Date(ahora.getTime() + BLOQUEO_MS) };
}

/** Cuántos minutos faltan, para decírselo a quien está delante. */
export function minutosRestantes(bloqueadoHasta: Date, ahora: Date = new Date()): number {
  return Math.max(1, Math.ceil((bloqueadoHasta.getTime() - ahora.getTime()) / 60_000));
}
