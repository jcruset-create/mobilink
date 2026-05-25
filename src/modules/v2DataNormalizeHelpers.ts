import type { Job } from "./workshopTypes";

type ScheduledJobV2Like = {
  quantity?: number | string | null;
  unitMinutes?: number | string | null;
  unitPrice?: number | string | null;
  standardMinutes?: number | string | null;
  totalPrice?: number | string | null;
  estimatedMinutes?: number | string | null;
};

function toNullablePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return numberValue;
}

function roundMinutes(value: unknown): number | null {
  const numberValue = toNullablePositiveNumber(value);

  if (numberValue == null) return null;

  return Math.round(numberValue);
}

function roundMoney(value: unknown): number | null {
  const numberValue = toNullablePositiveNumber(value);

  if (numberValue == null) return null;

  return Math.round(numberValue * 100) / 100;
}

export function normalizeJobV2Fields<T extends Job>(job: T): T {
  return {
    ...job,
    quantity: toNullablePositiveNumber(job.quantity) ?? undefined,
    unitMinutes: roundMinutes(job.unitMinutes),
    unitPrice: roundMoney(job.unitPrice),
    standardMinutes: roundMinutes(job.standardMinutes),
    totalPrice: roundMoney(job.totalPrice),
  };
}

export function normalizeJobsV2Fields<T extends Job>(jobs: T[]): T[] {
  return jobs.map((job) => normalizeJobV2Fields(job));
}

export function normalizeScheduledJobV2Fields<T extends ScheduledJobV2Like>(
  scheduled: T
): T {
  return {
    ...scheduled,
    quantity: toNullablePositiveNumber(scheduled.quantity) ?? undefined,
    unitMinutes: roundMinutes(scheduled.unitMinutes),
    unitPrice: roundMoney(scheduled.unitPrice),
    standardMinutes: roundMinutes(scheduled.standardMinutes),
    totalPrice: roundMoney(scheduled.totalPrice),
    estimatedMinutes: roundMinutes(scheduled.estimatedMinutes),
  };
}

export function normalizeScheduledJobsV2Fields<T extends ScheduledJobV2Like>(
  scheduledJobs: T[]
): T[] {
  return scheduledJobs.map((scheduled) =>
    normalizeScheduledJobV2Fields(scheduled)
  );
}