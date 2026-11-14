/*
 * Qué OTF salen en cada pestaña del menú lateral (`components/MenuOtf.tsx`).
 *
 *   Programadas      → planificadas (también las que esperan a una asistencia),
 *                      la fecha programada más cercana primero; sin fecha, al final.
 *   Activas          → en curso.
 *   Últimas cerradas → finalizadas o canceladas, la más reciente primero (30).
 *   Sin pestaña      → todas, como antes.
 */

import type { PestanaOtf } from "../components/MenuOtf";

type OtfLista = {
  status?: string | null;
  fechaProgramadaMs?: number | null;
  createdAtMs?: number | null;
  updatedAtMs?: number | null;
};

export const MAX_CERRADAS = 30;

export const TITULO_PESTANA: Record<PestanaOtf, string> = {
  nueva: "Nueva OTF",
  programadas: "Programadas",
  activas: "Activas",
  cerradas: "Últimas cerradas",
  historial: "Historial",
};

export function leerPestana(valor: string | null): PestanaOtf | null {
  return valor && valor in TITULO_PESTANA ? (valor as PestanaOtf) : null;
}

export function otfDeLaPestana<T extends OtfLista>(lista: T[], pestana: PestanaOtf | null): T[] {
  if (pestana === "programadas") {
    return lista
      .filter((o) => o.status === "planificada")
      .sort((a, b) => {
        const fa = a.fechaProgramadaMs ?? Number.POSITIVE_INFINITY;
        const fb = b.fechaProgramadaMs ?? Number.POSITIVE_INFINITY;
        return fa !== fb ? fa - fb : (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0);
      });
  }
  if (pestana === "activas") return lista.filter((o) => o.status === "en_curso");
  if (pestana === "cerradas") {
    return lista
      .filter((o) => o.status === "finalizada" || o.status === "cancelada")
      .sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))
      .slice(0, MAX_CERRADAS);
  }
  return lista;
}
