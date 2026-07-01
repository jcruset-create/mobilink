import { useEffect, useMemo, useState } from "react";
import { listarNeumaticos } from "../services/data";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import type { Neumatico } from "../types";
import { ESTADO_NEUMATICO_LABELS } from "../types";
import { TableWrap, tdCls, thCls, inputCls } from "../components/ui";

export default function MisNeumaticos() {
  const { perfil } = useTyreAuth();
  const [items, setItems] = useState<Neumatico[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!perfil?.empresa_id) return;
    listarNeumaticos({ empresaId: perfil.empresa_id }).then(setItems).finally(() => setLoading(false));
  }, [perfil?.empresa_id]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((n) => !s || [n.codigo_interno, n.numero_serie, n.dot, n.rfid_epc].some((x) => (x ?? "").toLowerCase().includes(s)));
  }, [items, q]);

  return (
    <div>
      <h1 className="mb-3 text-lg font-black">Mis neumáticos</h1>
      <input className={`${inputCls} mb-3 max-w-xs`} placeholder="Buscar código / serie / DOT / RFID…" value={q} onChange={(e) => setQ(e.target.value)} />
      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Cód. interno</th><th className={thCls}>Nº serie</th><th className={thCls}>DOT</th>
          <th className={thCls}>Marca</th><th className={thCls}>Medida</th><th className={thCls}>Estado</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={6}>Cargando…</td></tr>
          : visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={6}>Sin neumáticos.</td></tr>
          : visibles.map((n) => (
            <tr key={n.id} className="border-t border-slate-700/60">
              <td className={tdCls + " font-bold"}>{n.codigo_interno ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{n.numero_serie ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{n.dot ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{n.marca ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{n.medida ?? "—"}</td>
              <td className={tdCls}><span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-bold text-slate-200">{ESTADO_NEUMATICO_LABELS[n.estado]}</span></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
