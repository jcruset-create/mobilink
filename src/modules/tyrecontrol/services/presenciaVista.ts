/**
 * Cómo se ordena y agrupa lo que enseña «Vehículos en bases».
 *
 * Vive fuera del componente porque son decisiones con criterio —a quién se
 * enseña primero, qué cuenta como «dentro»— y eso merece pruebas, no un
 * `useMemo` que nadie puede comprobar.
 */

import type { RevisionEstado } from "../types";
import type { VehiculoPresencia } from "./presenciaBases";

/**
 * Prioridad de una revisión: cuanto menor, más arriba.
 *
 * Nunca revisado va antes que vencida, y vencida antes que próxima. El nunca
 * revisado primero no es un capricho: de ese no se sabe ni cómo está, y es el
 * que más se arriesga a irse de la base sin que nadie le haya mirado nada.
 */
export function prioridadRevision(estado: string | undefined): number {
  if (estado === "sin_revision") return 0;
  if (estado === "vencida") return 1;
  if (estado === "proxima") return 2;
  return 3;
}

/** ¿Tiene este vehículo algo pendiente que justifique cogerlo ahora? */
export function tieneRevisionPendiente(rev: RevisionEstado | undefined): boolean {
  return rev?.estado === "sin_revision" || rev?.estado === "vencida" || rev?.estado === "proxima";
}

/**
 * Los que están DENTRO de una base con posición reciente, por base.
 *
 * `STALE_POSITION` no entra, y es la decisión importante de este módulo: su
 * última posición cae dentro de la base y probablemente sigan ahí, pero
 * «probablemente» no es a quien se manda buscar al patio. Se cuentan aparte
 * con `dormidosPorBase`.
 */
export function agruparPorBase(
  vehiculos: VehiculoPresencia[],
  revisiones: Map<string, RevisionEstado>,
): Map<string, VehiculoPresencia[]> {
  const m = new Map<string, VehiculoPresencia[]>();
  for (const v of vehiculos) {
    if (v.estado !== "IN_BASE" || !v.delegacion_id) continue;
    const lista = m.get(v.delegacion_id) ?? [];
    lista.push(v);
    m.set(v.delegacion_id, lista);
  }
  for (const lista of m.values()) {
    lista.sort((a, b) => {
      const pa = prioridadRevision(revisiones.get(a.vehiculo_id)?.estado);
      const pb = prioridadRevision(revisiones.get(b.vehiculo_id)?.estado);
      if (pa !== pb) return pa - pb;
      // A igualdad, el que lleva más tiempo en la base: ese ya está aparcado,
      // no acabando de entrar.
      return (a.entrada_base_at ?? "") < (b.entrada_base_at ?? "") ? -1 : 1;
    });
  }
  return m;
}

/** Cuántos, por base, tienen la última posición dentro pero ya vieja. */
export function dormidosPorBase(vehiculos: VehiculoPresencia[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of vehiculos) {
    if (v.estado !== "STALE_POSITION" || !v.delegacion_id) continue;
    m.set(v.delegacion_id, (m.get(v.delegacion_id) ?? 0) + 1);
  }
  return m;
}

/**
 * En base AHORA y con revisión pendiente: la lista que justifica la pantalla.
 *
 * Ordenados por prioridad y, dentro de ella, por lo vencido que esté: el que
 * lleva 40 días de retraso antes que el que lleva 3.
 */
export function revisablesEnBase(
  vehiculos: VehiculoPresencia[],
  revisiones: Map<string, RevisionEstado>,
): VehiculoPresencia[] {
  return vehiculos
    .filter((v) => v.estado === "IN_BASE" && tieneRevisionPendiente(revisiones.get(v.vehiculo_id)))
    .sort((a, b) => {
      const pa = prioridadRevision(revisiones.get(a.vehiculo_id)?.estado);
      const pb = prioridadRevision(revisiones.get(b.vehiculo_id)?.estado);
      if (pa !== pb) return pa - pb;
      const da = revisiones.get(a.vehiculo_id)?.dias_vencido ?? 0;
      const db = revisiones.get(b.vehiculo_id)?.dias_vencido ?? 0;
      return db - da;
    });
}

/** Cuánto lleva desde un instante, en palabras. `—` si no hay instante. */
export function desde(iso: string | null | undefined, ahora = Date.now()): string {
  if (!iso) return "—";
  const ms = ahora - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${min % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Una antigüedad en minutos, redondeada a la unidad que se lee mejor. */
export function minutosEnPalabras(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/**
 * Una fecha de revisión, corta y en castellano. `—` si no hay ninguna.
 *
 * La ausencia se enseña como raya y no como «nunca»: el distintivo de al lado
 * ya dice «Sin revisión», y repetirlo con otras palabras en la misma línea no
 * añade nada.
 */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}
