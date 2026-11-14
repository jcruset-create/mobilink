import { useEffect, useState } from "react";
import { useInformesFiltros } from "./InformesLayout";
import { productividad } from "../../services/informes";
import type { ProductividadTecnico } from "../../types/informes";
import { FiltroActivo, KpiCard } from "../../components/informes/KpiCard";
import { tecnicosPorMetrica, NOMBRE_METRICA, type MetricaProductividad } from "../../services/cuadrosInformes";
import { BarList } from "../../components/informes/charts";
import { TableWrap, tdCls, thCls } from "../../components/ui";
import { descargarCSV } from "../../utils/exportar";

export default function InformeProductividad() {
  const { filtros } = useInformesFiltros();
  const [items, setItems] = useState<ProductividadTecnico[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [metrica, setMetrica] = useState<MetricaProductividad | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    productividad(filtros)
      .then((r) => { if (vivo) setItems(r); })
      .catch((e) => { if (vivo) setError(e?.message || "Error al cargar productividad"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  if (cargando && items.length === 0) return <div className="text-slate-400">Cargando…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;

  const totRev = items.reduce((s, i) => s + i.revisiones, 0);
  const totNeu = items.reduce((s, i) => s + i.neumaticos_revisados, 0);
  const totOps = items.reduce((s, i) => s + i.operaciones, 0);
  // Aquí el cuadro elige por qué número se mira: deja a los técnicos que
  // tienen algo de eso, del que más al que menos, y la gráfica lo sigue.
  const visibles = tecnicosPorMetrica(items, metrica);
  const enGrafica: MetricaProductividad = metrica ?? "revisiones";
  const alternar = (m: MetricaProductividad) => setMetrica((actual) => (actual === m ? null : m));

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Técnicos activos" value={items.length} onClick={() => setMetrica(null)} />
        <KpiCard title="Revisiones (periodo)" value={totRev} tono="info"
                 activo={metrica === "revisiones"} onClick={() => alternar("revisiones")} />
        <KpiCard title="Neumáticos revisados" value={totNeu}
                 activo={metrica === "neumaticos_revisados"} onClick={() => alternar("neumaticos_revisados")} />
        <KpiCard title="Operaciones" value={totOps}
                 activo={metrica === "operaciones"} onClick={() => alternar("operaciones")} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg bg-slate-800 p-4">
          <div className="mb-3 text-[11px] font-bold uppercase text-slate-400">{NOMBRE_METRICA[enGrafica]} por técnico</div>
          <BarList items={visibles.slice(0, 10).map((i) => ({ etiqueta: i.tecnico, valor: i[enGrafica] }))} />
        </div>
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="text-[11px] font-bold uppercase text-slate-400">Detalle por técnico ({visibles.length})</div>
            {metrica && <FiltroActivo texto={`Con ${NOMBRE_METRICA[metrica].toLowerCase()}`} onQuitar={() => setMetrica(null)} />}
            <span className="flex-1" />
            <button
              onClick={() => descargarCSV("productividad", ["Técnico", "Revisiones", "Neumáticos revisados", "Operaciones"],
                visibles.map((i) => [i.tecnico, i.revisiones, i.neumaticos_revisados, i.operaciones]))}
              className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
            >Exportar CSV</button>
          </div>
          <TableWrap>
            <thead className="bg-slate-900"><tr>
              <th className={thCls}>Técnico</th><th className={thCls}>Revisiones</th><th className={thCls}>Neum. revisados</th><th className={thCls}>Operaciones</th>
            </tr></thead>
            <tbody>
              {visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={4}>Sin actividad en el periodo.</td></tr>
              : visibles.map((i) => (
                <tr key={i.tecnico_id ?? i.tecnico} className="border-t border-slate-700/60">
                  <td className={tdCls + " font-semibold text-slate-200"}>{i.tecnico}</td>
                  <td className={tdCls + " text-slate-300"}>{i.revisiones}</td>
                  <td className={tdCls + " text-slate-400"}>{i.neumaticos_revisados}</td>
                  <td className={tdCls + " text-slate-400"}>{i.operaciones}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-slate-500">
        Actividad en el rango de fechas del filtro (por defecto, el mes actual). El técnico es quien creó cada revisión/operación.
      </div>
    </div>
  );
}
