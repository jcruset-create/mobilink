import type { Tech, TechStatus } from "./workshopTypes";

export type ScheduledTechStatus = {
  id: string;
  techName: string;
  status: TechStatus;
  startDate: string;
  endDate: string;
  label?: string;
  notes?: string;
  createdAtMs: number;
  workshopId?: string | null;
};

const SCHEDULED_TECH_STATUSES_KEY = "scheduledTechStatuses";

export const SCHEDULED_TECH_STATUS_OPTIONS: TechStatus[] = [
  "vacaciones",
  "baja",
  "permiso",
  "nodisponible",
  "otro_taller",
  "disponible",
];

export function getTodayDateValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

export function loadScheduledTechStatuses(): ScheduledTechStatus[] {
  try {
    if (typeof window === "undefined") return [];

    const raw = window.localStorage.getItem(SCHEDULED_TECH_STATUSES_KEY);

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item) => {
      return (
        item &&
        typeof item.id === "string" &&
        typeof item.techName === "string" &&
        typeof item.status === "string" &&
        typeof item.startDate === "string" &&
        typeof item.endDate === "string"
      );
    });
  } catch {
    return [];
  }
}

export function saveScheduledTechStatuses(items: ScheduledTechStatus[]) {
  try {
    if (typeof window === "undefined") return;

    window.localStorage.setItem(
      SCHEDULED_TECH_STATUSES_KEY,
      JSON.stringify(items)
    );
  } catch {
    // No rompemos la app si localStorage falla.
  }
}

export function isDateInRange({
  dateValue,
  startDate,
  endDate,
}: {
  dateValue: string;
  startDate: string;
  endDate: string;
}) {
  if (!dateValue || !startDate || !endDate) return false;

  return dateValue >= startDate && dateValue <= endDate;
}

export function getScheduledStatusForTech({
  techName,
  scheduledStatuses,
  dateValue = getTodayDateValue(),
}: {
  techName: string;
  scheduledStatuses: ScheduledTechStatus[];
  dateValue?: string;
}): ScheduledTechStatus | null {
  const normalizedName = techName.trim().toLowerCase();

  const matches = scheduledStatuses
    .filter((item) => item.techName.trim().toLowerCase() === normalizedName)
    .filter((item) =>
      isDateInRange({
        dateValue,
        startDate: item.startDate,
        endDate: item.endDate,
      })
    )
    .sort((a, b) => b.createdAtMs - a.createdAtMs);

  return matches[0] ?? null;
}

/**
 * Estado programado del técnico que YA TERMINÓ y coincide con el estado que
 * tiene guardado. Sirve para detectar un estado caducado: si a Alejandro le
 * pusieron vacaciones del 1 al 8 y hoy es 9, su ficha no debería seguir
 * diciendo "vacaciones".
 */
export function getExpiredScheduledStatusForTech({
  techName,
  status,
  scheduledStatuses,
  dateValue = getTodayDateValue(),
}: {
  techName: string;
  status: TechStatus;
  scheduledStatuses: ScheduledTechStatus[];
  dateValue?: string;
}): ScheduledTechStatus | null {
  const normalizedName = techName.trim().toLowerCase();

  const matches = scheduledStatuses
    .filter((item) => item.techName.trim().toLowerCase() === normalizedName)
    .filter((item) => item.status === status)
    .filter((item) => String(item.endDate || "") < dateValue)
    .sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)));

  return matches[0] ?? null;
}

export function applyScheduledStatusesToTechs({
  techs,
  scheduledStatuses,
  dateValue = getTodayDateValue(),
}: {
  techs: Tech[];
  scheduledStatuses: ScheduledTechStatus[];
  dateValue?: string;
}): Tech[] {
  return techs.map((tech) => {
    const scheduled = getScheduledStatusForTech({
      techName: tech.name,
      scheduledStatuses,
      dateValue,
    });

    // Sin estado vigente hoy: si el técnico se quedó con el estado de un rango
    // que YA TERMINÓ, se le devuelve a disponible. Ese estado se le grabó al
    // aplicar el rango y nada lo revertía al acabarse, así que gente que ya
    // había vuelto seguía saliendo de vacaciones o de permiso para siempre.
    // Un estado puesto a mano (sin ningún rango que lo explique) no se toca.
    if (!scheduled) {
      const caducado = getExpiredScheduledStatusForTech({
        techName: tech.name,
        status: tech.status,
        scheduledStatuses,
        dateValue,
      });

      if (!caducado) return tech;

      return {
        ...tech,
        status: "disponible",
        blocked: false,
      };
    }

    const isUnavailableStatus =
      scheduled.status === "vacaciones" ||
      scheduled.status === "baja" ||
      scheduled.status === "permiso" ||
      scheduled.status === "nodisponible" ||
      scheduled.status === "otro_taller";

    return {
      ...tech,
      status: scheduled.status,
      blocked: isUnavailableStatus,
      currentJobId: isUnavailableStatus ? null : tech.currentJobId,
    };
  });
}

export function createScheduledTechStatus({
  techName,
  status,
  startDate,
  endDate,
  label,
  notes,
  workshopId,
}: {
  techName: string;
  status: TechStatus;
  startDate: string;
  endDate: string;
  label?: string;
  notes?: string;
  workshopId?: string | null;
}): ScheduledTechStatus {
  return {
    id: `scheduled-tech-status-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`,
    techName,
    status,
    startDate,
    endDate,
    label,
    notes,
    workshopId: workshopId ?? null,
    createdAtMs: Date.now(),
  };
}