/**
 * Error del módulo Tacógrafos, con código estable y estado HTTP.
 *
 * En fichero propio y sin ninguna importación: lo lanzan tanto los módulos que
 * tocan la base como el importador de PDF, que no la toca — y cargar `db.ts`
 * sin `DATABASE_URL` tumba el proceso, así que las pruebas del importador no
 * podían ni arrancar en un contenedor sin base.
 */
export class ErrorTacografos extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
    readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ErrorTacografos";
  }
}
