import { useEffect, useMemo, useState } from "react";
import { listarVehiculos } from "../services/data";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import type { Vehiculo } from "../types";
import { Badge, TableWrap, tdCls, thCls, inputCls } from "../components/ui";

export default function MisVehiculos() {
  const { perfil } = useTyreAuth();
  const [items, setItems] = useState<Vehiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!perfil?.empresa_id) return;
    listarVehiculos({ empresaId: perfil.empresa_id }).then(setItems).finally(() => setLoading(false));
  }, [perfil?.empresa_id]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((v) => !s || v.matricula.toLowerCase().includes(s));
  }, [items, q]);

  return (
    <div>
      <h1 className="mb-3 text-lg font-black">Mis vehículos</h1>
      <input className={`${inputCls} mb-3 max-w-xs`} placeholder="Buscar matrícula…" value={q} onChange={(e) => setQ(e.target.value)} />
      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Matrícula</th><th className={thCls}>Delegación</th><th className={thCls}>Marca</th>
          <th className={thCls}>Modelo</th><th className={thCls}>Tipo</th><th className={thCls}>Km</th><th className={thCls}>Estado</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={7}>Cargando…</td></tr>
          : visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={7}>Sin vehículos.</td></tr>
          : visibles.map((v) => (
            <tr key={v.id} className="border-t border-slate-700/60">
              <td className={tdCls + " font-bold"}>{v.matricula}</td>
              <td className={tdCls + " text-slate-400"}>{v.delegacion?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{v.marca ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{v.modelo ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{v.tipo?.descripcion ?? v.tipo?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{Number(v.km_actual).toLocaleString("es-ES")}</td>
              <td className={tdCls}><Badge ok={v.activo}>{v.activo ? "Activo" : "Inactivo"}</Badge></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
