/**
 * El error de negocio de Mobilink Cash, en un módulo propio.
 *
 * Vivía dentro de `repository.ts`, y eso obligaba a cualquiera que quisiera
 * lanzar un 4xx a importar el pool de la base de datos de rebote. Un ayudante
 * puro —recortar una imagen, formatear un importe— no tiene por qué arrastrar
 * una conexión a Postgres solo para poder decir "esto no vale".
 *
 * `repository.ts` lo sigue reexportando, así que los imports antiguos siguen
 * funcionando y no hay dos sitios donde mirar.
 */

/** Error que la API traduce a un 4xx con código; el resto son 500. */
export class ErrorCaja extends Error {
  constructor(
    readonly codigo: string,
    message: string,
    readonly estado = 400,
    readonly detalle?: unknown
  ) {
    super(message);
    this.name = "ErrorCaja";
  }
}
