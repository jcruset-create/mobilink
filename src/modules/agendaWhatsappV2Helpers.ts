import type { ScheduledJob } from "../components/AgendaView";
import { formatMinutes } from "./time";

function toPositiveNumber(value: unknown): number | null {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return numberValue;
}

function formatMoney(value: number) {
  return value.toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function getAgendaWhatsappV2Description({
  scheduled,
  baseDescription,
}: {
  scheduled: ScheduledJob;
  baseDescription: string;
}) {
  const quantity = toPositiveNumber(scheduled.quantity) ?? 1;
  const unitMinutes = toPositiveNumber(scheduled.unitMinutes) ?? 0;
  const totalMinutes =
    toPositiveNumber(scheduled.estimatedMinutes) ??
    Math.round(quantity * unitMinutes);

  const totalPrice =
    toPositiveNumber(scheduled.totalPrice) ??
    Math.round(quantity * (toPositiveNumber(scheduled.unitPrice) ?? 0) * 100) /
      100;

  const hasV2Info =
    quantity !== 1 ||
    unitMinutes > 0 ||
    totalPrice > 0 ||
    scheduled.totalPrice != null;

  if (!hasV2Info) {
    return baseDescription;
  }

  const parts = [
    baseDescription,
    `Cantidad: ${quantity.toLocaleString("es-ES", {
      minimumFractionDigits: Number.isInteger(quantity) ? 0 : 2,
      maximumFractionDigits: 2,
    })}`,
    totalMinutes > 0 ? `Tiempo previsto: ${formatMinutes(totalMinutes)}` : "",
    totalPrice > 0 ? `Importe previsto: ${formatMoney(totalPrice)}` : "",
  ].filter(Boolean);

  return parts.join(" · ");
}