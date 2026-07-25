/**
 * Centro de Inteligencia Operacional — gráficas ligeras en SVG.
 *
 * Sin librerías de charting: el módulo ya arrastra Leaflet y no merece la pena
 * añadir otra dependencia para series pequeñas. Todo es SVG responsive.
 */

import { useMemo } from "react";

export type Series = { label: string; color: string; values: Array<number | null> };

/** Gráfica de líneas con eje temporal ya formateado en `labels`. */
export function LineChart({
  labels, series, height = 180, unit = "", emptyMessage = "Sin datos en el periodo",
}: {
  labels: string[];
  series: Series[];
  height?: number;
  unit?: string;
  emptyMessage?: string;
}) {
  const { min, max, hasData } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
    if (!all.length) return { min: 0, max: 1, hasData: false };
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.15 || 1;
    return { min: Math.max(0, lo - pad), max: hi + pad, hasData: true };
  }, [series]);

  if (!hasData || labels.length < 2) {
    return <div className="flex h-[180px] items-center justify-center text-[13px] text-slate-500">{emptyMessage}</div>;
  }

  const W = 1000;
  const H = height;
  const padL = 44;
  const padB = 22;
  const padT = 10;
  const x = (i: number) => padL + (i * (W - padL - 10)) / Math.max(1, labels.length - 1);
  const y = (v: number) => padT + (1 - (v - min) / (max - min || 1)) * (H - padT - padB);

  const ticks = [min, min + (max - min) / 2, max];
  const step = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[520px]" preserveAspectRatio="none">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - 10} y1={y(t)} y2={y(t)} stroke="#334155" strokeWidth="1" strokeDasharray="4 4" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fill="#64748b" fontSize="11">
              {Math.round(t * 10) / 10}{unit}
            </text>
          </g>
        ))}

        {series.map((s) => {
          const points = s.values
            .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
            .filter(Boolean)
            .join(" ");
          return (
            <g key={s.label}>
              <polyline points={points} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {s.values.map((v, i) => (v == null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill={s.color} />
              )))}
            </g>
          );
        })}

        {labels.map((l, i) => (i % step === 0 ? (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fill="#64748b" fontSize="11">{l}</text>
        ) : null))}
      </svg>

      <div className="mt-1 flex flex-wrap gap-3 pl-10">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Barras verticales simples, con color opcional por barra. */
export function BarChart({
  labels, values, colors, height = 160, unit = "", emptyMessage = "Sin datos",
}: {
  labels: string[];
  values: number[];
  colors?: string[];
  height?: number;
  unit?: string;
  emptyMessage?: string;
}) {
  if (!values.length || values.every((v) => !v)) {
    return <div className="flex h-[140px] items-center justify-center text-[13px] text-slate-500">{emptyMessage}</div>;
  }
  const max = Math.max(...values) || 1;
  const W = 1000;
  const H = height;
  const padB = 26;
  const gap = 4;
  const bw = (W - 20) / values.length - gap;
  const step = Math.max(1, Math.ceil(values.length / 12));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[520px]" preserveAspectRatio="none">
        {values.map((v, i) => {
          const h = ((v / max) * (H - padB - 14)) || 0;
          const x = 10 + i * (bw + gap);
          return (
            <g key={i}>
              <rect x={x} y={H - padB - h} width={bw} height={h} rx="3" fill={colors?.[i] ?? "#22d3ee"} opacity="0.85" />
              <text x={x + bw / 2} y={H - padB - h - 4} textAnchor="middle" fill="#94a3b8" fontSize="11">
                {Math.round(v * 10) / 10}{unit}
              </text>
              {i % step === 0 && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" fill="#64748b" fontSize="11">{labels[i]}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
