// Gráficos ligeros en SVG puro (sin dependencias externas), tematizados al
// mismo estilo slate del resto de la app. Suficientes para donut, barras y
// evolución mensual del dashboard; para gráficos más complejos (heatmaps,
// series densas) se puede introducir una librería más adelante.

export interface Segmento {
  etiqueta: string;
  valor: number;
  color: string;
}

export function Donut({ segmentos, size = 150, grosor = 20 }: { segmentos: Segmento[]; size?: number; grosor?: number }) {
  const total = segmentos.reduce((s, x) => s + x.valor, 0);
  const r = (size - grosor) / 2;
  const c = 2 * Math.PI * r;
  let acumulado = 0;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={grosor} />
          {total > 0 && segmentos.map((s, i) => {
            const frac = s.valor / total;
            const dash = frac * c;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={grosor}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-acumulado}
              />
            );
            acumulado += dash;
            return el;
          })}
        </g>
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="fill-slate-100 text-2xl font-black">{total}</text>
      </svg>
      <div className="flex flex-col gap-1">
        {segmentos.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color }} />
            <span className="text-slate-300">{s.etiqueta}</span>
            <span className="ml-auto font-semibold text-slate-100">{s.valor}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarList({ items, color = "#38bdf8", max: maxProp, formato }: {
  items: { etiqueta: string; valor: number }[];
  color?: string;
  max?: number;
  formato?: (n: number) => string;
}) {
  const max = maxProp ?? Math.max(1, ...items.map((i) => i.valor));
  const fmt = formato ?? ((n: number) => String(n));
  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 && <div className="text-sm text-slate-500">Sin datos.</div>}
      {items.map((i, idx) => (
        <div key={idx}>
          <div className="mb-0.5 flex justify-between text-[12px]">
            <span className="text-slate-300">{i.etiqueta}</span>
            <span className="font-semibold text-slate-100">{fmt(i.valor)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-slate-900">
            <div className="h-full rounded" style={{ width: `${(i.valor / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Barras verticales para evolución temporal (p. ej. revisiones por mes).
export function ColumnChart({ items, color = "#0ea5e9", height = 120 }: {
  items: { etiqueta: string; valor: number }[];
  color?: string;
  height?: number;
}) {
  const max = Math.max(1, ...items.map((i) => i.valor));
  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {items.length === 0 && <div className="text-sm text-slate-500">Sin datos.</div>}
      {items.map((i, idx) => (
        <div key={idx} className="flex flex-1 flex-col items-center justify-end gap-1">
          <div className="text-[10px] text-slate-300">{i.valor}</div>
          <div className="w-full rounded-t" style={{ height: `${(i.valor / max) * (height - 30)}px`, background: color, minHeight: i.valor > 0 ? 3 : 0 }} />
          <div className="text-[9px] text-slate-500">{i.etiqueta}</div>
        </div>
      ))}
    </div>
  );
}
