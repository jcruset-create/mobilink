import type { Job } from "./workshopTypes";
import {
  getWorkV2RevenueSplit,
  getWorkV2TotalPrice,
} from "./workV2Calculations";
import { getWorkV2Summary } from "./workV2SummaryHelpers";

export type WorkRankingV2Role = "responsable" | "apoyo";

export type WorkRankingV2DetailRow = {
  jobId: number;
  plate: string;
  techName: string;
  role: WorkRankingV2Role;
  quantityLabel: string;
  unitMinutes: number;
  totalMinutes: number;
  unitPrice: number;
  totalPrice: number;
  shareRatio: number;
  assignedAmount: number;
};

export type WorkRankingV2TechRow = {
  techName: string;
  assignedRevenue: number;
  realRevenue: number;
  responsibleRevenue: number;
  supportRevenue: number;
  responsibleCount: number;
  supportCount: number;
  jobsCount: number;
  quantityTotal: number;
};

function ensureRankingRow(
  map: Map<string, WorkRankingV2TechRow>,
  techName: string
) {
  const existing = map.get(techName);

  if (existing) return existing;

  const row: WorkRankingV2TechRow = {
    techName,
    assignedRevenue: 0,
    realRevenue: 0,
    responsibleRevenue: 0,
    supportRevenue: 0,
    responsibleCount: 0,
    supportCount: 0,
    jobsCount: 0,
    quantityTotal: 0,
  };

  map.set(techName, row);

  return row;
}

export function buildWorkRankingV2Rows({
  jobs,
  selectedTechName = "",
}: {
  jobs: Job[];
  selectedTechName?: string;
}) {
  const rankingMap = new Map<string, WorkRankingV2TechRow>();
  const detailRows: WorkRankingV2DetailRow[] = [];

  for (const job of jobs) {
    const split = getWorkV2RevenueSplit(job);
    const summary = getWorkV2Summary(job);
    const totalPrice = getWorkV2TotalPrice(job);

    for (const item of split) {
      if (selectedTechName && item.techName !== selectedTechName) {
        continue;
      }

      const row = ensureRankingRow(rankingMap, item.techName);

      row.assignedRevenue += item.amount;
      row.realRevenue += totalPrice;
      row.jobsCount += 1;
      row.quantityTotal += summary.quantity;

      if (item.role === "responsable") {
        row.responsibleRevenue += item.amount;
        row.responsibleCount += 1;
      } else {
        row.supportRevenue += item.amount;
        row.supportCount += 1;
      }

      detailRows.push({
        jobId: job.id,
        plate: job.plate,
        techName: item.techName,
        role: item.role,
        quantityLabel: summary.quantityLabel,
        unitMinutes: summary.unitMinutes,
        totalMinutes: summary.totalMinutes,
        unitPrice: summary.unitPrice,
        totalPrice,
        shareRatio: item.shareRatio,
        assignedAmount: item.amount,
      });
    }
  }

  const rankingRows = Array.from(rankingMap.values()).sort((a, b) => {
    if (b.assignedRevenue !== a.assignedRevenue) {
      return b.assignedRevenue - a.assignedRevenue;
    }

    return a.techName.localeCompare(b.techName, "es");
  });

  return {
    rankingRows,
    detailRows,
    assignedTotalRevenue: rankingRows.reduce(
      (sum, row) => sum + row.assignedRevenue,
      0
    ),
    realTotalRevenue: jobs.reduce(
      (sum, job) => sum + getWorkV2TotalPrice(job),
      0
    ),
  };
}