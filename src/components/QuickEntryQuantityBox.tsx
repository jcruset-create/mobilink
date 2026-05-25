import type { QuickTemplate } from "../modules/workshopTypes";
import { formatMinutes } from "../modules/time";

type Props = {
  template: QuickTemplate | null;
  quantity: string;
  setQuantity: (value: string) => void;
};

function toPositiveNumber(value: unknown, fallback = 0) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return fallback;
  }

  return numberValue;
}

export default function QuickEntryQuantityBox({
  template,
  quantity,
  setQuantity,
}: Props) {
  if (!template) return null;

  const usesQuantity = Boolean(template.usesQuantity);

  const unitMinutes = toPositiveNumber(
    template.unitMinutes ?? template.standardMinutes,
    0
  );

  const unitPrice = toPositiveNumber(template.unitPrice, 0);

  const safeQuantity = usesQuantity ? toPositiveNumber(quantity, 1) : 1;

  const totalMinutes = usesQuantity
    ? Math.round(safeQuantity * unitMinutes)
    : Math.round(toPositiveNumber(template.standardMinutes ?? unitMinutes, 0));

  const totalPrice = usesQuantity
    ? Math.round(safeQuantity * unitPrice * 100) / 100
    : Math.round(unitPrice * 100) / 100;

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
            value={quantity}
            disabled={!usesQuantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold disabled:bg-slate-100 disabled:text-slate-400"
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
          Esta entrada rápida no usa cantidad. Se creará como cantidad 1.
        </div>
      )}
    </div>
  );
}