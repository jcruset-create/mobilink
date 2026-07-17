import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { stockAlmacenEmpresa } from "../services/data";
import type { StockAlmacenLinea } from "../services/data";
import { TableWrap, tdCls, thCls } from "./ui";

/// Stock del cliente de almacén enlazado, separado en NUEVO y USADO.
/// El usado (neumáticos devueltos al desmontar) no se mezcla con el nuevo.
export default function StockAlmacen({ empresaId, enlazado }: { empresaId: string; enlazado: boolean }) {
  const navigate = useNavigate();
  const [lineas, setLineas] = useState<StockAlmacenLinea[]>([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let vivo = true;
    if (!enlazado) { setCargando(false); return; }
    setCargando(true);
    stockAlmacenEmpresa(empresaId)
      .then((l) => { if (vivo) setLineas(l); })
      .catch((e) => { if (vivo) setMsg(e?.message || "Error"); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [empresaId, enlazado]);

  const totales = useMemo(() => lineas.reduce((a, l) => ({ nuevo: a.nuevo + (l.nuevo || 0), usado: a.usado + (l.usado || 0) }), { nuevo: 0, usado: 0 }), [lineas]);

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase text-slate-400">Stock de neumáticos en almacén</div>
        {enlazado && (
          <div className="flex gap-2 text-xs">
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300 ring-1 ring-emerald-500/30">Nuevo: {totales.nuevo}</span>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-300 ring-1 ring-amber-500/30">Usado: {totales.usado}</span>
          </div>
        )}
      </div>

      {!enlazado ? (
        <div className="text-sm text-slate-500">Sin cliente de almacén enlazado. Enlázalo arriba para ver y descontar stock.</div>
      ) : cargando ? (
        <div className="text-sm text-slate-500">Cargando stock…</div>
      ) : lineas.length === 0 ? (
        <div className="text-sm text-slate-500">Sin stock registrado para este cliente de almacén.</div>
      ) : (
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Marca</th><th className={thCls}>Modelo</th><th className={thCls}>Medida</th>
            <th className={thCls}>Nuevo</th><th className={thCls}>Usado</th>
          </tr></thead>
          <tbody>
            {lineas.map((l) => (
              <tr key={l.producto_id} className="border-t border-slate-700/60">
                <td className={tdCls + " font-semibold text-slate-200"}>{l.marca}</td>
                <td className={tdCls + " text-slate-400"}>{l.modelo ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{l.medida}</td>
                <td className={tdCls}><span className={l.nuevo > 0 ? "font-bold text-emerald-300" : "text-slate-500"}>{l.nuevo}</span></td>
                <td className={tdCls}><span className={l.usado > 0 ? "font-bold text-amber-300" : "text-slate-500"}>{l.usado}</span></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {enlazado && (
        <button onClick={() => navigate("/tyrecontrol/neumaticos")} className="mt-2 text-[12px] text-sky-300 hover:underline">
          Ver neumáticos técnicos de la empresa →
        </button>
      )}
      {msg && <div className="mt-2 text-[11px] text-red-300">{msg}</div>}
    </div>
  );
}
