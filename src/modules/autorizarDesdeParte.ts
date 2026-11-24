/**
 * Elegir y autorizar a los técnicos desde Partes de trabajo, sin pasar por
 * «Pendientes de validar» de Operativo 2.
 *
 * La propuesta la sigue haciendo el motor de asignación de siempre; aquí se
 * deja cambiarla (responsable y apoyos) y se decide si se puede autorizar ya:
 * las mismas reglas que el botón «✓ Autorizar» del operativo, puras y
 * probadas aparte.
 */

import { buildAuthorizedJob } from "./jobValidation";
import { isTechUnavailableForAssignment } from "./techStatus";
import type { Job, Tech, TechStatus } from "./workshopTypes";

/** Por qué un técnico no puede empezar ahora, o null si está libre. */
export function motivoNoLibre(tech: Tech): string | null {
  if (isTechUnavailableForAssignment(tech)) return "no está disponible";
  if (tech.currentJobId != null) return "ya está en otro trabajo";
  if (tech.status !== "disponible") return "no está libre ahora";
  return null;
}

/** «Iván (libre)» / «José (ya está en otro trabajo)», para los desplegables. */
export function etiquetaDeTecnico(tech: Tech): string {
  const motivo = motivoNoLibre(tech);
  return motivo ? `${tech.name} (${motivo})` : `${tech.name} (libre)`;
}

/** Libres primero, luego el resto; dentro de cada grupo por nombre. */
export function tecnicosParaElegir(techs: Tech[]): Tech[] {
  return [...techs]
    .filter((t) => t?.name)
    .sort((a, b) => {
      const la = motivoNoLibre(a) ? 1 : 0;
      const lb = motivoNoLibre(b) ? 1 : 0;
      return la - lb || a.name.localeCompare(b.name, "es");
    });
}

/**
 * ¿Se puede autorizar ya con estos técnicos? Devuelve el motivo si no.
 * El primero es el responsable; los demás, apoyo.
 */
export function motivoNoAutorizable(
  asignados: string[],
  techs: Tech[],
  area: string,
  movilExigeFurgoneta = true
): string | null {
  if (asignados.length === 0) return "Elige al menos el responsable.";
  if (area === "movil" && movilExigeFurgoneta) return "Los trabajos de Móvil necesitan furgoneta: autorízalos desde Operativo 2.";
  for (const nombre of asignados) {
    const tech = techs.find((t) => t.name === nombre);
    if (!tech) return `${nombre} ya no existe como técnico.`;
    const motivo = motivoNoLibre(tech);
    if (motivo) return `${nombre} ${motivo}.`;
  }
  return null;
}

/** Responsable nuevo: va primero; si ya estaba de apoyo, deja de estarlo. */
export function conResponsable(asignados: string[], responsable: string): string[] {
  if (!responsable) return asignados.slice(1);
  return [responsable, ...asignados.slice(1).filter((n) => n !== responsable)];
}

export function conApoyo(asignados: string[], apoyo: string): string[] {
  if (!apoyo || asignados.includes(apoyo)) return asignados;
  if (asignados.length === 0) return [apoyo];
  return [...asignados, apoyo];
}

export function sinApoyo(asignados: string[], apoyo: string): string[] {
  return asignados.filter((n, i) => i === 0 || n !== apoyo);
}

/**
 * El trabajo autorizado y los técnicos tal y como quedan: responsable
 * ocupado, apoyos de refuerzo, todos con el trabajo como actual. Igual que
 * authorizeProposedJob en el operativo.
 */
export function autorizar(
  job: Job,
  asignados: string[],
  techs: Tech[],
  ahoraMs: number
): { job: Job; techs: Tech[] } {
  const base: Job = { ...job, assignedNames: asignados, status: "validacion" };
  const autorizado = buildAuthorizedJob(base, ahoraMs) as Job;
  const tocados = techs
    .filter((t) => asignados.includes(t.name))
    .map((t) => ({
      ...t,
      status: (asignados[0] === t.name ? "ocupado" : "refuerzo") as TechStatus,
      currentJobId: job.id,
    }));
  return { job: autorizado, techs: tocados };
}
