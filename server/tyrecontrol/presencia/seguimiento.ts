/**
 * Qué vehículos cuentan en «Vehículos en bases».
 *
 * ── El agujero que tapa ─────────────────────────────────────────────────────
 *
 * El barrido ya se salta los vehículos dados de baja
 * (`BasePresenceService`: «los inactivos no se barren»), pero la tabla donde
 * escribe es un UPSERT: nunca borra. Un vehículo que deja de barrerse conserva
 * su última fila para siempre.
 *
 * Mientras eso solo pasaba al dar de baja, casi no se notaba: los 90 vehículos
 * inactivos de esta flota ya lo estaban antes del primer barrido, así que nunca
 * llegaron a tener fila. Con `en_seguimiento` es distinto: un vehículo que se
 * saca del mantenimiento integral YA TIENE su fila escrita, y ahí se queda. El
 * día que la oficina marque los primeros, seguirían contando en «N dentro» de
 * cada base y en los cuatro contadores de estado.
 *
 * ── Por qué se filtra al LEER y no solo al barrer ───────────────────────────
 *
 * Saltárselo en el barrido evita escribir filas nuevas y ahorra cuota del
 * proveedor, pero no limpia las que ya están. Y hay un segundo motivo, más
 * importante: entre que alguien marca un vehículo y pasa el siguiente barrido
 * hay hasta diez minutos. Filtrando al leer, deja de contar en cuanto se marca.
 *
 * ── Ante la duda, se enseña ─────────────────────────────────────────────────
 *
 * Solo se descarta lo que se sabe descartable: `activo === false` o
 * `en_seguimiento === false`. Si la fila no trae el vehículo —porque se borró,
 * o porque quien llama no pidió esas columnas— se queda. Esconder un vehículo
 * que sí hay que revisar es peor que contar uno de más: lo primero se nota
 * cuando ya no se ha revisado, y lo segundo se ve a simple vista.
 */

/** Lo que hace falta de cada fila para decidir. El resto da igual. */
export interface FilaConVehiculo {
  vehiculo?: { activo?: boolean | null; en_seguimiento?: boolean | null } | null;
}

/** ¿Esta fila cuenta? */
export function cuentaEnBases(fila: FilaConVehiculo | null | undefined): boolean {
  const v = fila?.vehiculo;
  if (!v) return true; // sin saber, se enseña
  if (v.activo === false) return false;
  if (v.en_seguimiento === false) return false;
  return true;
}

/** Lo que queda después de quitar lo que no cuenta, y cuántos se quitaron. */
export interface PresenciaFiltrada<T> {
  filas: T[];
  /**
   * Cuántos se han dejado fuera por estar fuera del mantenimiento integral.
   *
   * Se cuenta aparte de los dados de baja a propósito: un vehículo de baja no
   * sorprende a nadie, y uno «activo pero sin seguimiento» sí, porque sigue
   * saliendo en la lista de vehículos y en la telemática. La pantalla lo dice
   * para que nadie busque por qué no cuadra el número.
   */
  sinSeguimiento: number;
  /** Cuántos se han dejado fuera por estar dados de baja. */
  inactivos: number;
}

export function filtrarPresencia<T extends FilaConVehiculo>(filas: T[]): PresenciaFiltrada<T> {
  const out: T[] = [];
  let sinSeguimiento = 0;
  let inactivos = 0;
  for (const f of filas) {
    const v = f?.vehiculo;
    // El orden importa para el recuento: un vehículo de baja Y sin seguimiento
    // se cuenta como de baja, que es la razón más fuerte para no estar.
    if (v && v.activo === false) {
      inactivos += 1;
      continue;
    }
    if (v && v.en_seguimiento === false) {
      sinSeguimiento += 1;
      continue;
    }
    out.push(f);
  }
  return { filas: out, sinSeguimiento, inactivos };
}
