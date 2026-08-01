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

/**
 * Serie temporal de una sola magnitud continua (p. ej. profundidad media por
 * mes). Una serie por gráfico a propósito: mezclar dos magnitudes con escalas
 * distintas obligaría a un segundo eje, y un doble eje permite "demostrar"
 * casi cualquier correlación según cómo se escale cada lado.
 *
 * Los meses sin dato se dibujan como hueco, no como cero: no es lo mismo
 * "ese mes la media fue 0" que "ese mes no se midió nada".
 */
export function LineChart({ items, color = "#38bdf8", height = 140, sufijo = "" }: {
  items: { etiqueta: string; valor: number | null }[];
  color?: string;
  height?: number;
  sufijo?: string;
}) {
  const conDato = items.filter((i) => i.valor != null) as { etiqueta: string; valor: number }[];
  if (conDato.length === 0) return <div className="text-sm text-slate-500">Sin datos en el periodo.</div>;

  const W = 600, H = height, pad = { t: 12, r: 8, b: 22, l: 34 };
  const vals = conDato.map((i) => i.valor);
  const min = Math.min(...vals), max = Math.max(...vals);
  // Un margen del 10% evita que la línea quede pegada al borde cuando la
  // variación real es pequeña; si todos los valores son iguales, se centra.
  const span = max - min || Math.max(1, max * 0.2);
  const y0 = min - span * 0.1, y1 = max + span * 0.1;
  const px = (i: number) => pad.l + (i / Math.max(1, items.length - 1)) * (W - pad.l - pad.r);
  const py = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);

  // Cada tramo continuo se dibuja por separado para respetar los huecos.
  const tramos: string[] = [];
  let actual: string[] = [];
  items.forEach((it, i) => {
    if (it.valor == null) { if (actual.length) { tramos.push(actual.join(" ")); actual = []; } return; }
    actual.push(`${actual.length ? "L" : "M"}${px(i).toFixed(1)},${py(it.valor).toFixed(1)}`);
  });
  if (actual.length) tramos.push(actual.join(" "));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img">
      {[y1, (y0 + y1) / 2, y0].map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={py(v)} y2={py(v)} stroke="#1e293b" strokeWidth={1} />
          <text x={pad.l - 5} y={py(v) + 3} textAnchor="end" className="fill-slate-500" style={{ fontSize: 9 }}>
            {v.toFixed(1)}
          </text>
        </g>
      ))}
      {tramos.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {items.map((it, i) => it.valor == null ? null : (
        <g key={i}>
          {/* El punto visible es pequeño; el área sensible al ratón es amplia. */}
          <circle cx={px(i)} cy={py(it.valor)} r={3} fill={color} stroke="#0f172a" strokeWidth={2} />
          <circle cx={px(i)} cy={py(it.valor)} r={12} fill="transparent">
            <title>{`${it.etiqueta}: ${it.valor}${sufijo}`}</title>
          </circle>
        </g>
      ))}
      {items.map((it, i) => (
        // Con 12 meses no caben 12 etiquetas: se rotulan una de cada dos.
        i % 2 === 0 ? (
          <text key={i} x={px(i)} y={H - 6} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 9 }}>
            {it.etiqueta.slice(2)}
          </text>
        ) : null
      ))}
    </svg>
  );
}
