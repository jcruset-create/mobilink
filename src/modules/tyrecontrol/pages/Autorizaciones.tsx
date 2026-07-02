import { useEffect, useState } from "react";
import { listarAutorizacionesPendientes, resolverAutorizacion } from "../services/data";
import type { AutorizacionOperacion } from "../types";
import { TIPO_OPERACION_LABELS } from "../types";
import { TableWrap, tdCls, thCls } from "../components/ui";

export default function Autorizaciones() {
  const [items, setItems] = useState<AutorizacionOperacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  async function cargar() {
    setLoading(true);
    try { setItems(await listarAutorizacionesPendientes()); }
    catch (e: any) { setMsg(e?.message || "Error"); } finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  async function resolver(id: string, aprobar: boolean) {
    try { await resolverAutorizacion(id, aprobar); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error"); }
  }

  return (
    <div>
      <h1 className="mb-3 text-lg font-black">Autorizaciones pendientes</h1>
      {msg && <div className="mb-3 text-sm text-red-300">{msg}</div>}

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Fecha</th><th className={thCls}>Tipo</th><th className={thCls}>Operación</th>
          <th className={thCls}>Motivo</th><th className={thCls}>Acciones</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={5}>Cargando…</td></tr>
          : items.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={5}>Sin autorizaciones pendientes.</td></tr>
          : items.map((a) => (
            <tr key={a.id} className="border-t border-slate-700/60">
              <td className={tdCls + " text-slate-400"}>{new Date(a.fecha_solicitud).toLocaleString("es-ES")}</td>
              <td className={tdCls + " text-slate-400"}>{a.tipo_autorizacion}</td>
              <td className={tdCls + " text-slate-400"}>{a.operacion ? TIPO_OPERACION_LABELS[a.operacion.tipo_operacion] : "—"}</td>
              <td className={tdCls + " text-slate-300"}>{a.motivo}</td>
              <td className={tdCls}>
                <div className="flex gap-2">
                  <button onClick={() => resolver(a.id, true)} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white">Aprobar</button>
                  <button onClick={() => resolver(a.id, false)} className="rounded bg-rose-600 px-2 py-1 text-[11px] font-bold text-white">Rechazar</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
