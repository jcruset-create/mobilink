import { useEffect, useState } from "react";
import { listarOperaciones, listarEmpresas, listarVehiculos } from "../services/data";
import type { Empresa, OperacionNeumatico, TipoOperacion, Vehiculo } from "../types";
import { TIPO_OPERACION_LABELS, MOTIVO_OPERACION_LABELS } from "../types";
import { TableWrap, tdCls, thCls, inputCls } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

const COLOR_TIPO: Record<TipoOperacion, string> = {
  montaje: "bg-emerald-500/30 text-emerald-200",
  desmontaje: "bg-slate-600 text-slate-100",
  sustitucion: "bg-sky-500/30 text-sky-200",
  rotacion: "bg-indigo-500/30 text-indigo-200",
  reparacion: "bg-purple-500/30 text-purple-200",
  descarte: "bg-rose-500/30 text-rose-200",
  entrada_almacen: "bg-teal-500/30 text-teal-200",
  salida_almacen: "bg-amber-500/30 text-amber-200",
  revision_vehiculo: "bg-cyan-500/30 text-cyan-200",
};

export default function Operaciones() {
  const { perfil } = useTyreAuth();
  const esCliente = perfil?.rol === "cliente" && !perfil?.es_superadmin;
  const [items, setItems] = useState<OperacionNeumatico[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [fEmpresa, setFEmpresa] = useState(esCliente ? (perfil?.empresa_id ?? "") : "");
  const [fVehiculo, setFVehiculo] = useState("");
  const [fTipo, setFTipo] = useState<TipoOperacion | "">("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");

  async function cargar() {
    setLoading(true);
    try {
      const [ops, veh] = await Promise.all([
        listarOperaciones({
          empresaId: fEmpresa || undefined, vehiculoId: fVehiculo || undefined,
          tipo: fTipo || undefined, desde: fDesde || undefined, hasta: fHasta || undefined,
        }),
        listarVehiculos(fEmpresa ? { empresaId: fEmpresa } : undefined),
      ]);
      setItems(ops); setVehiculos(veh);
    } catch (e: any) { setMsg(e?.message || "Error"); } finally { setLoading(false); }
  }
  useEffect(() => { if (!esCliente) listarEmpresas().then(setEmpresas); }, [esCliente]);
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [fEmpresa, fVehiculo, fTipo, fDesde, fHasta]);

  return (
    <div>
      <h1 className="mb-3 text-lg font-black">Operaciones de neumáticos</h1>
      {msg && <div className="mb-3 text-sm text-red-300">{msg}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!esCliente && (
          <select className={`${inputCls} w-auto`} value={fEmpresa} onChange={(e) => { setFEmpresa(e.target.value); setFVehiculo(""); }}>
            <option value="">Todas las empresas</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        )}
        <select className={`${inputCls} w-auto`} value={fVehiculo} onChange={(e) => setFVehiculo(e.target.value)}>
          <option value="">Todos los vehículos</option>{vehiculos.map((v) => <option key={v.id} value={v.id}>{v.matricula}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fTipo} onChange={(e) => setFTipo(e.target.value as TipoOperacion | "")}>
          <option value="">Todos los tipos</option>
          {(Object.keys(TIPO_OPERACION_LABELS) as TipoOperacion[]).map((t) => <option key={t} value={t}>{TIPO_OPERACION_LABELS[t]}</option>)}
        </select>
        <input type="date" className={`${inputCls} w-auto`} value={fDesde} onChange={(e) => setFDesde(e.target.value)} />
        <span className="text-xs text-slate-500">a</span>
        <input type="date" className={`${inputCls} w-auto`} value={fHasta} onChange={(e) => setFHasta(e.target.value)} />
        <span className="text-xs text-slate-500">{items.length}</span>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Fecha</th><th className={thCls}>Empresa</th><th className={thCls}>Vehículo</th>
          <th className={thCls}>Tipo</th><th className={thCls}>Neumático</th><th className={thCls}>Posición</th>
          <th className={thCls}>Km</th><th className={thCls}>Motivo</th><th className={thCls}>Destino</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={9}>Cargando…</td></tr>
          : items.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={9}>Sin operaciones.</td></tr>
          : items.map((o) => (
            <tr key={o.id} className="border-t border-slate-700/60">
              <td className={tdCls + " text-slate-400"}>{o.fecha_operacion}</td>
              <td className={tdCls + " text-slate-400"}>{o.empresa?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.vehiculo?.matricula ?? "—"}</td>
              <td className={tdCls}><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${COLOR_TIPO[o.tipo_operacion]}`}>{TIPO_OPERACION_LABELS[o.tipo_operacion]}</span></td>
              <td className={tdCls + " text-slate-400"}>{o.neumatico?.numero_interno ?? o.neumatico?.codigo_interno ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.posicion_origen?.codigo_posicion ?? ""}{o.posicion_origen && o.posicion_destino ? " → " : ""}{o.posicion_destino?.codigo_posicion ?? ""}</td>
              <td className={tdCls + " text-slate-400"}>{o.km_vehiculo ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.motivo ? MOTIVO_OPERACION_LABELS[o.motivo] : "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.destino ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
