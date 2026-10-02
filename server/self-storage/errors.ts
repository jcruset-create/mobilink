/**
 * El error de negocio de Self Storage, en un fichero propio.
 *
 * Misma razón que en Recepciones y Cash: el dominio es puro y no importa
 * `db.ts`, que revienta al cargarse sin `DATABASE_URL`. Una regla que decide si
 * un precio es válido tiene que poder decir «esto no vale» sin arrastrar una
 * conexión a PostgreSQL.
 */

/** Error que el router traduce a un 4xx con código; el resto son 500. */
export class ErrorSelfStorage extends Error {
  constructor(
    readonly codigo: string,
    message: string,
    readonly estado = 400,
    readonly detalle?: unknown
  ) {
    super(message);
    this.name = "ErrorSelfStorage";
  }
}

/** «No existe» y «no es tuyo» contestan igual (ARCHITECTURE.md §3). */
export const noExiste = (que: string) => new ErrorSelfStorage("NO_EXISTE", `${que} no existe.`, 404);
