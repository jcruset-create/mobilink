/**
 * Las OTF (órdenes de trabajo de flota, de Assist) en Pantalla técnicos.
 *
 * Una OTF es un operario con la furgoneta en la base de un cliente haciendo
 * varios trabajos seguidos. Vivía solo en Assist, así que David salía
 * «disponible» en la TV mientras estaba de servicio. Aquí se decide qué OTF
 * cuentan como trabajo en curso, de quién son y cómo se escriben.
 */

export type OtfEnPantalla = {
  id: number;
  clientName?: string | null;
  baseName?: string | null;
  direccion?: string | null;
  status: string;
  assignedTechName?: string | null;
  assignedVehicleName?: string | null;
  fechaProgramadaMs?: number | null;
  arrivedAtBaseMs?: number | null;
  enEspera?: boolean;
  progreso?: { hechos: number; total: number } | null;
};

export const ETIQUETA_OTF: Record<string, string> = {
  planificada: "Planificada",
  en_curso: "En la base",
  finalizada: "Finalizada",
  cancelada: "Cancelada",
};

/** Las que salen en «Trabajos asignados»: con operario y sin terminar, y no a la espera de otra. */
export function otfsEnCurso(lista: OtfEnPantalla[]): OtfEnPantalla[] {
  return lista.filter(
    (o) => o.assignedTechName && (o.status === "planificada" || o.status === "en_curso") && !o.enEspera
  );
}

/**
 * La OTF que tiene AHORA a un técnico ocupado. Una OTF planificada con
 * operario ya le ocupa: ha salido con la furgoneta hacia la base aunque el
 * GPS todavía no la haya marcado «en la base».
 */
export function otfDelTecnico(lista: OtfEnPantalla[], techName: string): OtfEnPantalla | null {
  return otfsEnCurso(lista).find((o) => o.assignedTechName === techName) ?? null;
}

/** «OTF · Transbrugent · Base Constantí». */
export function textoDeOtf(o: OtfEnPantalla): string {
  return ["OTF", o.clientName, o.baseName || o.direccion].filter((x) => x && String(x).trim()).join(" · ");
}

export function progresoDeOtf(o: OtfEnPantalla): string {
  if (!o.progreso || !o.progreso.total) return "";
  return `${o.progreso.hechos}/${o.progreso.total} trabajos`;
}
