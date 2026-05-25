import type { ScheduledJob } from "./AgendaView";
import { formatMinutes } from "../modules/time";

type Props = {
  job: ScheduledJob;
};

function toPositiveNumber(value: unknown): number | null {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return numberValue;
}

function formatQuantity(value: number) {
  return value.toLocaleString("es-ES", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatMoney(value: number) {
  return value.toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function ScheduledJobV2MiniLine({ job }: Props) {
  const quantity = toPositiveNumber(job.quantity) ?? 1;
  const unitMinutes = toPositiveNumber(job.unitMinutes) ?? 0;
  const totalMinutes =
    toPositiveNumber(job.estimatedMinutes) ??
    Math.round(quantity * unitMinutes);

  const unitPrice = toPositiveNumber(job.unitPrice) ?? 0;
  const totalPrice =
    toPositiveNumber(job.totalPrice) ??
    Math.round(quantity * unitPrice * 100) / 100;

  const hasV2Info =
    quantity !== 1 ||
    unitMinutes > 0 ||
    unitPrice > 0 ||
    totalPrice > 0 ||
    job.totalPrice != null;

  if (!hasV2Info) return null;

  return (
    <div className="mt-1 truncate text-[10px] font-black opacity-95">
      Cant: {formatQuantity(quantity)} · Tiempo:{" "}
      {formatMinutes(totalMinutes || 0)}
      {totalPrice > 0 ? ` · ${formatMoney(totalPrice)}` : ""}
    </div>
  );
}