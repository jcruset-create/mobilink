/**
 * Cada cuánto se barre la presencia en bases, en minutos.
 *
 * Vive en su propio fichero, y no en `worker.ts`, para romper un ciclo: el
 * worker importa `barrido.ts`, que importa `bases.ts`, que necesita saber la
 * cadencia para decidir cuándo un hueco corta una estancia del histórico. Con
 * la constante en el worker, ese círculo se cierra y en ESM eso es una
 * constante todavía sin inicializar según quién cargue primero — un fallo de
 * arranque que no aparece en ninguna prueba unitaria.
 *
 * ── La cadencia y por qué esta ──────────────────────────────────────────────
 *
 * Diez minutos, y sale de la medición: en la cuenta real el 40 % de la flota
 * había emitido hace menos de 5 minutos y el 73 % hace menos de 15. Barrer más
 * a menudo no trae posiciones nuevas —el equipo aún no ha hablado— y sí gasta
 * cupo del proveedor; barrer cada media hora dejaría la pantalla enseñando un
 * autobús que ya se ha ido.
 *
 * Configurable por entorno para poder aflojarlo si un proveedor aprieta el
 * cupo, con suelo de 2 minutos: por debajo se estaría preguntando más deprisa
 * de lo que los equipos emiten.
 */
export const INTERVALO_MIN = Math.max(
  2,
  Number(process.env.PRESENCIA_BASES_MIN) || 10,
);
