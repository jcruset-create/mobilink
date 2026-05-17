import type {
  AllocationResult,
  AreaKey,
  AssignmentRole,
  CandidateOptions,
  CompetencyKey,
  Job,
  JobStatus,
  QuickTemplate,
  Tech,
  TechLoadStat,
  TestResult,
} from "./workshopTypes";

import {
  AREA_META,
  DEFAULT_QUICK_TEMPLATES,
  MOBILE_MIN_RESERVED,
} from "./workshopConstants";

import {
  INITIAL_TECHS,
  countReservedMobileCapacity,
} from "./techConfig";

import {
  getCompetencyTargetKey,
  getOperationKey,
  getOperationLabel,
  getQuickTemplateForJob,
  isSingleAssignment,
} from "./jobHelpers";

import { buildValidationJob } from "./jobValidation";

import {
  getElapsedMinutes,
  nowMs,
} from "./time";
import {
  isHardBlockedTechStatus,
  isTechUnavailableForAssignment,
} from "./techStatus";

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


export function getAssignmentReason(
  job: Job,
  assignedNames: string[]
): string {
  if (job.area === "movil") {
    return "Móvil asignado a especialista disponible según orden de unidades móviles.";
  }

  if (isSingleAssignment(job)) {
    return `${getOperationLabel(job)} asignado con 1 técnico sin apoyo.`;
  }

  if (job.area === "camion" && assignedNames.length === 2) {
    return "Camión asignado con 1 responsable y 1 apoyo disponible.";
  }

  if (job.area === "camion") {
    return "Camión asignado con 1 responsable.";
  }

  return `${AREA_META[job.area].label} asignado según orden oficial y disponibilidad.`;
}

export function allocateJobPure(
  job: Job,
  techs: Tech[],
  jobs: Job[],
  quickTemplates: QuickTemplate[],
  techStats: {
    operation: string;
    fastestTech: string;
    bestTime: number;
    averageMinutes: number;
  }[],
  techLoadStats: TechLoadStat[]
): AllocationResult {
  const freeMain = getOrderedCandidatesForJob(
    job,
    techs,
    jobs,
    "responsable",
    quickTemplates,
    {
      includeSupport: false,
      allowSupervisorManual: false,
      allowRamonAuto: false,
    },
    techStats,
    techLoadStats
  );

  const fallbackMain =
    freeMain.length === 0
      ? getOrderedCandidatesForJob(
          job,
          techs,
          jobs,
          "responsable",
          quickTemplates,
          {
            includeSupport: true,
            allowSupervisorManual: false,
            allowRamonAuto: false,
          },
          techStats,
          techLoadStats
        )
      : [];

  const ramonMain =
    freeMain.length === 0 && fallbackMain.length === 0
      ? getOrderedCandidatesForJob(
          job,
          techs,
          jobs,
          "responsable",
          quickTemplates,
          {
            includeSupport: false,
            allowSupervisorManual: false,
            allowRamonAuto: true,
          },
          techStats,
          techLoadStats
        ).filter((tech) => tech.name === "Ramón")
      : [];

  const mainPool =
    freeMain.length > 0
      ? freeMain
      : fallbackMain.length > 0
      ? fallbackMain
      : ramonMain;

  if (mainPool.length === 0) {
    const reason = `Sin técnico disponible para ${getOperationLabel(job)}.`;

    return {
      assigned: false,
      assignedNames: [],
      reason,
      techs,
      jobs: jobs.map((item) =>
        item.id === job.id
          ? {
              ...item,
              status: "espera" as JobStatus,
              assignedNames: [],
              reason,
              startedAtMs: null,
            }
          : item
      ),
    };
  }

  const mainTech = mainPool[0];
  const assignedNames = [mainTech.name];
  const needsRamonApproval = mainTech.name === "Ramón";

  const cleanedJobs = jobs;

  if (job.area === "camion" && !isSingleAssignment(job)) {
    const freeSupport = getOrderedCandidatesForJob(
      job,
      techs,
      cleanedJobs,
      "apoyo",
      quickTemplates,
      {
        includeSupport: false,
        allowSupervisorManual: false,
        allowRamonAuto: false,
        forSupportRole: true,
      },
      techStats,
      techLoadStats
    ).filter((tech) => {
      if (tech.name === assignedNames[0]) return false;
      if (tech.name === "Ramón") return false;
      if (tech.currentJobId != null) return false;
      if (tech.status !== "disponible") return false;

      return true;
    });

    const supportPool = freeSupport;

    if (supportPool.length > 0) {
      const supportTech = supportPool[0];

      if (!assignedNames.includes(supportTech.name)) {
        assignedNames.push(supportTech.name);
      }
    }
  }

  const reason = needsRamonApproval
    ? `${getOperationLabel(job)} solo tiene a Ramón disponible como último recurso.`
    : getAssignmentReason(job, assignedNames);

  const validationReason = needsRamonApproval
    ? `${reason} Pendiente de autorización manual antes de iniciar.`
    : `${reason} Pendiente de validación manual antes de iniciar.`;

  const validationJob = buildValidationJob(
    {
      ...job,
      status: "validacion",
      assignedNames,
      reason: validationReason,
      startedAtMs: null,
    },
    assignedNames,
    reason
  ) as Job;

  const updatedJobs: Job[] = cleanedJobs.map((item) =>
    item.id === job.id ? validationJob : item
  );

  return {
    assigned: true,
    assignedNames,
    reason: validationJob.reason,
    techs,
    jobs: updatedJobs,
    needsRamonApproval,
  };
}

