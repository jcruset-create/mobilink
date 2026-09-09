// Quién NO puede coger trabajo ahora mismo y por qué.
//
// El operativo enseña quién está trabajando y quién está libre, pero el resto
// del plantel —vacaciones, baja, permiso, otro taller— simplemente no aparecía:
// desde la pantalla no había forma de saber si a alguien le faltaba por fichar
// o es que estaba de baja. Lógica pura para poder probarla aislada.

import { isManualUnavailableStatus } from "./techSync";
import type { ScheduledTechStatus } from "./techStatusScheduleHelpers";
import type { Tech } from "./workshopTypes";

export const ETIQUETA_NO_DISPONIBLE: Record<string, string> = {
  vacaciones: "Vacaciones",
  baja: "Baja",
  permiso: "Permiso",
  nodisponible: "No disponible",
  otro_taller: "En otro taller",
  en_otro_taller: "En otro taller",
  "en otro taller": "En otro taller",
};

export type TecnicoNoDisponible = {
  name: string;
  /** Estado en crudo, para elegir color. */
  status: string;
  /** Motivo legible ("Vacaciones", "Bloqueado"…). */
  motivo: string;
  /** Fechas del estado programado que lo cubre hoy, si viene de la agenda. */
  desde?: string;
  hasta?: string;
};

/**
 * Estado programado que cubre hoy a ese técnico. Si hay varios (solapes), se
 * queda con el que termina más tarde: es el que de verdad marca la vuelta.
 */
export function estadoProgramadoDeHoy(
  estados: ScheduledTechStatus[],
  techName: string,
  hoy: string
): ScheduledTechStatus | null {
  const candidatos = estados.filter(
    (e) =>
      e &&
      String(e.techName || "").trim() === techName &&
      String(e.startDate || "") <= hoy &&
      hoy <= String(e.endDate || "")
  );

  if (candidatos.length === 0) return null;

  return candidatos.reduce((mejor, actual) =>
    String(actual.endDate) > String(mejor.endDate) ? actual : mejor
  );
}

export function tecnicosNoDisponibles({
  techs,
  trabajando,
  estadosProgramados = [],
  hoy,
  bloqueadoEnOtroTaller,
}: {
  techs: Tech[];
  /** Nombres que ya salen en TRABAJANDO: esos no son "no disponibles". */
  trabajando: string[];
  estadosProgramados?: ScheduledTechStatus[];
  hoy: string;
  bloqueadoEnOtroTaller?: (techName: string) => boolean;
}): TecnicoNoDisponible[] {
  const ocupados = new Set(trabajando);

  const lista: TecnicoNoDisponible[] = [];

  for (const tech of techs) {
    const name = String(tech?.name || "").trim();
    if (!name || ocupados.has(name)) continue;

    const status = String(tech.status || "").toLowerCase().trim();

    if (isManualUnavailableStatus(status)) {
      const programado = estadoProgramadoDeHoy(estadosProgramados, name, hoy);

      lista.push({
        name,
        status,
        motivo: ETIQUETA_NO_DISPONIBLE[status] ?? status,
        desde: programado?.startDate,
        hasta: programado?.endDate,
      });

      continue;
    }

    if (bloqueadoEnOtroTaller?.(name)) {
      lista.push({
        name,
        status: "otro_taller",
        motivo: "Mantenimiento en otro taller",
      });

      continue;
    }

    if (tech.blocked) {
      lista.push({ name, status: "bloqueado", motivo: "Bloqueado" });
    }
  }

  return lista.sort((a, b) => a.name.localeCompare(b.name, "es"));
}
