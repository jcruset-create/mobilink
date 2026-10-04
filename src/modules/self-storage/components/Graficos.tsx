/**
 * Gráficos sencillos del módulo (sin librería: el panel no tiene ninguna y
 * TyreControl ya dibuja los suyos a mano).
 *
 * Paleta validada contra la superficie oscura del panel (#1e293b) con el
 * validador de la guía de visualización: azul, naranja y aqua pasan banda de
 * luminosidad, croma, separación para daltonismo (ΔE 9,4) y contraste ≥ 3:1.
 * El color sigue a la ENTIDAD (humano siempre azul, IA siempre naranja…),
 * nunca al orden. Los textos van en tinta de texto, no en el color de la serie.
 */

import { useState } from "react";

import { SERIE } from "./paleta";

const nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

/** Barras horizontales con su valor escrito al lado (magnitud por categoría). */
export function BarrasH({ datos, color = SERIE.azul, vacio = "Sin datos" }: { datos: { label: string; valor: number }[]; color?: string; vacio?: string }) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  if (!datos.length) return <p className="text-[12px] text-slate-500">{vacio}</p>;
  return (
    <ul className="space-y-1.5">
      {datos.map((d) => (
        <li key={d.label} className="group grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-[12px]" title={`${d.label}: ${nf.format(d.valor)}`}>
          <span className="truncate text-slate-300">{d.label}</span>
          <span className="h-2.5 rounded-r bg-slate-800">
            <span className="block h-full rounded-r transition-opacity group-hover:opacity-80" style={{ width: `${(d.valor / max) * 100}%`, backgroundColor: color, minWidth: d.valor ? 3 : 0 }} />
          </span>
          <span className="tabular-nums text-slate-200">{nf.format(d.valor)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Columnas por día (una o varias series agrupadas), con tooltip al pasar por
 * encima. Una sola escala: si las series no son comparables, dos gráficos.
 */
export function Columnas({
  dias,
  series,
  formato = (v: number) => nf.format(v),
}: {
  dias: string[];
  series: { nombre: string; color: string; valores: number[] }[];
  formato?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!dias.length) return <p className="text-[12px] text-slate-500">Sin datos en el periodo</p>;
  const max = Math.max(1, ...series.flatMap((s) => s.valores));
  const etiquetaCada = Math.max(1, Math.ceil(dias.length / 8));
  const corto = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);
  return (
    <div>
      {series.length > 1 && (
        <div className="mb-1 flex flex-wrap gap-3 text-[11px] text-slate-300">
          {series.map((s) => (
            <span key={s.nombre} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} /> {s.nombre}
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <div className="flex h-32 items-end gap-[2px] border-b border-slate-700" onMouseLeave={() => setHover(null)}>
          {dias.map((d, i) => (
            <div key={d} className="flex h-full flex-1 cursor-default items-end justify-center gap-px" onMouseEnter={() => setHover(i)}>
              {series.map((s) => (
                <div
                  key={s.nombre}
                  className="w-full max-w-4 rounded-t-[3px]"
                  style={{ height: `${(s.valores[i] / max) * 100}%`, backgroundColor: s.color, opacity: hover === null || hover === i ? 1 : 0.45, minHeight: s.valores[i] ? 2 : 0 }}
                />
              ))}
            </div>
          ))}
        </div>
        {hover !== null && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 shadow"
            style={{ left: `${Math.min(80, (hover / dias.length) * 100)}%` }}
          >
            <div className="font-semibold">{corto(dias[hover])}</div>
            {series.map((s) => (
              <div key={s.nombre} className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
                {s.nombre}: {formato(s.valores[hover])}
              </div>
            ))}
          </div>
        )}
        <div className="mt-1 flex gap-[2px] text-[10px] text-slate-500">
          {dias.map((d, i) => (
            <div key={d} className="flex-1 text-center">
              {i % etiquetaCada === 0 ? corto(d) : ""}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Reparto de un total (p. ej. humano / IA / híbrido): barra apilada + leyenda con valor y %. */
export function Reparto({ partes }: { partes: { label: string; valor: number; color: string }[] }) {
  const total = partes.reduce((a, p) => a + p.valor, 0);
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-slate-800" role="img" aria-label={partes.map((p) => `${p.label} ${p.valor}`).join(", ")}>
        {total > 0 && partes.map((p) => (p.valor ? <div key={p.label} title={`${p.label}: ${p.valor}`} style={{ width: `${(p.valor / total) * 100}%`, backgroundColor: p.color }} /> : null))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-300">
        {partes.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
            {p.label} <span className="tabular-nums text-slate-100">{p.valor}</span>
            <span className="text-slate-500">({total ? nf.format((100 * p.valor) / total) : 0} %)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Indicador: número grande con su etiqueta (no es un gráfico). */
export function Indicador({ titulo, valor, detalle }: { titulo: string; valor: string | number; detalle?: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{titulo}</div>
      <div className="mt-0.5 text-2xl font-black tabular-nums text-slate-100">{valor}</div>
      {detalle && <div className="text-[11px] text-slate-400">{detalle}</div>}
    </div>
  );
}
