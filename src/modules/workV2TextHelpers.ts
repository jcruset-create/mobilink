import type { Job } from "./workshopTypes";
import { formatMinutes } from "./time";
import { getWorkV2MoneyLabel } from "./workV2Calculations";
import { getWorkV2Summary } from "./workV2SummaryHelpers";

export function getWorkV2ShortText(job: Job): string {
  const summary = getWorkV2Summary(job);

  if (!summary.hasV2Info) return "";

  const parts = [
    `Cantidad: ${summary.quantityLabel}`,
    `Tiempo: ${formatMinutes(summary.totalMinutes)}`,
  ];

  if (summary.totalPrice > 0) {
    parts.push(`Importe: ${getWorkV2MoneyLabel(summary.totalPrice)}`);
  }

  return parts.join(" · ");
}

export function getWorkV2FullText(job: Job): string {
  const summary = getWorkV2Summary(job);

  if (!summary.hasV2Info) return "";

  const parts = [
    `Cantidad: ${summary.quantityLabel}`,
    `Min/unidad: ${formatMinutes(summary.unitMinutes)}`,
    `Tiempo total: ${formatMinutes(summary.totalMinutes)}`,
  ];

  if (summary.unitPrice > 0) {
    parts.push(`Precio unidad: ${getWorkV2MoneyLabel(summary.unitPrice)}`);
  }

  if (summary.totalPrice > 0) {
    parts.push(`Importe total: ${getWorkV2MoneyLabel(summary.totalPrice)}`);
  }

  return parts.join(" · ");
}

export function getWorkV2LogText(job: Job): string {
  const text = getWorkV2ShortText(job);

  return text ? ` · ${text}` : "";
}