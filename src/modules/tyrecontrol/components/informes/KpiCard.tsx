import type { ReactNode } from "react";

type Tono = "neutral" | "ok" | "warn" | "danger" | "info";

const TONO_VALOR: Record<Tono, string> = {
  neutral: "text-slate-100",
  ok: "text-emerald-400",
  warn: "text-amber-400",
  danger: "text-rose-400",
  info: "text-sky-400",
};

// Tarjeta KPI del dashboard. Clicable si se pasa onClick (abre su informe).
export function KpiCard({
  title, value, hint, tono = "neutral", icon, onClick,
}: {
  title: string;
  value: ReactNode;
  hint?: string;
  tono?: Tono;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  const clicable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clicable}
      className={`rounded-lg bg-slate-800 p-4 text-left transition ${clicable ? "cursor-pointer hover:bg-slate-700/70" : "cursor-default"}`}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{title}</div>
        {icon && <span className="text-slate-500">{icon}</span>}
      </div>
      <div className={`mt-1 text-3xl font-black ${TONO_VALOR[tono]}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </button>
  );
}
