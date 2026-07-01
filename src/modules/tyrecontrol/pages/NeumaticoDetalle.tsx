import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { obtenerNeumatico, historialNeumatico, montajeActualDeNeumatico } from "../services/data";
import type { HistorialMontaje, MontajeActual, Neumatico } from "../types";
import { ESTADO_NEUMATICO_LABELS } from "../types";
import { TableWrap, tdCls, thCls } from "../components/ui";

export default function NeumaticoDetalle() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [n, setN] = useState<Neumatico | null>(null);
  const [montaje, setMontaje] = useState<MontajeActual | null>(null);
  const [historial, setHistorial] = useState<HistorialMontaje[]>([]);

  useEffect(() => {
    obtenerNeumatico(id).then(setN);
    montajeActualDeNeumatico(id).then(setMontaje);
    historialNeumatico(id).then(setHistorial);
  }, [id]);

  const dato = (l: string, v?: string | null) => (
    <div><div className="text-[10px] text-slate-400">{l}</div><div className="text-sm text-slate-200">{v || "—"}</div></div>
  );
  if (!n) return <div className="text-slate-400">Cargando…</div>;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate("/tyrecontrol/neumaticos")} className="rounded bg-slate-800 px-3 py-1 text-[12px] text-slate-200">← Neumáticos</button>
        <h1 className="text-lg font-black">{n.codigo_interno ?? n.numero_serie ?? "Neumático"}</h1>
        <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-bold text-slate-200">{ESTADO_NEUMATICO_LABELS[n.estado]}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Datos técnicos</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {dato("Empresa", n.empresa?.nombre)}{dato("Nº serie", n.numero_serie)}{dato("DOT", n.dot)}
            {dato("RFID", n.rfid_epc)}{dato("Marca", n.marca)}{dato("Modelo", n.modelo)}
            {dato("Medida", n.medida)}{dato("Índice carga", n.indice_carga)}{dato("Índice velocidad", n.indice_velocidad)}
            {dato("Proveedor", n.proveedor)}{dato("Fecha compra", n.fecha_compra)}
            {dato("Coste", n.coste_compra != null ? `${n.coste_compra} €` : null)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Estado y almacén</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {dato("Estado técnico", ESTADO_NEUMATICO_LABELS[n.estado])}
            {dato("Referencia almacén", n.referencia_almacen)}
            {dato("Sincronizado almacén", n.sincronizado_almacen ? "Sí" : "No")}
            {dato("Montaje actual", montaje ? `${montaje.posicion?.codigo_posicion ?? ""} · desde ${montaje.fecha_montaje}` : "No montado")}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">El stock físico y los movimientos se gestionan en el módulo de Almacén.</div>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Historial de montajes ({historial.length})</div>
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Montaje</th><th className={thCls}>Km montaje</th><th className={thCls}>Desmontaje</th>
            <th className={thCls}>Km desmontaje</th><th className={thCls}>Motivo</th>
          </tr></thead>
          <tbody>
            {historial.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={5}>Sin historial.</td></tr>
            : historial.map((h) => (
              <tr key={h.id} className="border-t border-slate-700/60">
                <td className={tdCls + " text-slate-400"}>{h.fecha_montaje ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{h.km_montaje ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{h.fecha_desmontaje ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{h.km_desmontaje ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{h.motivo_desmontaje ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {["Inspecciones", "Mediciones", "Fotos"].map((t) => (
          <div key={t} className="rounded-lg border border-dashed border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-500">{t}<div className="text-[11px]">Próximas fases</div></div>
        ))}
      </div>
    </div>
  );
}
