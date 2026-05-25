import type { Job } from "./workshopTypes";
import { getWorkV2MoneyLabel } from "./workV2Calculations";
import { getWorkV2Summary } from "./workV2SummaryHelpers";

export type WorkHistoryV2Row = {
  jobId: number;
  plate: string;
  quantityLabel: string;
  unitMinutes: number;
  totalMinutes: number;
  unitPriceLabel: string;
  totalPriceLabel: string;
  hasV2Info: boolean;
};

export function getWorkHistoryV2Row(job: Job): WorkHistoryV2Row {
  const summary = getWorkV2Summary(job);

  return {
    jobId: job.id,
    plate: job.plate,
    quantityLabel: summary.quantityLabel,
    unitMinutes: summary.unitMinutes,
    totalMinutes: summary.totalMinutes,
    unitPriceLabel: getWorkV2MoneyLabel(summary.unitPrice),
    totalPriceLabel: getWorkV2MoneyLabel(summary.totalPrice),
    hasV2Info: summary.hasV2Info,
  };
}

export function getWorkHistoryV2Rows(jobs: Job[]): WorkHistoryV2Row[] {
  return jobs.map(getWorkHistoryV2Row);
}