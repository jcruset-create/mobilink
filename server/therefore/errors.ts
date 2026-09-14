/**
 * El error de negocio del módulo Therefore, en un fichero propio.
 *
 * Va aparte de `repository.ts` por la misma razón que en Mobilink Cash: el
 * dominio es puro y no importa `db.ts`, que revienta al cargarse si no hay
 * `DATABASE_URL`. Un ayudante que valida una transición de estado tiene que
 * poder decir «esto no vale» sin arrastrar una conexión a PostgreSQL, y sin
 * eso las pruebas de dominio no se podrían ejecutar en una máquina sin base.
 */

/** Error que el router traduce a un 4xx con código; el resto son 500. */
export class ErrorTherefore extends Error {
  constructor(
    readonly codigo: string,
    message: string,
    readonly estado = 400,
    readonly detalle?: unknown
  ) {
    super(message);
    this.name = "ErrorTherefore";
  }
}
