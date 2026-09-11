/**
 * Cuándo se considera terminado un servicio.
 *
 * Vive aparte de `finalizacion.ts` por una razón concreta: aquello importa
 * `db.ts`, que revienta al cargarse si no hay `DATABASE_URL`. Esta regla es
 * pura y no necesita base de datos, así que separándola se puede probar en CI
 * sin levantar PostgreSQL. `finalizacion.ts` la reexporta, de modo que quien la
 * importe de allí sigue funcionando igual.
 */

/**
 * ¿Ha terminado el servicio?
 *
 * **Se mira `finishedAtMs`, nunca `status === "finalizada"`.** En la ruta de la
 * APK ese estado dura un instante: justo después una auto-transición deja la
 * asistencia en `en_camino_base`. Cualquier cosa que se despierte un segundo
 * más tarde y pregunte por el estado no encontraría ninguna asistencia
 * finalizada, y no porque no las haya.
 *
 * `finishedAtMs` se pone una vez y no se quita, así que es el hecho: el
 * servicio terminó a esa hora.
 */
export function estaFinalizada(a: { finishedAtMs?: unknown } | null | undefined): boolean {
  const ms = Number(a?.finishedAtMs ?? 0);
  return Number.isFinite(ms) && ms > 0;
}
