/**
 * Cuánto hace de la posición, calculado al LEER y no al escribir.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * `antiguedad_min` se guardaba en la fila, y era la única razón por la que un
 * vehículo quieto necesitaba que se le reescribiera la fila cada cinco
 * minutos: el estado no cambiaba, la base tampoco, la posición tampoco… pero
 * «hace 5 min» tenía que pasar a «hace 10 min».
 *
 * Es un número derivado: sale de restar `posicion_at` a la hora de ahora. Al
 * calcularlo aquí, en la lectura, la fila deja de tener que reescribirse, y de
 * paso el dato es MÁS fiel: lo guardado era «cuánto hacía en el último
 * barrido» y esto es «cuánto hace ahora mismo». Entre una cosa y otra puede
 * haber los cinco minutos del barrido.
 *
 * ── Lo que no se toca ──────────────────────────────────────────────────────
 *
 * Si la fila no tiene `posicion_at` no hay de dónde restar, y entonces se
 * respeta lo que hubiera guardado en `antiguedad_min`. Es el caso del vehículo
 * del que nunca ha llegado una posición fechada: no se inventa un cero, que
 * querría decir «acaba de reportar».
 */

/** Minutos entre un instante ISO y `ahora`. `null` si no hay instante válido. */
export function minutosDesde(iso: unknown, ahora: Date): number | null {
  if (iso == null) return null;
  const t = Date.parse(String(iso));
  if (Number.isNaN(t)) return null;
  // Nunca negativo: un reloj adelantado en el equipo no debe salir como
  // «dentro de 3 minutos».
  return Math.max(0, Math.round((ahora.getTime() - t) / 60_000));
}

/**
 * Devuelve las filas con `antiguedad_min` puesto al día.
 *
 * No modifica las que recibe: la lista que llega es la que va a la pantalla y
 * reescribirla por dentro es la clase de efecto que luego nadie encuentra.
 */
export function refrescarAntiguedad<T extends Record<string, unknown>>(
  filas: readonly T[],
  ahora: Date = new Date(),
): T[] {
  return filas.map((f) => {
    const min = minutosDesde(f.posicion_at, ahora);
    if (min == null) return { ...f };
    return { ...f, antiguedad_min: min };
  });
}
