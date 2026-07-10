import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useInformesFiltros } from "./InformesLayout";
import { rankingVehiculos, rankingMarcas } from "../../services/informes";
import type { RankingVehiculo, RankingMarca } from "../../types/informes";
import { TableWrap, tdCls, thCls } from "../../components/ui";
import { descargarCSV } from "../../utils/exportar";

const eur = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur3 = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 3 });

type OrdenVeh = "coste_km" | "coste" | "pinchazos" | "reparaciones";
const ORDENES: { k: OrdenVeh; label: string }[] = [
  { k: "coste_km", label: "Mayor coste/km" },
  { k: "coste", label: "Mayor coste" },
  { k: "pinchazos", label: "Más pinchazos" },
  { k: "reparaciones", label: "Más reparaciones" },
];

export default function InformeRankings() {
  const { filtros } = useInformesFiltros();
  const [tab, setTab] = useState<"vehiculos" | "marcas">("vehiculos");
  const [orden, setOrden] = useState<OrdenVeh>("coste_km");
  const [veh, setVeh] = useState<RankingVehiculo[]>([]);
  const [marcas, setMarcas] = useState<RankingMarca[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true; setError("");
    if (tab === "vehiculos") rankingVehiculos(filtros, orden).then((r) => vivo && setVeh(r)).catch((e) => vivo && setError(e?.message || "Error"));
    else rankingMarcas(filtros).then((r) => vivo && setMarcas(r)).catch((e) => vivo && setError(e?.message || "Error"));
    return () => { vivo = false; };
  }, [filtros, tab, orden]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          <button onClick={() => setTab("vehiculos")} className={`rounded px-3 py-1.5 text-[12px] font-semibold ${tab === "vehiculos" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300"}`}>Vehículos</button>
          <button onClick={() => setTab("marcas")} className={`rounded px-3 py-1.5 text-[12px] font-semibold ${tab === "marcas" ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300"}`}>Marcas</button>
        </div>
        {tab === "vehiculos" && (
          <div className="ml-auto flex gap-1">
            {ORDENES.map((o) => (
              <button key={o.k} onClick={() => setOrden(o.k)} className={`rounded px-2 py-1 text-[11px] ${orden === o.k ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-400"}`}>{o.label}</button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="mb-2 text-sm text-rose-300">{error}</div>}

      {tab === "vehiculos" ? (
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 flex justify-end">
            <button onClick={() => descargarCSV("ranking_vehiculos", ["Matrícula", "Km", "Coste total", "Coste/km", "Pinchazos", "Reparaciones"],
              veh.map((v) => [v.matricula, v.km, v.coste_total, v.coste_km ?? "", v.n_pinchazos, v.n_reparaciones]))}
              className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">Exportar CSV</button>
          </div>
          <TableWrap>
            <thead className="bg-slate-900"><tr>
              <th className={thCls}>Matrícula</th><th className={thCls}>Km</th><th className={thCls}>Coste total</th>
              <th className={thCls}>Coste/km</th><th className={thCls}>Pinchazos</th><th className={thCls}>Reparaciones</th>
            </tr></thead>
            <tbody>
              {veh.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={6}>Sin datos.</td></tr>
              : veh.map((v) => (
                <tr key={v.vehiculo_id} className="border-t border-slate-700/60">
                  <td className={tdCls + " font-semibold"}><Link to={`/tyrecontrol/vehiculos/${v.vehiculo_id}`} className="text-sky-300 hover:underline">{v.matricula}</Link></td>
                  <td className={tdCls + " text-slate-400"}>{Number(v.km).toLocaleString("es-ES")}</td>
                  <td className={tdCls + " text-slate-200"}>{eur(v.coste_total)}</td>
                  <td className={tdCls + " text-slate-200"}>{v.coste_km != null ? eur3(v.coste_km) : "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{v.n_pinchazos}</td>
                  <td className={tdCls + " text-slate-400"}>{v.n_reparaciones}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      ) : (
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 flex justify-end">
            <button onClick={() => descargarCSV("ranking_marcas", ["Marca", "Neumáticos", "Coste medio", "Prof. media (mm)", "Reparaciones"],
              marcas.map((m) => [m.marca, m.n_neumaticos, m.coste_medio, m.prof_media ?? "", m.n_reparaciones]))}
              className="rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700">Exportar CSV</button>
          </div>
          <TableWrap>
            <thead className="bg-slate-900"><tr>
              <th className={thCls}>Marca</th><th className={thCls}>Neumáticos</th><th className={thCls}>Coste medio</th>
              <th className={thCls}>Prof. media</th><th className={thCls}>Reparaciones</th>
            </tr></thead>
            <tbody>
              {marcas.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={5}>Sin datos.</td></tr>
              : marcas.map((m) => (
                <tr key={m.marca} className="border-t border-slate-700/60">
                  <td className={tdCls + " font-semibold text-slate-200"}>{m.marca}</td>
                  <td className={tdCls + " text-slate-400"}>{m.n_neumaticos}</td>
                  <td className={tdCls + " text-slate-200"}>{m.coste_medio ? eur(m.coste_medio) : "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{m.prof_media != null ? `${m.prof_media} mm` : "—"}</td>
                  <td className={tdCls + " text-slate-400"}>{m.n_reparaciones}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}

      <div className="mt-3 text-[11px] text-slate-500">
        Coste por vehículo = coste de compra de sus neumáticos montados + costes de sus operaciones. Coste/km sobre el odómetro actual.
        Vida útil media y coste/km por marca llegarán cuando registremos duración de montaje y km por neumático.
      </div>
    </div>
  );
}
