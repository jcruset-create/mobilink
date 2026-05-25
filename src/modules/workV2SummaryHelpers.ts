import type { Job } from "./workshopTypes";
import {
  getWorkV2Quantity,
  getWorkV2QuantityLabel,
  getWorkV2TotalPrice,
  getWorkV2UnitPrice,
} from "./workV2Calculations";
import {
  getJobV2TotalEstimatedMinutes,
  getJobV2UnitMinutes,
} from "./workTimeV2Helpers";

export type WorkV2Summary = {
  quantity: number;
  quantityLabel: string;
  unitMinutes: number;
  totalMinutes: number;
  unitPrice: number;
  totalPrice: number;
  hasV2Info: boolean;
};

export function getWorkV2Summary(job: Job): WorkV2Summary {
  const quantity = getWorkV2Quantity(job);
  const quantityLabel = getWorkV2QuantityLabel(job);
  const unitMinutes = getJobV2UnitMinutes(job) ?? 0;
  const totalMinutes = getJobV2TotalEstimatedMinutes(job) ?? 0;
  const unitPrice = getWorkV2UnitPrice(job);
  const totalPrice = getWorkV2TotalPrice(job);

  const hasV2Info =
    quantity !== 1 ||
    unitMinutes > 0 ||
    unitPrice > 0 ||
    totalPrice > 0 ||
    job.standardMinutes != null;

  return {
    quantity,
    quantityLabel,
    unitMinutes,
    totalMinutes,
    unitPrice,
    totalPrice,
    hasV2Info,
  };
}

export function getWorkV2DebugSummary(job: Job) {
  const summary = getWorkV2Summary(job);

  return {
    jobId: job.id,
    plate: job.plate,
    quantity: summary.quantity,
    unitMinutes: summary.unitMinutes,
    standardMinutes: job.standardMinutes ?? null,
    totalMinutes: summary.totalMinutes,
    unitPrice: summary.unitPrice,
    totalPrice: summary.totalPrice,
  };
}