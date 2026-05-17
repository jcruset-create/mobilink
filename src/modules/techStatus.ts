import type { Tech, TechStatus } from "./workshopTypes";
import { nowMs } from "./time";

export function normalizeTechStatusValue(status?: string | null) {
  return String(status || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_");
}

export function normalizeTechStatus(status?: string | null): TechStatus {
  const value = normalizeTechStatusValue(status);

  if (value === "disponible") return "disponible";
  if (value === "refuerzo") return "refuerzo";
  if (value === "ocupado") return "ocupado";
  if (value === "nodisponible") return "nodisponible";
  if (value === "permiso") return "permiso";
  if (value === "vacaciones") return "vacaciones";
  if (value === "baja") return "baja";
  if (value === "otro_taller") return "otro_taller";
  if (value === "en_otro_taller") return "otro_taller";
  if (value === "supervisor") return "supervisor";

  return "disponible";
}

export const HARD_BLOCKED_TECH_STATUSES = [
  "vacaciones",
  "baja",
  "otro_taller",
  "en_otro_taller",
  "permiso",
  "nodisponible",
];

export function isHardBlockedTechStatus(status?: string | null) {
  const normalized = String(status || "").toLowerCase().trim();

  return HARD_BLOCKED_TECH_STATUSES.includes(normalized);
}

export function canTechReceiveAutomaticWork(tech: Tech) {
  if (isHardBlockedTechStatus(tech.status)) return false;
  if (tech.blocked) return false;
  if (tech.currentJobId != null) return false;

  const normalized = String(tech.status || "").toLowerCase().trim();

  return (
    normalized === "disponible" ||
    normalized === "refuerzo" ||
    normalized === "supervisor"
  );
}

export function canTechBeProposedForJob(tech: Tech) {
  return canTechReceiveAutomaticWork(tech);
}

export function isUnavailableTechStatus(status?: string | null) {
  const normalized = normalizeTechStatusValue(status);

  return [
    "nodisponible",
    "no_disponible",
    "vacaciones",
    "baja",
    "permiso",
    "otro_taller",
    "en_otro_taller",
  ].includes(normalized);
}

export function isTechUnavailableForAssignment(tech: Tech) {
  return (
    tech.blocked ||
    isUnavailableTechStatus(tech.status) ||
    tech.status === "baja" ||
    tech.status === "vacaciones" ||
    tech.status === "permiso" ||
    tech.status === "otro_taller" ||
    tech.status === "nodisponible"
  );
}

export function getTechStatusLabel(status: TechStatus) {
  if (status === "disponible") return "Disponible";
  if (status === "ocupado") return "Ocupado";
  if (status === "refuerzo") return "Refuerzo";
  if (status === "nodisponible") return "No disponible";
  if (status === "supervisor") return "Supervisor";
  if (status === "vacaciones") return "Vacaciones";
  if (status === "baja") return "Baja";
  if (status === "permiso") return "Permiso";
  if (status === "otro_taller") return "En otro taller";
  return status;
}

export function getTechStatusColor(status: TechStatus) {
  if (status === "disponible" || status === "supervisor") {
    return "bg-green-50 border-green-200 text-green-700";
  }

  if (status === "ocupado") {
    return "bg-red-50 border-red-200 text-red-700";
  }

  if (status === "refuerzo") {
    return "bg-amber-50 border-amber-200 text-amber-700";
  }

  if (status === "vacaciones") {
    return "bg-sky-50 border-sky-200 text-sky-700";
  }

  if (status === "baja") {
    return "bg-rose-50 border-rose-200 text-rose-700";
  }

  if (status === "permiso") {
    return "bg-violet-50 border-violet-700";
  }

  if (status === "otro_taller") {
    return "bg-indigo-50 border-indigo-200 text-indigo-700";
  }

  return "bg-slate-50 border-slate-200 text-slate-700";
}

export function updateTechStatusTotals(
  tech: Tech,
  nextStatus: TechStatus,
  changedAtMs = nowMs()
): Tech {
  const previousChangedAtMs = tech.statusChangedAtMs ?? changedAtMs;
  const elapsedMinutes = Math.max(
    0,
    Math.round((changedAtMs - previousChangedAtMs) / 60000)
  );

  const previousStatus = tech.status;
  const previousTotals = tech.statusTotals ?? {};

  const shouldClearCurrentJob =
    nextStatus === "disponible" ||
    nextStatus === "supervisor" ||
    isUnavailableTechStatus(nextStatus);

  return {
    ...tech,
    status: nextStatus,
    blocked: isUnavailableTechStatus(nextStatus),
    currentJobId: shouldClearCurrentJob ? null : tech.currentJobId,
    statusChangedAtMs: changedAtMs,
    statusTotals: {
      ...previousTotals,
      [previousStatus]: (previousTotals[previousStatus] ?? 0) + elapsedMinutes,
    },
  };
}

export function getTechMinutesInStatus(tech: Tech, status: TechStatus) {
  const base = tech.statusTotals?.[status] ?? 0;

  if (tech.status !== status || !tech.statusChangedAtMs) {
    return base;
  }

  const current = Math.max(
    0,
    Math.round((nowMs() - tech.statusChangedAtMs) / 60000)
  );

  return base + current;
}