import type { Job, Tech, TechStatus } from "./workshopTypes";
import { getOperationLabel } from "./jobHelpers";
import { normalizeWorkshopId, type WorkshopId } from "./workshops";

export function removeSupportFromPreviousJob(tech: Tech, jobs: Job[]): Job[] {
  if (tech.currentJobId == null) return jobs;

  return jobs.map((job) => {
    if (job.id !== tech.currentJobId) return job;
    if (!job.assignedNames.includes(tech.name)) return job;

    const index = job.assignedNames.indexOf(tech.name);

    // Nunca tocar si era responsable
    if (index === 0) return job;

    const nextAssignedNames = job.assignedNames.filter((n) => n !== tech.name);

    let nextReason = job.reason;

    if (job.area === "camion") {
      nextReason =
        nextAssignedNames.length >= 2
          ? "Camión asignado con 1 responsable y 1 apoyo disponible."
          : "Camión asignado con 1 responsable.";
    } else {
      nextReason = `${getOperationLabel(job)} sin refuerzo por reasignación automática.`;
    }

    return {
      ...job,
      assignedNames: nextAssignedNames,
      reason: nextReason,
    };
  });
}

export function applyAssignmentToTechs(
  assignedNames: string[],
  job: Job,
  techs: Tech[]
): Tech[] {
  return techs.map((tech) => {
    const idx = assignedNames.indexOf(tech.name);
    if (idx === -1) return tech;
    const isMain = idx === 0;
    return {
      ...tech,
      status: (isMain ? "ocupado" : "refuerzo") as TechStatus,
      currentJobId: job.id,
    };
  });
}

export function belongsToWorkshop(
  item: { workshopId?: string | null },
  selectedWorkshopId: WorkshopId
) {
  return normalizeWorkshopId(item.workshopId) === selectedWorkshopId;
}
