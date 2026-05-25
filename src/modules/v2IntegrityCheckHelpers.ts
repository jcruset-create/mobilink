import type { Job } from "./workshopTypes";

type ScheduledJobV2Like = {
  id: number;
  plate?: string;
  templateKey?: string;
  quantity?: number | null;
  unitMinutes?: number | null;
  unitPrice?: number | null;
  standardMinutes?: number | null;
  totalPrice?: number | null;
  estimatedMinutes?: number | null;
};

export type V2IntegrityIssue = {
  type: "job" | "scheduled";
  id: number;
  plate: string;
  level: "info" | "warning";
  message: string;
};

function toPositiveNumber(value: unknown): number | null {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return numberValue;
}

function hasAnyV2Field(item: ScheduledJobV2Like) {
  return (
    item.quantity != null ||
    item.unitMinutes != null ||
    item.unitPrice != null ||
    item.standardMinutes != null ||
    item.totalPrice != null ||
    item.estimatedMinutes != null
  );
}

export function checkJobV2Integrity(job: Job): V2IntegrityIssue[] {
  const issues: V2IntegrityIssue[] = [];

  const quantity = toPositiveNumber(job.quantity);
  const unitMinutes = toPositiveNumber(job.unitMinutes);
  const standardMinutes = toPositiveNumber(job.standardMinutes);
  const unitPrice = toPositiveNumber(job.unitPrice);
  const totalPrice = toPositiveNumber(job.totalPrice);

  if (!hasAnyV2Field(job)) {
    return issues;
  }

  if (quantity != null && quantity !== 1 && unitMinutes == null) {
    issues.push({
      type: "job",
      id: job.id,
      plate: job.plate,
      level: "warning",
      message: "Tiene cantidad, pero no tiene minutos por unidad.",
    });
  }

  if (unitMinutes != null && standardMinutes == null) {
    issues.push({
      type: "job",
      id: job.id,
      plate: job.plate,
      level: "info",
      message:
        "Tiene minutos por unidad, pero no tiene tiempo total standardMinutes.",
    });
  }

  if (unitPrice != null && totalPrice == null) {
    issues.push({
      type: "job",
      id: job.id,
      plate: job.plate,
      level: "info",
      message: "Tiene precio por unidad, pero no tiene importe total.",
    });
  }

  return issues;
}

export function checkScheduledJobV2Integrity(
  scheduled: ScheduledJobV2Like
): V2IntegrityIssue[] {
  const issues: V2IntegrityIssue[] = [];

  const quantity = toPositiveNumber(scheduled.quantity);
  const unitMinutes = toPositiveNumber(scheduled.unitMinutes);
  const estimatedMinutes = toPositiveNumber(scheduled.estimatedMinutes);
  const unitPrice = toPositiveNumber(scheduled.unitPrice);
  const totalPrice = toPositiveNumber(scheduled.totalPrice);

  if (!hasAnyV2Field(scheduled)) {
    return issues;
  }

  if (quantity != null && quantity !== 1 && unitMinutes == null) {
    issues.push({
      type: "scheduled",
      id: scheduled.id,
      plate: scheduled.plate || "Sin matrícula",
      level: "warning",
      message: "La cita tiene cantidad, pero no tiene minutos por unidad.",
    });
  }

  if (unitMinutes != null && estimatedMinutes == null) {
    issues.push({
      type: "scheduled",
      id: scheduled.id,
      plate: scheduled.plate || "Sin matrícula",
      level: "info",
      message:
        "La cita tiene minutos por unidad, pero no tiene duración estimada.",
    });
  }

  if (unitPrice != null && totalPrice == null) {
    issues.push({
      type: "scheduled",
      id: scheduled.id,
      plate: scheduled.plate || "Sin matrícula",
      level: "info",
      message: "La cita tiene precio por unidad, pero no tiene importe total.",
    });
  }

  return issues;
}

export function checkAllV2Integrity({
  jobs,
  scheduledJobs,
}: {
  jobs: Job[];
  scheduledJobs: ScheduledJobV2Like[];
}) {
  return [
    ...jobs.flatMap(checkJobV2Integrity),
    ...scheduledJobs.flatMap(checkScheduledJobV2Integrity),
  ];
}