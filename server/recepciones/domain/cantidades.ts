/**
 * Aritmética de cantidades: pedida, expedida, recibida y lo que queda.
 *
 * Código puro. Las cantidades son NUMERIC(12,3) en la base y llegan como
 * texto desde `pg`; aquí se trabaja con números ya convertidos. Tres
 * decimales porque hay proveedores que sirven por peso o por metros; los
 * neumáticos van en unidades enteras y así se validan cuando la línea lo dice.
 */

import { ErrorRecepciones } from "../errors.ts";

/** Lo que aún no ha llegado de lo que el albarán dice que salió. */
export function pendienteDeRecibir(expedida: number, recibida: number): number {
  return redondear(Math.max(0, expedida - recibida));
}

/** Lo que el proveedor aún no ha mandado de lo pedido. */
export function pendienteDeExpedir(pedida: number, expedida: number): number {
  return redondear(Math.max(0, pedida - expedida));
}

/** Diferencia con signo: recibida − esperada. Negativa = falta. */
export function diferencia(esperada: number, recibida: number): number {
  return redondear(recibida - esperada);
}

/**
 * ¿Hay incidencia de recepción en esta línea?
 *
 * Sólo cuando lo recibido no coincide con lo que quedaba por recibir del
 * albarán. Que falte por EXPEDIR no cuenta: eso es un pedido a medias, no un
 * problema del muelle.
 */
export function esIncidenciaDeRecepcion(pendiente: number, recibida: number): boolean {
  return diferencia(pendiente, recibida) !== 0;
}

/** Tres decimales, sin arrastrar ruido de coma flotante. */
export function redondear(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Convierte lo que llegue (texto de `pg`, número del panel) en una cantidad
 * válida. Nunca negativa, nunca NaN. El nombre del campo va en el error para
 * que el panel sepa qué casilla corregir.
 */
export function cantidad(v: unknown, campo = "cantidad", opciones: { permitirCero?: boolean } = {}): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) {
    throw new ErrorRecepciones("CANTIDAD_INVALIDA", `${campo} no es una cantidad válida.`);
  }
  if (n === 0 && !opciones.permitirCero) {
    throw new ErrorRecepciones("CANTIDAD_INVALIDA", `${campo} tiene que ser mayor que cero.`);
  }
  return redondear(n);
}

/** Lo que devuelve `pg` para un NUMERIC: texto. Aquí se convierte una vez. */
export function numero(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
