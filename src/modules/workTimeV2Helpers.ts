import type { Job, JobPrediction, QuickTemplate } from "./workshopTypes";
import { getIncludedTasksMinutes } from "./quickTaskSelector";

function toPositiveNumber(value: unknown): number | null {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return numberValue;
}

export function getJobV2Quantity(job: Job): number {
  return toPositiveNumber(job.quantity) ?? 1;
}

export function getJobV2UnitMinutes(job: Job): number | null {
  return toPositiveNumber(job.unitMinutes);
}

export function getJobV2StandardMinutes(job: Job): number | null {
  return toPositiveNumber(job.standardMinutes);
}

export function getJobV2IncludedTasksMinutes(job: Job): number {
  return getIncludedTasksMinutes(job.includedTasks ?? []);
}

export function getJobV2TotalEstimatedMinutes(job: Job): number | null {
  const standardMinutes = getJobV2StandardMinutes(job);

  if (standardMinutes != null) {
    return Math.round(standardMinutes);
  }

  const unitMinutes = getJobV2UnitMinutes(job);

  if (unitMinutes != null) {
    return Math.round(getJobV2Quantity(job) * unitMinutes);
  }

  return null;
}

export function getTemplateV2UnitMinutes(template?: QuickTemplate | null) {
  return (
    toPositiveNumber(template?.unitMinutes) ??
    toPositiveNumber(template?.standardMinutes) ??
    null
  );
}

export function getTemplateV2EstimatedMinutes({
  template,
  quantity = 1,
}: {
  template?: QuickTemplate | null;
  quantity?: number | string | null;
}): number | null {
  if (!template) return null;

  const unitMinutes = getTemplateV2UnitMinutes(template);

  if (unitMinutes == null) return null;

  if (template.usesQuantity) {
    return Math.round((toPositiveNumber(quantity) ?? 1) * unitMinutes);
  }

  return Math.round(toPositiveNumber(template.standardMinutes) ?? unitMinutes);
}

export function getPredictionV2Minutes(
  prediction?: JobPrediction | null
): number | null {
  return toPositiveNumber(prediction?.predictedMinutes);
}

export function getJobDisplayEstimatedMinutes({
  job,
  prediction,
  template,
}: {
  job: Job;
  prediction?: JobPrediction | null;
  template?: QuickTemplate | null;
}): number {
  const jobMinutes = getJobV2TotalEstimatedMinutes(job);

  if (jobMinutes != null) {
    return jobMinutes;
  }

  const templateMinutes = getTemplateV2EstimatedMinutes({
    template,
    quantity: job.quantity ?? 1,
  });

  if (templateMinutes != null) {
    return templateMinutes;
  }

  const predictionMinutes = getPredictionV2Minutes(prediction);

  if (predictionMinutes != null) {
    return Math.round(predictionMinutes);
  }

  return 0;
}

export function getJobDisplayAiMinutes({
  job,
  prediction,
  template,
}: {
  job: Job;
  prediction?: JobPrediction | null;
  template?: QuickTemplate | null;
}) {
  return getJobDisplayEstimatedMinutes({
    job,
    prediction,
    template,
  });
}

export function getJobDisplayPlannedMinutes({
  job,
  prediction,
  template,
}: {
  job: Job;
  prediction?: JobPrediction | null;
  template?: QuickTemplate | null;
}) {
  return getJobDisplayEstimatedMinutes({
    job,
    prediction,
    template,
  });
}