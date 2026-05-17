import type {
  AreaKey,
  AssignmentRole,
  CandidateOptions,
  CompetencyKey,
  Job,
  QuickTemplate,
  Tech,
  TechLoadStat,
} from "./workshopTypes";

import { AREA_META, MOBILE_MIN_RESERVED } from "./workshopConstants";

import { countReservedMobileCapacity } from "./techConfig";

import {
  isHardBlockedTechStatus,
  isTechUnavailableForAssignment,
} from "./techStatus";

import {
  getCompetencyTargetKey,
  getOperationKey,
  getQuickTemplateForJob,
} from "./jobHelpers";

export function isTechProposedInAnotherValidation(
  techName: string,
  currentJobId: number,
  jobsToCheck: Job[]
) {
  return jobsToCheck.some((job) => {
    if (job.id === currentJobId) return false;
    if (job.status !== "validacion") return false;

    return (job.assignedNames ?? []).includes(techName);
  });
}

export function getProposedTechNamesFromValidationJobs(jobsToCheck: Job[]) {
  return new Set(
    jobsToCheck
      .filter((job) => job.status === "validacion")
      .flatMap((job) => job.assignedNames ?? [])
      .filter(Boolean)
  );
}

export function getValidationProposalForTech(
  techName: string,
  jobsToCheck: Job[]
) {
  return (
    jobsToCheck.find((job) => {
      if (job.status !== "validacion") return false;

      return (job.assignedNames ?? []).includes(techName);
    }) ?? null
  );
}

export function canExtractSupportFromJob(tech: Tech, jobs: Job[]): boolean {
  if (tech.status !== "refuerzo" || tech.currentJobId == null) return false;

  const currentJob = jobs.find((job) => job.id === tech.currentJobId);
  if (!currentJob || currentJob.status !== "activo") return false;

  const index = currentJob.assignedNames.indexOf(tech.name);

  // Solo se puede extraer si está como apoyo, nunca como responsable.
  return index > 0;
}

export function canAssignTechManuallyToJob(
  tech: Tech,
  job: Job,
  jobs: Job[],
  quickTemplates: QuickTemplate[],
  role: AssignmentRole
) {
  if (isHardBlockedTechStatus(tech.status)) return false;

  if (isTechUnavailableForAssignment(tech)) {
    return false;
  }

  const targetKey = getCompetencyTargetKey(job, quickTemplates);

  if (!tech.competencies[targetKey]?.[role]) {
    return false;
  }

  const templateConfig = getQuickTemplateForJob(job, quickTemplates);

  if (
    templateConfig &&
    templateConfig.allowedTechs.length > 0 &&
    !templateConfig.allowedTechs.includes(tech.name)
  ) {
    return false;
  }

  if (tech.currentJobId == null) {
    return tech.status === "disponible" || tech.status === "supervisor";
  }

  if (role === "responsable") {
    return canExtractSupportFromJob(tech, jobs);
  }

  return false;
}

export function canSelectTechManuallyForJob(
  tech: Tech,
  job: Job,
  jobsToCheck: Job[],
  quickTemplatesToCheck: QuickTemplate[],
  role: AssignmentRole
) {
  if (isHardBlockedTechStatus(tech.status)) return false;

  if (isTechProposedInAnotherValidation(tech.name, job.id, jobsToCheck)) {
    return false;
  }

  return canAssignTechManuallyToJob(
    tech,
    job,
    jobsToCheck,
    quickTemplatesToCheck,
    role
  );
}

export function canUseTechForArea(
  tech: Tech,
  area: AreaKey,
  techs: Tech[],
  jobs: Job[],
  role: AssignmentRole,
  targetKey: CompetencyKey,
  options?: CandidateOptions
): boolean {
  const includeSupport = options?.includeSupport ?? false;
  const allowSupervisorManual = options?.allowSupervisorManual ?? false;
  const forSupportRole = options?.forSupportRole ?? false;
  const allowRamonAuto = options?.allowRamonAuto ?? false;

  if (tech.blocked) return false;

  const isRamon = tech.name === "Ramón";

  if (isRamon && !allowSupervisorManual && !allowRamonAuto) {
    return false;
  }

  if (!tech.competencies[targetKey]?.[role]) return false;

  const isFree =
    tech.currentJobId == null &&
    (tech.status === "disponible" ||
      (tech.status === "supervisor" &&
        (allowSupervisorManual || allowRamonAuto)));

  const isExtractableSupport =
    includeSupport &&
    !forSupportRole &&
    tech.status === "refuerzo" &&
    canExtractSupportFromJob(tech, jobs);

  if (!isFree && !isExtractableSupport) return false;

  if (area === "movil" && role === "responsable") {
    if (!tech.competencies.movil.responsable) return false;
  }

  if (forSupportRole) {
    return isFree || isExtractableSupport;
  }

  if (
    !isRamon &&
    tech.competencies.movil.responsable &&
    tech.currentJobId == null &&
    tech.status === "disponible"
  ) {
    const reserved = countReservedMobileCapacity(techs);

    if (reserved <= MOBILE_MIN_RESERVED && area !== "movil") {
      return false;
    }
  }

  return isFree || (includeSupport && isExtractableSupport);
}

