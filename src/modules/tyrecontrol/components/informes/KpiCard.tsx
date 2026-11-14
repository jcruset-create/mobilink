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
//
// `activo` marca el cuadro cuyo filtro se está viendo: cuando un cuadro filtra
// la lista de debajo, tiene que verse cuál manda sin mirar la lista. El que
// las enseña todas no se marca: sin filtro no hay nada que señalar.
export function KpiCard({
  title, value, hint, tono = "neutral", icon, onClick, activo = false,
}: {
  title: string;
  value: ReactNode;
  hint?: string;
  tono?: Tono;
  icon?: ReactNode;
  onClick?: () => void;
  activo?: boolean;
}) {
  const clicable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clicable}
      aria-pressed={clicable ? activo : undefined}
      className={`rounded-lg bg-slate-800 p-4 text-left transition ${clicable ? "cursor-pointer hover:bg-slate-700/70" : "cursor-default"} ${
        activo ? "ring-2 ring-sky-400" : ""}`}
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

/**
 * La etiqueta que dice qué filtro hay puesto sobre una lista, con su ✕.
 *
 * Va junto al título de la lista y no solo en el cuadro: en un informe largo
 * el cuadro marcado queda fuera de la vista al bajar, y una lista corta sin
 * explicación parece un informe roto.
 */
export function FiltroActivo({ texto, onQuitar }: { texto: string; onQuitar: () => void }) {
  return (
    <button
      type="button"
      onClick={onQuitar}
      className="rounded-full border border-sky-500/50 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/20"
      title="Quitar el filtro y verlo todo"
    >{texto} ✕</button>
  );
}