export function runSelfTests(
  techStats: {
    operation: string;
    fastestTech: string;
    bestTime: number;
    averageMinutes: number;
  }[],
  techLoadStats: TechLoadStat[]
): TestResult[] {
  const tests: TestResult[] = [];

  const camionJob: Job = {
    id: 1,
    area: "camion",
    plate: "1111AAA",
    urgent: false,
    status: "espera",
    assignedNames: [],
    reason: "",
    createdAtMs: nowMs(),
    startedAtMs: null,
  };

  const camionResult = allocateJobPure(
    camionJob,
    INITIAL_TECHS,
    [camionJob],
    DEFAULT_QUICK_TEMPLATES,
    techStats,
    techLoadStats
  );

  tests.push({
    name: "Camión asigna responsable",
    pass: camionResult.assigned && camionResult.assignedNames[0] === "José",
  });

  tests.push({
    name: "Camión asigna apoyo",
    pass: camionResult.assigned && camionResult.assignedNames[1] === "Iván",
  });

  const alineacionJob: Job = {
    id: 2,
    area: "camion",
    plate: "ALI123",
    urgent: false,
    status: "espera",
    assignedNames: [],
    reason: "",
    createdAtMs: nowMs(),
    startedAtMs: null,
    template: "alineacion_camion",
  };

  const alineacionResult = allocateJobPure(
    alineacionJob,
    INITIAL_TECHS,
    [alineacionJob],
    DEFAULT_QUICK_TEMPLATES,
    techStats,
    techLoadStats
  );

  tests.push({
    name: "Alineación solo 1 técnico",
    pass:
      alineacionResult.assigned &&
      alineacionResult.assignedNames.length === 1,
  });

  const anthoni = INITIAL_TECHS.find((tech) => tech.name === "Anthoni");

  tests.push({
    name: "Competencia responsable/apoyo",
    pass:
      !!anthoni &&
      anthoni.competencies.camion.responsable &&
      anthoni.competencies.camion.apoyo,
  });

  const supportTechs = INITIAL_TECHS.map((tech) =>
    tech.name === "Iván"
      ? { ...tech, status: "refuerzo" as const, currentJobId: 10 }
      : tech.name === "José"
      ? { ...tech, status: "ocupado" as const, currentJobId: 10 }
      : [
          "Alejandro",
          "Jesús",
          "Anthoni",
          "David",
          "Andrés",
          "Albert",
        ].includes(tech.name)
      ? { ...tech, status: "ocupado" as const, currentJobId: 20 }
      : tech
  );

  const supportJobs: Job[] = [
    {
      id: 10,
      area: "camion",
      plate: "SUP001",
      urgent: false,
      status: "activo",
      assignedNames: ["José", "Iván"],
      reason: "",
      createdAtMs: nowMs(),
      startedAtMs: nowMs() - 10000,
    },
    {
      id: 99,
      area: "turismo",
      plate: "NEW999",
      urgent: false,
      status: "espera",
      assignedNames: [],
      reason: "",
      createdAtMs: nowMs(),
      startedAtMs: null,
    },
  ];

  const supportPromoted = allocateJobPure(
    supportJobs[1],
    supportTechs,
    supportJobs,
    DEFAULT_QUICK_TEMPLATES,
    techStats,
    techLoadStats
  );

  tests.push({
    name: "Un refuerzo puede pasar a responsable",
    pass:
      supportPromoted.assigned &&
      supportPromoted.assignedNames[0] === "Iván",
  });

  const elapsed = getElapsedMinutes(nowMs() - 30 * 60000, nowMs());

  tests.push({
    name: "Cálculo de duración",
    pass: elapsed === 30,
  });

  return tests;
}