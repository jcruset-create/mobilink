import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useInformesFiltros } from "./InformesLayout";
import { desgaste } from "../../services/informes";
import type { DesgasteNeumatico } from "../../types/informes";
import { KpiCard } from "../../components/informes/KpiCard";
import { TableWrap, tdCls, thCls } from "../../components/ui";
import { descargarCSV } from "../../utils/exportar";

function fmtFecha(f: string | null): string {
  if (!f) return "—";
  return new Date(f).toLocaleDateString("es-ES");
}

export default function InformeDesgaste() {
  const { filtros } = useInformesFiltros();
  const [items, setItems] = useState<DesgasteNeumatico[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    desgaste(filtros)
      .then((r) => { if (vivo) setItems(r); })
      .catch((e) => { if (vivo) setError(e?.message || "Error al calcular el desgaste"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  if (cargando && items.length === 0) return <div className="text-slate-400">Calculando desgaste…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;

  const hoy = new Date();
  const en60 = new Date(); en60.setDate(hoy.getDate() + 60);
  const vencidos = items.filter((i) => i.fecha_prevista && new Date(i.fecha_prevista) <= hoy).length;
  const proximos = items.filter((i) => i.fecha_prevista && new Date(i.fecha_prevista) > hoy && new Date(i.fecha_prevista) <= en60).length;

  const filaColor = (i: DesgasteNeumatico) => {
    if (i.fecha_prevista && new Date(i.fecha_prevista) <= hoy) return "text-rose-300";
    if (i.fecha_prevista && new Date(i.fecha_prevista) <= en60) return "text-amber-300";
    return "text-slate-200";
  };

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard title="Con predicción" value={items.length} hint="Neumáticos con ≥2 mediciones y km" />
        <KpiCard title="Sustitución vencida" value={vencidos} tono={vencidos > 0 ? "danger" : "ok"} />
        <KpiCard title="Sustituir en 60 días" value={proximos} tono={proximos > 0 ? "warn" : "ok"} />
      </div>

      <div className="rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase text-slate-400">Predicción de sustitución ({items.length})</div>
          <button
            onClick={() => descargarCSV("desgaste", ["Neumático", "Marca", "Modelo", "Medida", "Última prof (mm)", "Desgaste (mm/1000km)", "Km restantes", "Fecha prevista", "Nº medidas"],
              items.map((i) => [i.codigo, i.marca, i.modelo, i.medida, i.ultima_prof ?? "", i.mm_por_1000km ?? "", i.km_restantes ?? "", i.fecha_prevista ?? "", i.n_medidas]))}
            className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
          >Exportar CSV</button>
        </div>
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Neumático</th><th className={thCls}>Marca / modelo</th><th className={thCls}>Medida</th>
            <th className={thCls}>Última prof.</th><th className={thCls}>Desgaste</th><th className={thCls}>Km restantes</th>
            <th className={thCls}>Sustitución prevista</th><th className={thCls}>Medidas</th>
          </tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={8}>Sin datos: se necesitan al menos 2 revisiones con km por neumático.</td></tr>
            : items.map((i) => (
              <tr key={i.neumatico_id} className="border-t border-slate-700/60">
                <td className={tdCls + " font-semibold"}><Link to={`/tyrecontrol/neumaticos/${i.neumatico_id}`} className="text-sky-300 hover:underline">{i.codigo ?? "—"}</Link></td>
                <td className={tdCls + " text-slate-400"}>{[i.marca, i.modelo].filter(Boolean).join(" ") || "—"}</td>
                <td className={tdCls + " text-slate-400"}>{i.medida ?? "—"}</td>
                <td className={tdCls + " text-slate-200"}>{i.ultima_prof != null ? `${i.ultima_prof} mm` : "—"}</td>
                <td className={tdCls + " text-slate-400"}>{i.mm_por_1000km != null ? `${i.mm_por_1000km} mm/1000km` : "—"}</td>
                <td className={tdCls + " text-slate-400"}>{i.km_restantes != null ? Number(i.km_restantes).toLocaleString("es-ES") : "—"}</td>
                <td className={tdCls + " font-semibold " + filaColor(i)}>{fmtFecha(i.fecha_prevista)}</td>
                <td className={tdCls + " text-slate-500"}>{i.n_medidas}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      <div className="mt-3 text-[11px] text-slate-500">
        Proyección lineal a partir de la primera y la última medición de cada neumático (profundidad, km y fecha). Km restantes hasta el mínimo legal (1,6 mm).
        Solo aparecen neumáticos con ≥2 revisiones que tengan km del vehículo. Si un neumático cambió de vehículo entre medidas, el ritmo puede quedar distorsionado.
      </div>
    </div>
  );
}
