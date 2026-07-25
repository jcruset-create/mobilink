/**
 * Centro de Inteligencia Operacional — tarjeta de KPI.
 *
 * Muestra lo que exige el diseño para cada indicador: valor, objetivo,
 * variación frente al día y a la semana anteriores, tendencia, semáforo y
 * acceso al detalle. Cuando no hay dato, lo dice y explica por qué en lugar de
 * pintar un cero engañoso.
 */

import { ArrowDownRight, ArrowRight, ArrowUpRight, Info } from "lucide-react";
import {
  KPI_STATUS_LABELS, KPI_STATUS_STYLES, fmtValue, fmtVariation, type KpiCard,
} from "../../services/oiApi";

const DOT: Record<string, string> = {
  green: "bg-emerald-400", amber: "bg-amber-400", red: "bg-red-400", grey: "bg-slate-500",
};

function TrendIcon({ trend }: { trend: KpiCard["trend"] }) {
  if (trend === "up") return <ArrowUpRight className="h-3.5 w-3.5 text-emerald-400" />;
  if (trend === "down") return <ArrowDownRight className="h-3.5 w-3.5 text-red-400" />;
  if (trend === "flat") return <ArrowRight className="h-3.5 w-3.5 text-slate-400" />;
  return null;
}

export default function KpiTile({ kpi, onClick }: { kpi: KpiCard; onClick?: (kpi: KpiCard) => void }) {
  const unavailable = !kpi.available;
  return (
    <button
      type="button"
      onClick={() => onClick?.(kpi)}
      title={unavailable ? kpi.missingData : `${kpi.description}\n${KPI_STATUS_LABELS[kpi.status]}`}
      className={`rounded-xl border p-3 text-left transition hover:border-cyan-500/50 ${KPI_STATUS_STYLES[kpi.status]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] uppercase leading-tight tracking-wide text-slate-400">{kpi.name}</span>
        <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${DOT[kpi.status]}`} />
      </div>

      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`text-2xl font-black ${unavailable ? "text-slate-600" : "text-slate-100"}`}>
          {unavailable ? "n/d" : fmtValue(kpi.value, kpi.unit)}
        </span>
        {kpi.target != null && !unavailable && (
          <span className="text-[11px] text-slate-500">obj. {fmtValue(kpi.target, kpi.unit)}</span>
        )}
      </div>

      {unavailable ? (
        <div className="mt-1 flex items-start gap-1 text-[10px] leading-tight text-slate-500">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="line-clamp-2">{kpi.missingData ?? "Sin fuente de datos"}</span>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
          <span className="flex items-center gap-0.5">
            <TrendIcon trend={kpi.trend} />
            {kpi.isLive ? "vs. ayer" : "vs. periodo ant."} {fmtVariation(kpi.vsPrevDay)}
          </span>
          <span>· sem. {fmtVariation(kpi.vsPrevWeek)}</span>
          {kpi.status === "grey" && kpi.value !== null && <span className="text-slate-500">· muestra {kpi.sampleSize}</span>}
        </div>
      )}
    </button>
  );
}

export function KpiGrid({ kpis, onSelect }: { kpis: KpiCard[]; onSelect?: (kpi: KpiCard) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {kpis.map((k) => <KpiTile key={k.code} kpi={k} onClick={onSelect} />)}
    </div>
  );
}
