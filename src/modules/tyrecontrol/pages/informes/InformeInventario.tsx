import { useEffect, useState } from "react";
import { useInformesFiltros } from "./InformesLayout";
import { obtenerKpis, inventarioPor, inventarioMarcaMedida, distribucionProfundidad } from "../../services/informes";
import type { KpisInformes, DimensionTotal, MarcaMedidaTotal, ProfundidadDistribucion } from "../../types/informes";
import { ESTADO_NEUMATICO_LABELS } from "../../types";
import type { EstadoNeumatico } from "../../types";
import { TableWrap, tdCls, thCls } from "../../components/ui";
import { KpiCard } from "../../components/informes/KpiCard";
import { descargarCSV } from "../../utils/exportar";

function BotonCSV({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">Exportar CSV</button>;
}

function TablaDim({ titulo, columna, datos, etiquetar }: {
  titulo: string; columna: string; datos: DimensionTotal[]; etiquetar?: (s: string) => string;
}) {
  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase text-slate-400">{titulo}</div>
        <BotonCSV onClick={() => descargarCSV(titulo, [columna, "Total"], datos.map((d) => [etiquetar ? etiquetar(d.etiqueta) : d.etiqueta, d.total]))} />
      </div>
      <TableWrap>
        <thead className="bg-slate-900"><tr><th className={thCls}>{columna}</th><th className={thCls}>Total</th></tr></thead>
        <tbody>
          {datos.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={2}>Sin datos.</td></tr>
          : datos.map((d, i) => (
            <tr key={i} className="border-t border-slate-700/60">
              <td className={tdCls + " text-slate-200"}>{etiquetar ? etiquetar(d.etiqueta) : d.etiqueta}</td>
              <td className={tdCls + " font-semibold text-slate-100"}>{d.total}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

export default function InformeInventario() {
  const { filtros } = useInformesFiltros();
  const [kpis, setKpis] = useState<KpisInformes | null>(null);
  const [porMarca, setPorMarca] = useState<DimensionTotal[]>([]);
  const [porMedida, setPorMedida] = useState<DimensionTotal[]>([]);
  const [porModelo, setPorModelo] = useState<DimensionTotal[]>([]);
  const [porEstado, setPorEstado] = useState<DimensionTotal[]>([]);
  const [marcaMedida, setMarcaMedida] = useState<MarcaMedidaTotal[]>([]);
  const [prof, setProf] = useState<ProfundidadDistribucion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    Promise.all([
      obtenerKpis(filtros),
      inventarioPor(filtros, "marca"),
      inventarioPor(filtros, "medida"),
      inventarioPor(filtros, "modelo"),
      inventarioPor(filtros, "estado"),
      inventarioMarcaMedida(filtros),
      distribucionProfundidad(filtros),
    ])
      .then(([k, ma, me, mo, es, mm, pr]) => {
        if (!vivo) return;
        setKpis(k); setPorMarca(ma); setPorMedida(me); setPorModelo(mo); setPorEstado(es); setMarcaMedida(mm); setProf(pr);
      })
      .catch((e) => { if (vivo) setError(e?.message || "Error al cargar el inventario"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [filtros]);

  if (cargando && !kpis) return <div className="text-slate-400">Cargando inventario…</div>;
  if (error) return <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>;
  if (!kpis) return null;

  const etiquetaEstado = (s: string) => ESTADO_NEUMATICO_LABELS[s as EstadoNeumatico] ?? s;

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard title="Total controlados" value={kpis.neumaticos_total} />
        <KpiCard title="Montados" value={kpis.neumaticos_montados} tono="info" />
        <KpiCard title="En almacén" value={kpis.neumaticos_almacen} />
        <KpiCard title="En reparación" value={kpis.neumaticos_reparacion} />
        <KpiCard title="Descartados" value={kpis.neumaticos_descartados} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <TablaDim titulo="Por marca" columna="Marca" datos={porMarca} />
        <TablaDim titulo="Por medida" columna="Medida" datos={porMedida} />
        <TablaDim titulo="Por modelo" columna="Modelo" datos={porModelo} />
        <TablaDim titulo="Por estado" columna="Estado" datos={porEstado} etiquetar={etiquetaEstado} />
      </div>

      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase text-slate-400">Marca + medida</div>
          <BotonCSV onClick={() => descargarCSV("marca_medida", ["Marca", "Medida", "Total"], marcaMedida.map((d) => [d.marca, d.medida, d.total]))} />
        </div>
        <TableWrap>
          <thead className="bg-slate-900"><tr><th className={thCls}>Marca</th><th className={thCls}>Medida</th><th className={thCls}>Total</th></tr></thead>
          <tbody>
            {marcaMedida.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={3}>Sin datos.</td></tr>
            : marcaMedida.map((d, i) => (
              <tr key={i} className="border-t border-slate-700/60">
                <td className={tdCls + " text-slate-200"}>{d.marca}</td>
                <td className={tdCls + " text-slate-300"}>{d.medida}</td>
                <td className={tdCls + " font-semibold text-slate-100"}>{d.total}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase text-slate-400">Distribución por profundidad (última medición)</div>
          <BotonCSV onClick={() => descargarCSV("profundidades", ["Marca", "0-2", "2-4", "4-6", "6-8", "8-10", "+10", "Total"], prof.map((p) => [p.marca, p.r0_2, p.r2_4, p.r4_6, p.r6_8, p.r8_10, p.r10, p.total]))} />
        </div>
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Marca</th>
            <th className={thCls + " text-rose-300"}>🔴 0-2</th>
            <th className={thCls + " text-amber-300"}>🟡 2-4</th>
            <th className={thCls}>4-6</th>
            <th className={thCls}>6-8</th>
            <th className={thCls}>8-10</th>
            <th className={thCls + " text-emerald-300"}>🟢 +10</th>
            <th className={thCls}>Total</th>
          </tr></thead>
          <tbody>
            {prof.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={8}>Sin mediciones registradas todavía.</td></tr>
            : prof.map((p, i) => (
              <tr key={i} className="border-t border-slate-700/60">
                <td className={tdCls + " text-slate-200"}>{p.marca}</td>
                <td className={tdCls + " text-rose-300"}>{p.r0_2 || ""}</td>
                <td className={tdCls + " text-amber-300"}>{p.r2_4 || ""}</td>
                <td className={tdCls + " text-slate-300"}>{p.r4_6 || ""}</td>
                <td className={tdCls + " text-slate-300"}>{p.r6_8 || ""}</td>
                <td className={tdCls + " text-slate-300"}>{p.r8_10 || ""}</td>
                <td className={tdCls + " text-emerald-300"}>{p.r10 || ""}</td>
                <td className={tdCls + " font-semibold text-slate-100"}>{p.total}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="mt-2 text-[11px] text-slate-500">Rangos en mm. Serán configurables en una próxima fase. Los neumáticos sin ninguna revisión no aparecen aquí.</div>
      </div>
    </div>
  );
}
