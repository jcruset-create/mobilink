/**
 * Una OTF ESPERA mientras la asistencia de carretera por la que espera siga
 * abierta. Se deduce, no se guarda: en cuanto el operario cierra la
 * asistencia, la OTF deja de esperar sola. Los estados cerrados son los mismos
 * que usa la cola de asistencias (`estadoCerrado` en colaEspera.ts).
 *
 * Es un trozo de SQL para poder usarlo en los listados, en el check-in manual
 * y en el automático por GPS con la MISMA regla; `o` es el alias de `otf`.
 */
export const OTF_EN_ESPERA_SQL = `(o."esperaAsistenciaId" IS NOT NULL AND EXISTS (
  SELECT 1 FROM roadside_assistances ra
   WHERE ra.id = o."esperaAsistenciaId"
     AND ra.status NOT IN ('llegada_taller','cancelada','redirigida')))`;
