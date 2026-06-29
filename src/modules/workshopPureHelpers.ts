import type { Tech, TechStatus } from "./workshopTypes";
import { isManualUnavailableStatus } from "./techSync";

export function timeToMinutes(time: string): number {
  const [hoursRaw, minutesRaw] = time.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }

  return hours * 60 + minutes;
}

export const MANUAL_TECH_STATUS_KEY = "manualTechStatusOverrides";

export function normalizeTechNameKey(name: string) {
  return name
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function getManualTechStatusOverrides(): Record<string, TechStatus> {
  try {
    const raw = localStorage.getItem(MANUAL_TECH_STATUS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function applyManualTechStatusOverrides(techsToApply: Tech[]): Tech[] {
  const overrides = getManualTechStatusOverrides();

  return techsToApply.map((tech) => {
    const key = normalizeTechNameKey(tech.name);
    const forcedStatus = overrides[key];

    if (!forcedStatus) return tech;

    return {
      ...tech,
      status: forcedStatus,
      blocked: isManualUnavailableStatus(forcedStatus),
      currentJobId: null,
    };
  });
}
