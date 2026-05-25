import { getWorkV2MoneyLabel } from "../modules/workV2Calculations";
import { formatMinutes } from "../modules/time";

type WorkHistoryV2CompatibleJob = {
  id: number;
  plate?: string;
  quantity?: number | null;
  unitMinutes?: number | null;
  unitPrice?: number | null;
  standardMinutes?: number | null;
  totalPrice?: number | null;
};

type Props = {
  job: WorkHistoryV2CompatibleJob;
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

export default function WorkHistoryV2Line({ job }: Props) {
  const quantity = toPositiveNumber(job.quantity) ?? 1;
  const unitMinutes = toPositiveNumber(job.unitMinutes) ?? 0;
  const unitPrice = toPositiveNumber(job.unitPrice) ?? 0;

  const totalMinutes =
    toPositiveNumber(job.standardMinutes) ??
    Math.round(quantity * unitMinutes);

  const totalPrice =
    toPositiveNumber(job.totalPrice) ??
    Math.round(quantity * unitPrice * 100) / 100;

  const hasV2Info =
    quantity !== 1 ||
    unitMinutes > 0 ||
    unitPrice > 0 ||
    totalPrice > 0 ||
    job.standardMinutes != null;

  if (!hasV2Info) return null;

  const parts = [
    `Cantidad: ${formatQuantity(quantity)}`,
    `Tiempo: ${formatMinutes(totalMinutes || 0)}`,
  ];

  if (totalPrice > 0) {
    parts.push(`Importe: ${getWorkV2MoneyLabel(totalPrice)}`);
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-black text-slate-600">
      {parts.map((part) => {
        const isImporte = part.toLowerCase().includes("importe");

        return (
          <span
            key={part}
            className={`rounded-full px-2 py-0.5 ${
              isImporte ? "bg-emerald-100 text-emerald-800" : "bg-slate-100"
            }`}
          >
            {part}
          </span>
        );
      })}
    </div>
  );
}