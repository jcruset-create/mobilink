/**
 * Qué versión del tarifario se aplica a un servicio.
 *
 * Es lo que hace que publicar el tarifario de 2027 no cambie el precio de una
 * asistencia de 2026. La versión se elige por la fecha del servicio —el
 * instante contractual, no el de hoy—, así que un servicio antiguo sigue
 * resolviéndose con el tarifario que estaba vigente cuando ocurrió, aunque
 * después se hayan publicado otros tres.
 *
 * Solo se miran las versiones PUBLICADAS: un borrador a medio cargar no puede
 * facturarse por accidente. Es el requisito de que una importación nunca pase
 * directamente a tarifa activa.
 */

export type EstadoVersion = "draft" | "published" | "archived";

export interface VersionTarifa {
  id: number;
  tariffPlanId: number;
  version: string;
  status: EstadoVersion;
  validFromMs: number;
  /** null = sin fecha de fin. */
  validToMs: number | null;
  priority: number;
}

export interface ResultadoVersion {
  version: VersionTarifa | null;
  avisos: string[];
  /** Las que también encajaban, para poder explicar el solapamiento. */
  solapadas: VersionTarifa[];
}

/** La vigencia incluye el inicio y excluye el fin, para que no se solapen. */
export function vigenteEn(v: VersionTarifa, atMs: number): boolean {
  if (v.status !== "published") return false;
  if (atMs < v.validFromMs) return false;
  return v.validToMs == null || atMs < v.validToMs;
}

/**
 * Orden total: prioridad, luego la que empieza más tarde —una corrección
 * publicada después manda sobre la anterior—, y el identificador como último
 * desempate.
 */
export function compararVersiones(a: VersionTarifa, b: VersionTarifa): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.validFromMs !== b.validFromMs) return b.validFromMs - a.validFromMs;
  return a.id - b.id;
}

export function seleccionarVersion(versiones: VersionTarifa[], atMs: number): ResultadoVersion {
  const vigentes = versiones.filter((v) => vigenteEn(v, atMs)).sort(compararVersiones);

  if (vigentes.length === 0) {
    return { version: null, avisos: ["NO_TARIFF_PLAN"], solapadas: [] };
  }

  const avisos: string[] = [];
  if (vigentes.length > 1) {
    /*
     * Dos versiones vigentes a la vez es un error de configuración: alguien
     * publicó la nueva sin cerrar la anterior. Se elige de forma determinista
     * para que el precio sea reproducible, pero tiene que verse.
     */
    avisos.push("OVERLAPPING_TARIFF_VERSIONS");
  }

  return { version: vigentes[0], avisos, solapadas: vigentes.slice(1) };
}
