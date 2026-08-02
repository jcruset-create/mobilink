/**
 * Clasificación de una asistencia en cola operativa.
 *
 * Vive aquí y no en cada endpoint porque la usan dos pantallas: el tablero del
 * centro de control y las colas a pantalla completa. Si cada una decidiera por
 * su cuenta, la misma asistencia podría aparecer en "activas" en un sitio y en
 * "atención" en el otro.
 */

export type Cola = "pending" | "assigning" | "active" | "attention";

export const COLAS: Cola[] = ["pending", "assigning", "active", "attention"];

export const ETIQUETAS_COLA: Record<Cola, string> = {
  pending: "Pendientes",
  assigning: "En asignación",
  active: "Activas",
  attention: "Atención",
};

/** Estados que ya no están en juego: no entran en ninguna cola. */
export const ESTADOS_CERRADOS = ["finished", "at_workshop", "cancelled"];

export interface ClasificacionCola {
  cola: Cola;
  /** Quedan menos de 15 min para el límite de SLA. */
  slaRisk: boolean;
  /** El límite de SLA ya ha pasado. */
  slaBreached: boolean;
}

/**
 * Un SLA incumplido manda a "atención" aunque el servicio esté en marcha: es
 * lo que la central tiene que mirar primero.
 */
export function clasificarCola(
  a: { status: string; slaDeadlineAtMs: number | string | null | undefined },
  now = Date.now(),
): ClasificacionCola {
  const limite = a.slaDeadlineAtMs != null ? Number(a.slaDeadlineAtMs) : null;
  const slaRisk = limite != null && limite - now < 15 * 60_000;
  const slaBreached = limite != null && limite < now;

  let cola: Cola;
  if (["assignment_failed", "no_coverage"].includes(a.status) || slaBreached) cola = "attention";
  else if (["draft", "pending"].includes(a.status)) cola = "pending";
  else if (["searching", "awaiting_acceptance"].includes(a.status)) cola = "assigning";
  else cola = "active";

  return { cola, slaRisk, slaBreached };
}
