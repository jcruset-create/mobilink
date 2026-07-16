import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useInformesFiltros } from "./InformesLayout";
import { presiones } from "../../services/informes";
import type { PresionNeumatico } from "../../types/informes";
import { KpiCard } from "../../components/informes/KpiCard";
import { TableWrap, tdCls, thCls } from "../../components/ui";
import { descargarCSV } from "../../utils/exportar";

const ESTADO: Record<string, { label: string; cls: string }> = {
  baja: { label: "Baja", cls: "text-rose-300" },
  alta: { label: "Alta", cls: "text-amber-300" },
  ok: { label: "Correcta", cls: "text-emerald-300" },
  sin_referencia: { label: "Sin referencia", cls: "text-slate-500" },
};

const bar = (n: number | null) => (n != null ? `${n.toFixed(1)} bar` : "—");

export default function InformePresiones() {
  const { filtros } = useInformesFiltros();
  const [items, setItems] = useState<PresionNeumatico[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    presiones(filtros)
      .then((r) => { if (vivo) setItems(r); })
      .catch((e) => { if (vivo) setError(e?.message || "Error al cargar presiones"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  if (cargando && items.length === 0) return <div className="text-slate-400">Cargando…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;

  const n = (e: string) => items.filter((i) => i.estado === e).length;

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Presión baja" value={n("baja")} tono={n("baja") > 0 ? "danger" : "ok"} />
        <KpiCard title="Sobrepresión" value={n("alta")} tono={n("alta") > 0 ? "warn" : "ok"} />
        <KpiCard title="Correctas" value={n("ok")} tono="ok" />
        <KpiCard title="Sin referencia" value={n("sin_referencia")} hint="Falta presión de catálogo" />
      </div>

      <div className="rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase text-slate-400">Presiones de neumáticos montados ({items.length})</div>
          <button
            onClick={() => descargarCSV("presiones", ["Neumático", "Matrícula", "Posición", "Medida (bar)", "Recomendada (bar)", "Diferencia", "Estado"],
              items.map((i) => [i.codigo, i.matricula, i.posicion, i.presion_medida ?? "", i.presion_recomendada ?? "", i.diferencia ?? "", i.estado]))}
            className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
          >Exportar CSV</button>
        </div>
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Neumático</th><th className={thCls}>Matrícula</th><th className={thCls}>Posición</th>
            <th className={thCls}>Medida</th><th className={thCls}>Recomendada</th><th className={thCls}>Diferencia</th><th className={thCls}>Estado</th>
          </tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={7}>Sin presiones registradas.</td></tr>
            : items.map((i) => {
              const est = ESTADO[i.estado] ?? { label: i.estado, cls: "text-slate-300" };
              return (
                <tr key={i.neumatico_id} className="border-t border-slate-700/60">
                  <td className={tdCls + " font-semibold"}><Link to={`/tyrecontrol/neumaticos/${i.neumatico_id}`} className="text-sky-300 hover:underline">{i.codigo ?? "—"}</Link></td>
                  <td className={tdCls + " text-slate-400"}>{i.matricula ?? "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{i.posicion ?? "—"}</td>
                  <td className={tdCls + " text-slate-200"}>{bar(i.presion_medida)}</td>
                  <td className={tdCls + " text-slate-400"}>{bar(i.presion_recomendada)}</td>
                  <td className={tdCls + " text-slate-400"}>{i.diferencia != null ? `${i.diferencia > 0 ? "+" : ""}${i.diferencia.toFixed(1)} bar` : "—"}</td>
                  <td className={tdCls + " font-semibold " + est.cls}>{est.label}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        <div className="mt-2 text-[11px] text-slate-500">
          Presión medida = última revisión de cada neumático montado. Recomendada = catálogo de referencias por marca+modelo+medida.
          El margen «baja/alta» usa la tolerancia de presión de la empresa (por defecto ±0,5 bar; se configura en la ficha de la empresa).
        </div>
      </div>
    </div>
  );
}