export function filterCandidatesByTemplate(
  candidates: Tech[],
  template?: QuickTemplate | null
): Tech[] {
  if (!template) return candidates;

  if (
    !Array.isArray(template.allowedTechs) ||
    template.allowedTechs.length === 0
  ) {
    return candidates;
  }

  return candidates.filter((tech) => template.allowedTechs.includes(tech.name));
}

export function sortCandidatesByTemplate(
  candidates: Tech[],
  template?: QuickTemplate | null
): Tech[] {
  if (
    !template ||
    !Array.isArray(template.priorityOrder) ||
    template.priorityOrder.length === 0
  ) {
    return candidates;
  }

  return [...candidates].sort((a, b) => {
    const pa = template.priorityOrder.indexOf(a.name);
    const pb = template.priorityOrder.indexOf(b.name);

    const va = pa === -1 ? 999 : pa;
    const vb = pb === -1 ? 999 : pb;

    return va - vb;
  });
}

export function findCandidatesForArea(
  area: AreaKey,
  techs: Tech[],
  jobs: Job[],
  role: AssignmentRole,
  quickTemplates: QuickTemplate[],
  job?: Job,
  options?: CandidateOptions
): Tech[] {
  const targetKey: CompetencyKey = job
    ? getCompetencyTargetKey(job, quickTemplates)
    : area;

  const proposedTechNames = getProposedTechNamesFromValidationJobs(jobs);

  const candidates = techs.filter((tech) => {
    if (proposedTechNames.has(tech.name)) {
      return false;
    }

    return canUseTechForArea(
      tech,
      area,
      techs,
      jobs,
      role,
      targetKey,
      options
    );
  });

  const supportPreference = (tech: Tech) =>
    tech.competencies.alineacion_camion.apoyo || tech.competencies.movil.apoyo
      ? 0
      : 1;

  return [...candidates].sort((a, b) => {
    if (role === "apoyo" || options?.forSupportRole) {
      const sa = supportPreference(a);
      const sb = supportPreference(b);

      if (sa !== sb) return sa - sb;
    }

    const pa = a.priorities[area][role] ?? 99;
    const pb = b.priorities[area][role] ?? 99;

    if (pa !== pb) return pa - pb;

    return (
      AREA_META[area].order.indexOf(a.name) -
      AREA_META[area].order.indexOf(b.name)
    );
  });
}

export function getTechLoadPenalty(
  techName: string,
  techLoadStats: TechLoadStat[]
): number {
  const stat = techLoadStats.find((item) => item.techName === techName);

  if (!stat) return 0;

  return stat.activeCount * 1000 + stat.totalOpenMinutes;
}

export function getOrderedCandidatesForJob(
  job: Job,
  techs: Tech[],
  jobs: Job[],
  role: AssignmentRole,
  quickTemplates: QuickTemplate[],
  options?: CandidateOptions,
  techStats: {
    operation: string;
    fastestTech: string;
    bestTime: number;
    averageMinutes: number;
  }[] = [],
  techLoadStats: TechLoadStat[] = []
): Tech[] {
  const baseCandidates = findCandidatesForArea(
    job.area,
    techs,
    jobs,
    role,
    quickTemplates,
    job,
    options
  );

  const templateConfig = getQuickTemplateForJob(job, quickTemplates);

  let candidates = filterCandidatesByTemplate(baseCandidates, templateConfig);
  candidates = sortCandidatesByTemplate(candidates, templateConfig);

  const operationKey = getOperationKey(job);
  const stat = techStats.find((item) => item.operation === operationKey);

  return [...candidates].sort((a, b) => {
    const aFast = stat?.fastestTech === a.name ? -500 : 0;
    const bFast = stat?.fastestTech === b.name ? -500 : 0;

    const aLoad = getTechLoadPenalty(a.name, techLoadStats);
    const bLoad = getTechLoadPenalty(b.name, techLoadStats);

    const aScore = aFast + aLoad;
    const bScore = bFast + bLoad;

    return aScore - bScore;
  });
}