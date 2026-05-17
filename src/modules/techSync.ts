import type { Job, Tech, TechStatus } from "./workshopTypes";

export function isManualUnavailableStatus(status: string) {
  return (
    status === "nodisponible" ||
    status === "permiso" ||
    status === "vacaciones" ||
    status === "baja" ||
    status === "otro_taller" ||
    status === "en_otro_taller" ||
    status === "en otro taller"
  );
}

export function applyManualTechStatusOverrides(techsToApply: Tech[]): Tech[] {
  return techsToApply;
}

export function syncTechsWithActiveJobs(baseTechs: Tech[], jobs: Job[]): Tech[] {
  const activeJobs = jobs.filter((job) => job.status === "activo");

  const synced: Tech[] = baseTechs.map((tech): Tech => {
    if (isManualUnavailableStatus(tech.status)) {
      return {
        ...tech,
        blocked: true,
        currentJobId: null,
      };
    }

    const activeJob = activeJobs.find((job) =>
      (job.assignedNames ?? []).includes(tech.name)
    );

    if (!activeJob) {
      return {
        ...tech,
        status:
          tech.status === "supervisor"
            ? "supervisor"
            : ("disponible" as TechStatus),
        currentJobId: null,
        blocked: tech.status === "supervisor",
      };
    }

    const index = (activeJob.assignedNames ?? []).indexOf(tech.name);

    return {
      ...tech,
      currentJobId: activeJob.id,
      status: index === 0 ? "ocupado" : "refuerzo",
      blocked: false,
    };
  });

  return applyManualTechStatusOverrides(synced);
}