import type { Job } from "./workshopTypes";

function toNullablePositiveNumber(value: unknown): number | null {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return numberValue;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function getJobV2PayloadFields(job: Job) {
  const quantity = toNullablePositiveNumber(job.quantity) ?? null;
  const unitMinutes = toNullablePositiveNumber(job.unitMinutes) ?? null;
  const unitPrice = toNullablePositiveNumber(job.unitPrice) ?? null;
  const standardMinutes = toNullablePositiveNumber(job.standardMinutes) ?? null;
  const totalPrice =
    toNullablePositiveNumber(job.totalPrice) != null
      ? roundMoney(Number(job.totalPrice))
      : null;

  return {
    quantity,
    unitMinutes,
    unitPrice,
    standardMinutes,
    totalPrice,
  };
}

export function applyJobV2PayloadFields<T extends Record<string, unknown>>(
  payload: T,
  job: Job
): T & ReturnType<typeof getJobV2PayloadFields> {
  return {
    ...payload,
    ...getJobV2PayloadFields(job),
  };
}