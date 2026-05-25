import type { Job } from "../modules/workshopTypes";
import { getWorkV2MoneyLabel } from "../modules/workV2Calculations";
import { getWorkV2Summary } from "../modules/workV2SummaryHelpers";
import { formatMinutes } from "../modules/time";

type Props = {
  job: Job;
};

export default function WorkV2InfoBox({ job }: Props) {
  const summary = getWorkV2Summary(job);

  if (!summary.hasV2Info) return null;

  return (
    <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] font-black text-slate-700 md:grid-cols-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
        <div className="uppercase text-slate-400">Cantidad</div>
        <div className="text-slate-900">{summary.quantityLabel}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
        <div className="uppercase text-slate-400">Min/unidad</div>
        <div className="text-slate-900">
          {formatMinutes(summary.unitMinutes)}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
        <div className="uppercase text-slate-400">Tiempo total</div>
        <div className="text-slate-900">
          {formatMinutes(summary.totalMinutes)}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5">
        <div className="uppercase text-slate-400">Importe</div>
        <div className="text-slate-900">
          {getWorkV2MoneyLabel(summary.totalPrice)}
        </div>
      </div>
    </div>
  );
}