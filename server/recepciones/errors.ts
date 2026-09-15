/**
 * El error de negocio del módulo Recepciones, en un fichero propio.
 *
 * Misma razón que en Therefore y en Mobilink Cash: el dominio es puro y no
 * importa `db.ts`, que revienta al cargarse si no hay `DATABASE_URL`. Una
 * función que decide si una cantidad es válida tiene que poder decir «esto no
 * vale» sin arrastrar una conexión a PostgreSQL.
 */

/** Error que el router traduce a un 4xx con código; el resto son 500. */
export class ErrorRecepciones extends Error {
  constructor(
    readonly codigo: string,
    message: string,
    readonly estado = 400,
    readonly detalle?: unknown
  ) {
    super(message);
    this.name = "ErrorRecepciones";
  }
}
