import type {
  AreaKey,
  CompetencyKey,
  Job,
  JobPrediction,
  JobStatus,
  OperationSummary,
  QuickTemplate,
  TemplateKey,
} from "./workshopTypes";

import {
  AREA_META,
  JOB_TEMPLATES,
} from "./workshopConstants";

import {
  getElapsedMinutes,
  nowMs,
} from "./time";

export function getNextSafeJobId(currentJobs: Job[], preferredId: number) {
  const maxExistingJobId = currentJobs.reduce(
    (max, job) => Math.max(max, Number(job.id) || 0),
    0
  );

  const safePreferredId = Number.isFinite(Number(preferredId))
    ? Number(preferredId)
    : 1;

  return Math.max(safePreferredId, maxExistingJobId + 1, 1);
}

export function normalizeJobFromApi(job: any): Job {
  return {
    ...job,
    urgent: !!job.urgent,
    status: (job.status ?? "espera") as JobStatus,
    assignedNames: Array.isArray(job.assignedNames) ? job.assignedNames : [],
    customerName: job.customerName ?? undefined,
    customerPhone: job.customerPhone ?? undefined,
    finishedWhatsappSentAtMs: job.finishedWhatsappSentAtMs ?? null,
    finishedWhatsappSid: job.finishedWhatsappSid ?? null,
    startedAtMs: job.startedAtMs ?? null,
    closedAtMs: job.closedAtMs ?? undefined,
    template: job.template ?? null,
    quickEntryLabel: job.quickEntryLabel ?? null,
    quickEntryMode: job.quickEntryMode ?? null,
    includedTasks: Array.isArray(job.includedTasks) ? job.includedTasks : [],
    actualMinutes: job.actualMinutes ?? null,
    workedAccumulatedMinutes: job.workedAccumulatedMinutes ?? null,
    pausedAccumulatedMinutes: job.pausedAccumulatedMinutes ?? null,
    pausedAtMs: job.pausedAtMs ?? null,
    linkedGroupId: job.linkedGroupId ?? null,
    dependsOnJobId: job.dependsOnJobId ?? null,
    blockedReason: job.blockedReason ?? null,
    linkedOrder: job.linkedOrder ?? null,
    blockedByJobId: job.blockedByJobId ?? null,
  };
}

export function areaPriority(area: AreaKey): number {
  return AREA_META[area].priority;
}

export function isBuiltInTemplateKey(value: string): value is TemplateKey {
  return value === "alineacion_camion" || value === "pinchazo_camion";
}

export function isSingleTechTruckTemplate(job?: Partial<Job> | null): boolean {
  return (
    job?.template === "alineacion_camion" ||
    job?.template === "pinchazo_camion"
  );
}

export function isSingleAssignment(job?: Partial<Job> | null): boolean {
  return job?.quickEntryMode === "single" || isSingleTechTruckTemplate(job);
}

export function getOperationLabel(
  job: Pick<Job, "area" | "template" | "quickEntryLabel">
): string {
  if (job.quickEntryLabel) return job.quickEntryLabel;
  if (job.template) return JOB_TEMPLATES[job.template].label;
  return AREA_META[job.area].label;
}

export function getOperationKey(
  job: Pick<Job, "area" | "template" | "quickEntryLabel">
): string {
  if (job.quickEntryLabel) return `quick:${job.quickEntryLabel}`;
  if (job.template) return `template:${job.template}`;
  return `area:${job.area}`;
}

export function getQuickTemplateForJob(
  job: Pick<Job, "template" | "quickEntryLabel">,
  quickTemplates: QuickTemplate[]
): QuickTemplate | null {
  if (job.template) {
    return quickTemplates.find((t) => t.key === job.template) ?? null;
  }

  if (job.quickEntryLabel) {
    return quickTemplates.find((t) => t.label === job.quickEntryLabel) ?? null;
  }

  return null;
}

export function getCompetencyTargetKey(
  job: Pick<Job, "area" | "template" | "quickEntryLabel">,
  quickTemplates: QuickTemplate[]
): CompetencyKey {
  if (job.template && isBuiltInTemplateKey(job.template)) {
    return job.template;
  }

  const templateConfig = getQuickTemplateForJob(job, quickTemplates);

  if (templateConfig && isBuiltInTemplateKey(templateConfig.key)) {
    return templateConfig.key;
  }

  return job.area;
}

export function getWorkedMinutes(job: Job, endMs = nowMs()): number {
  const accumulated = job.workedAccumulatedMinutes ?? 0;

  if (job.status === "activo") {
    const currentRun = getElapsedMinutes(job.startedAtMs, endMs) ?? 0;
    return accumulated + currentRun;
  }

  return accumulated;
}

export function getPausedMinutes(job: Job, endMs = nowMs()): number {
  const accumulated = job.pausedAccumulatedMinutes ?? 0;

  if (job.status === "parado") {
    const currentPause = getElapsedMinutes(job.pausedAtMs, endMs) ?? 0;
    return accumulated + currentPause;
  }

  return accumulated;
}

export function getPredictedTimeForJob(
  job: Pick<Job, "area" | "template" | "quickEntryLabel">,
  operationReport: OperationSummary[]
): JobPrediction {
  const operationKey = getOperationKey(job);

  const byTemplate = operationReport.find((item) => item.key === operationKey);
  if (byTemplate) {
    return {
      predictedMinutes: byTemplate.averageMinutes,
      source: job.template || job.quickEntryLabel ? "template" : "area",
    };
  }

  const byArea = operationReport.find((item) => item.key === `area:${job.area}`);
  if (byArea) {
    return {
      predictedMinutes: byArea.averageMinutes,
      source: "area",
    };
  }

  return {
    predictedMinutes: null,
    source: "none",
  };
}
export function isLinkedBlockedJob(job: Job) {
  if (job.status !== "parado") return false;

  return (
    !!job.dependsOnJobId ||
    !!job.blockedReason ||
    job.linkedOrder === 2 ||
    (job.reason || "").includes("Pendiente del trabajo anterior") ||
    (job.reason || "").includes("Trabajo vinculado")
  );
}
