import { esTecnicoDePrueba } from "./tecnicosDePrueba";
import { normalizeWorkshopId, getWorkshopById } from "./workshops";

/**
 * Qué técnicos salen cuando se mira un taller.
 *
 * ── El problema que resuelve ────────────────────────────────────────────────
 *
 * Ausencias y Planning sacaban TODOS los técnicos de la empresa mirara uno el
 * taller que mirase. En Reus salían los ocho de Tarragona con cero días de
 * todo, ocupando la pantalla y falseando el «técnicos fuera» de cada día.
 *
 * ── La regla, y su letra pequeña ────────────────────────────────────────────
 *
 * Cada técnico lleva su taller en la ficha (Personal → editar). Un técnico SIN
 * taller asignado cuenta como del taller por defecto, que es lo que hace
 * `normalizeWorkshopId` en todo el resto de la aplicación: no se inventa aquí
 * un criterio distinto, porque dos reglas para lo mismo acaban discrepando.
 *
 * Eso tiene una consecuencia que conviene saber: quien no esté asignado
 * expresamente a Reus aparecerá en Tarragona.
 */

/** El valor del selector cuando se quieren ver los dos talleres a la vez. */
export const TODOS_LOS_TALLERES = "todos";

export type TecnicoConTaller = {
  nombre: string;
  /** Nombre corto del taller, para enseñarlo cuando se miran todos. */
  taller: string;
};

type FichaDeTecnico = { name?: string | null; activo?: boolean; workshopId?: unknown };

/**
 * Los técnicos que se enseñan, ya ordenados como vienen.
 *
 * `tallerId` admite `TODOS_LOS_TALLERES`, y entonces no se filtra por taller:
 * salen los de todos, cada uno con el suyo al lado.
 */
export function tecnicosDelTaller(
  fichas: FichaDeTecnico[],
  tallerId: string
): TecnicoConTaller[] {
  return fichas
    .filter((t) => t?.name && t.activo !== false && !esTecnicoDePrueba(t.name))
    .filter(
      (t) =>
        tallerId === TODOS_LOS_TALLERES ||
        normalizeWorkshopId(t.workshopId) === normalizeWorkshopId(tallerId)
    )
    .map((t) => ({
      nombre: String(t.name),
      taller: getWorkshopById(normalizeWorkshopId(t.workshopId)).shortName,
    }));
}

/** ¿Este estado programado cuenta en el taller que se está mirando? */
export function estadoCuentaEnTaller(
  estado: { workshopId?: unknown },
  tallerId: string
): boolean {
  if (tallerId === TODOS_LOS_TALLERES) return true;
  // Un estado guardado sin taller se considera del taller que se mira: así es
  // como se comportaba antes de que los estados llevaran taller.
  if (!estado.workshopId) return true;
  return normalizeWorkshopId(estado.workshopId) === normalizeWorkshopId(tallerId);
}
