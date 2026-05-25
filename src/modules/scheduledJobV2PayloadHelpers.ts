import type { ScheduledJob } from "../components/AgendaView";

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

export function getScheduledJobV2PayloadFields(job: ScheduledJob) {
  const quantity = toNullablePositiveNumber(job.quantity) ?? null;
  const unitMinutes = toNullablePositiveNumber(job.unitMinutes) ?? null;
  const unitPrice = toNullablePositiveNumber(job.unitPrice) ?? null;
  const totalPrice =
    toNullablePositiveNumber(job.totalPrice) != null
      ? roundMoney(Number(job.totalPrice))
      : null;

  const estimatedMinutes = toNullablePositiveNumber(job.estimatedMinutes) ?? null;

  return {
    quantity,
    unitMinutes,
    unitPrice,
    totalPrice,
    estimatedMinutes,
  };
}

export function applyScheduledJobV2PayloadFields<
  T extends Record<string, unknown>
>(payload: T, job: ScheduledJob): T & ReturnType<typeof getScheduledJobV2PayloadFields> {
  return {
    ...payload,
    ...getScheduledJobV2PayloadFields(job),
  };
}