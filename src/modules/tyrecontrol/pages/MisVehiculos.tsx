import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listarVehiculos } from "../services/data";
import { useTyreAuth } from "../contexts/TyreAuthContext";
import type { Vehiculo } from "../types";
import { Badge, TableWrap, tdCls, thCls, inputCls } from "../components/ui";

export default function MisVehiculos() {
  const { perfil } = useTyreAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Vehiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  // Los de baja tampoco salen aquí si no se piden: la pantalla del cliente
  // tiene el mismo problema que la de administración, y un cliente con la
  // mitad de la lista en histórico no encuentra su camión.
  const [verBajas, setVerBajas] = useState(false);

  useEffect(() => {
    if (!perfil?.empresa_id) return;
    listarVehiculos({ empresaId: perfil.empresa_id }).then(setItems).finally(() => setLoading(false));
  }, [perfil?.empresa_id]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((v) => {
      if (!verBajas && !v.activo) return false;
      return !s || v.matricula.toLowerCase().includes(s) || (v.numero_unidad ?? "").toLowerCase().includes(s);
    });
  }, [items, q, verBajas]);

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Mis vehículos</h1>
      <p className="mb-3 text-sm text-slate-400">Pulsa una fila para ver la ficha del vehículo: plano, profundidades y presiones.</p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className={`${inputCls} max-w-xs`} placeholder="Buscar matrícula o nº unidad…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-300">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-sky-500"
            checked={verBajas}
            onChange={(e) => setVerBajas(e.target.checked)}
          />
          Ver también los de baja
        </label>
        <span className="text-xs text-slate-500">{visibles.length} vehículo(s)</span>
      </div>
      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Matrícula</th><th className={thCls}>Nº unidad</th><th className={thCls}>Delegación</th><th className={thCls}>Marca</th>
          <th className={thCls}>Modelo</th><th className={thCls}>Tipo</th><th className={thCls}>Km</th><th className={thCls}>Estado</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={8}>Cargando…</td></tr>
          : visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={8}>Sin vehículos.</td></tr>
          : visibles.map((v) => (
            <tr
              key={v.id}
              onClick={() => navigate(`/tyrecontrol/vehiculos/${v.id}`)}
              className="cursor-pointer border-t border-slate-700/60 hover:bg-slate-800/60"
            >
              <td className={tdCls + " font-bold"}>{v.matricula}</td>
              <td className={tdCls + " text-slate-400"}>{v.numero_unidad ?? "—"}</td>
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
