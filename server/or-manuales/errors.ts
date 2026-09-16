/**
 * El error de negocio del módulo, en un fichero propio.
 *
 * Misma razón que en Recepciones, Therefore y Cash: `domain/` es puro y no
 * puede importar `db.ts`, que revienta al cargarse si falta `DATABASE_URL`.
 * Una función que decide si un rango de OR es válido tiene que poder decir
 * «esto no vale» sin arrastrar una conexión a PostgreSQL.
 */

/** Error que el router traduce a un 4xx con código; el resto son 500. */
export class ErrorOrManuales extends Error {
  constructor(
    readonly codigo: string,
    message: string,
    readonly estado = 400,
    readonly detalle?: unknown
  ) {
    super(message);
    this.name = "ErrorOrManuales";
  }
}
