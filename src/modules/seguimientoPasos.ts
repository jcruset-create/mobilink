/**
 * Cuándo se alcanzó cada paso del seguimiento de una asistencia.
 *
 * Vive aparte de la página porque es la única parte con reglas de verdad —qué
 * columna corresponde a cada estado, qué hacer cuando falta— y así se puede
 * probar sin montar React.
 */

import type {
  RoadsideAssistance,
  RoadsideAssistanceStatus,
} from "./roadsideAssistanceTypes";

/**
 * La columna con la marca de tiempo de cada estado.
 *
 * Cada estado tiene la suya, así que la hora sale de ahí y no de contar
 * eventos. Es la misma fecha que la ficha ya enseña en «Salida» y «Llegada al
 * punto»: de este modo no puede haber dos horas distintas para lo mismo en la
 * misma pantalla.
 */
export const HORA_DEL_PASO: Record<
  RoadsideAssistanceStatus,
  (a: RoadsideAssistance) => number | null | undefined
> = {
  pendiente: (a) => a.createdAtMs,
  asignada: (a) => a.assignedAtMs,
  en_camino: (a) => a.departedAtMs,
  en_punto: (a) => a.arrivedAtPointMs,
  inicio_reparacion: (a) => a.inicioReparacionAtMs,
  finalizada: (a) => a.finishedAtMs,
  en_camino_base: (a) => a.enCaminoBaseAtMs,
  llegada_taller: (a) => a.arrivedAtWorkshopMs,
  redirigida: (a) => a.redirectedAtMs,
  cancelada: (a) => a.cancelledAtMs,
};

export type EventoSeguimiento = {
  status: RoadsideAssistanceStatus;
  createdAtMs: number;
};

/**
 * La hora de un paso, con el registro de eventos como respaldo.
 *
 * Hay asistencias antiguas cuya columna quedó a nulo pero que sí dejaron el
 * evento. Del respaldo se toma la PRIMERA vez que se entró en ese estado: si
 * una asistencia se redirigió y volvió a pasar por «En camino», lo que cuenta
 * en una barra de progreso es cuándo se llegó ahí, no la última repetición.
 *
 * Devuelve `null` cuando no hay ni columna ni evento. La pantalla no pinta
 * nada en ese caso: un «-» en cada paso futuro llenaría la rejilla de guiones
 * sin decir nada que el gris no diga ya.
 */
export function horaDelPaso(
  status: RoadsideAssistanceStatus,
  assistance: RoadsideAssistance,
  events: EventoSeguimiento[] = [],
): number | null {
  const propia = HORA_DEL_PASO[status]?.(assistance);
  if (propia) return propia;
  return events
    .filter((e) => e.status === status)
    .reduce<number | null>(
      (min, e) => (min == null || e.createdAtMs < min ? e.createdAtMs : min),
      null,
    );
}
