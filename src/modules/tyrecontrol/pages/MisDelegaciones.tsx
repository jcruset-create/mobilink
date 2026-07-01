import { useEffect, useState } from "react";
import { listarDelegaciones } from "../services/data";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import type { Delegacion } from "../types";
import { Badge, TableWrap, tdCls, thCls } from "../components/ui";

export default function MisDelegaciones() {
  const { perfil } = useTyreAuth();
  const [items, setItems] = useState<Delegacion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!perfil?.empresa_id) return;
    listarDelegaciones(perfil.empresa_id).then(setItems).finally(() => setLoading(false));
  }, [perfil?.empresa_id]);

  return (
    <div>
      <h1 className="mb-3 text-lg font-black">Mis delegaciones</h1>
      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Nombre</th><th className={thCls}>Dirección</th><th className={thCls}>Ciudad</th>
          <th className={thCls}>Responsable</th><th className={thCls}>Teléfono</th><th className={thCls}>Estado</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={6}>Cargando…</td></tr>
          : items.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={6}>Sin delegaciones.</td></tr>
          : items.map((d) => (
            <tr key={d.id} className="border-t border-slate-700/60">
              <td className={tdCls + " font-semibold"}>{d.nombre}</td>
              <td className={tdCls + " text-slate-400"}>{d.direccion ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{d.ciudad ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{d.responsable ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{d.telefono ?? "—"}</td>
              <td className={tdCls}><Badge ok={d.activo}>{d.activo ? "Activa" : "Inactiva"}</Badge></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
