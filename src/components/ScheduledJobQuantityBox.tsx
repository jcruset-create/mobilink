import type { QuickTemplate } from "../modules/workshopTypes";
import { formatMinutes } from "../modules/time";
import {
  getScheduledJobV2Quantity,
  getScheduledJobV2TotalMinutes,
  getScheduledJobV2TotalPrice,
  getScheduledJobV2UnitMinutes,
} from "../modules/scheduledJobV2Helpers";
import type { IncludedTask } from "../modules/quickTaskSelector";

type Props = {
  template: QuickTemplate | null;
  quantity: number | string | null | undefined;
  includedTasks?: IncludedTask[];
  onQuantityChange: (value: string) => void;
};

function toPositiveNumber(value: unknown): number | null {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return numberValue;
}

export default function ScheduledJobQuantityBox({
  template,
  quantity,
  includedTasks = [],
  onQuantityChange,
}: Props) {
  if (!template) return null;

  const usesQuantity = Boolean(template.usesQuantity);
  const manualQuantity = toPositiveNumber(quantity) ?? 1;
  const shouldCalculateByQuantity = usesQuantity || manualQuantity > 1;

  const scheduledLike = {
    quantity: manualQuantity,
    unitMinutes: template.unitMinutes ?? template.standardMinutes ?? null,
    unitPrice: template.unitPrice ?? null,
  };

  const safeQuantity = getScheduledJobV2Quantity(scheduledLike);

  const unitMinutes = getScheduledJobV2UnitMinutes({
    scheduled: scheduledLike,
    template,
  });

  const totalMinutes = shouldCalculateByQuantity
    ? Math.round(safeQuantity * (unitMinutes || 0))
    : getScheduledJobV2TotalMinutes({
        scheduled: scheduledLike,
        template,
        includedTasks,
      });

  const unitPrice = toPositiveNumber(template.unitPrice) ?? 0;

  const totalPrice = shouldCalculateByQuantity
    ? Math.round(safeQuantity * unitPrice * 100) / 100
    : getScheduledJobV2TotalPrice({
        scheduled: scheduledLike,
        template,
        includedTasks,
      });

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 text-sm font-black text-slate-800">
        Cantidad y previsión
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="grid gap-1 text-xs font-bold text-slate-600">
          Cantidad
          <input
            type="number"
            min="1"
            step="1"
            value={String(quantity ?? "1")}
            onChange={(event) => onQuantityChange(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold"
          />
        </label>

        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
            Minutos unidad
          </div>
          <div className="text-sm font-black text-slate-900">
            {unitMinutes || 0} min
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
            Tiempo total
          </div>
          <div className="text-sm font-black text-slate-900">
            {formatMinutes(totalMinutes || 0)}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
            Importe previsto
          </div>
          <div className="text-sm font-black text-slate-900">
            {totalPrice.toLocaleString("es-ES", {
              style: "currency",
              currency: "EUR",
            })}
          </div>
        </div>
      </div>

      {!usesQuantity && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
          Esta entrada rápida todavía no está marcada como “usar cantidad”.
          Puedes indicar cantidad manualmente, pero conviene editar la entrada
          rápida y activar “usar cantidad”.
        </div>
      )}

      {shouldCalculateByQuantity && (
        <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
          Cantidad {safeQuantity} × {unitMinutes || 0} min ={" "}
          {formatMinutes(totalMinutes || 0)}.
        </div>
      )}
    </div>
  );
}