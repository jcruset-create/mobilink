import { useEffect, useState } from "react";
import { listarOperaciones, listarEmpresas, listarVehiculos, actualizarCosteOperacion } from "../services/data";
import type { Empresa, OperacionNeumatico, TipoOperacion, Vehiculo, EstadoOperacion } from "../types";
import { TIPO_OPERACION_LABELS, MOTIVO_OPERACION_LABELS, ESTADO_OPERACION_LABELS, ESTADO_OPERACION_BADGE, PRIORIDAD_OPERACION_LABELS } from "../types";
import { TableWrap, tdCls, thCls, inputCls, Modal, Field } from "../components/ui";
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
  cambio_posicion: "bg-indigo-500/30 text-indigo-200",
  intercambio: "bg-violet-500/30 text-violet-200",
  retirada_stock: "bg-teal-500/30 text-teal-200",
  retirada_definitiva: "bg-rose-500/30 text-rose-200",
  correccion_posicion: "bg-orange-500/30 text-orange-200",
  correccion_montado: "bg-orange-500/30 text-orange-200",
};

export default function Operaciones() {
  const { perfil } = useTyreAuth();
  const esCliente = perfil?.rol === "cliente" && !perfil?.es_superadmin;
  const [items, setItems] = useState<OperacionNeumatico[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [vehiculos, setVehiculos] = useState<Vehiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [editCoste, setEditCoste] = useState<null | { id: string; material: string; mano: string }>(null);
  const [savingCoste, setSavingCoste] = useState(false);

  const [fEmpresa, setFEmpresa] = useState(esCliente ? (perfil?.empresa_id ?? "") : "");
  const [fVehiculo, setFVehiculo] = useState("");
  const [fTipo, setFTipo] = useState<TipoOperacion | "">("");
  const [fEstado, setFEstado] = useState<EstadoOperacion | "">("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");

  async function cargar() {
    setLoading(true);
    try {
      const [ops, veh] = await Promise.all([
        listarOperaciones({
          empresaId: fEmpresa || undefined, vehiculoId: fVehiculo || undefined,
          tipo: fTipo || undefined, estado: fEstado || undefined, desde: fDesde || undefined, hasta: fHasta || undefined,
        }),
        listarVehiculos(fEmpresa ? { empresaId: fEmpresa } : undefined),
      ]);
      setItems(ops); setVehiculos(veh);
    } catch (e: any) { setMsg(e?.message || "Error"); } finally { setLoading(false); }
  }
  useEffect(() => { if (!esCliente) listarEmpresas().then(setEmpresas); }, [esCliente]);
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [fEmpresa, fVehiculo, fTipo, fEstado, fDesde, fHasta]);

  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  async function guardarCoste() {
    if (!editCoste) return;
    setSavingCoste(true);
    try {
      await actualizarCosteOperacion(editCoste.id, { coste_material: num(editCoste.material), coste_mano_obra: num(editCoste.mano) });
      setEditCoste(null); await cargar();
    } catch (e: any) { setMsg(e?.message || "Error al guardar el coste"); } finally { setSavingCoste(false); }
  }

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
        <select className={`${inputCls} w-auto`} value={fEstado} onChange={(e) => setFEstado(e.target.value as EstadoOperacion | "")}>
          <option value="">Todos los estados</option>
          {(Object.keys(ESTADO_OPERACION_LABELS) as EstadoOperacion[]).map((s) => <option key={s} value={s}>{ESTADO_OPERACION_LABELS[s]}</option>)}
        </select>
        <input type="date" className={`${inputCls} w-auto`} value={fDesde} onChange={(e) => setFDesde(e.target.value)} />
        <span className="text-xs text-slate-500">a</span>
        <input type="date" className={`${inputCls} w-auto`} value={fHasta} onChange={(e) => setFHasta(e.target.value)} />
        <span className="text-xs text-slate-500">{items.length}</span>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Nº</th><th className={thCls}>Fecha</th><th className={thCls}>Empresa</th><th className={thCls}>Vehículo</th>
          <th className={thCls}>Tipo</th><th className={thCls}>Estado</th><th className={thCls}>Neumático</th><th className={thCls}>Posición</th>
          <th className={thCls}>Km</th><th className={thCls}>Motivo</th><th className={thCls}>Destino</th><th className={thCls}>Coste</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={12}>Cargando…</td></tr>
          : items.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={12}>Sin operaciones.</td></tr>
          : items.map((o) => (
            <tr key={o.id} className="border-t border-slate-700/60">
              <td className={tdCls + " font-mono text-slate-500"}>{o.numero_operacion ? `#${o.numero_operacion}` : "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.fecha_operacion}</td>
              <td className={tdCls + " text-slate-400"}>{o.empresa?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.vehiculo?.matricula ?? "—"}</td>
              <td className={tdCls}><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${COLOR_TIPO[o.tipo_operacion]}`}>{TIPO_OPERACION_LABELS[o.tipo_operacion]}</span></td>
              <td className={tdCls}>
                {o.status ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_OPERACION_BADGE[o.status]}`}>{ESTADO_OPERACION_LABELS[o.status]}</span> : "—"}
                {o.prioridad && o.prioridad !== "normal" && <span className="ml-1 text-[10px] uppercase text-amber-300">{PRIORIDAD_OPERACION_LABELS[o.prioridad]}</span>}
              </td>
              <td className={tdCls + " text-slate-400"}>{o.neumatico?.numero_interno ?? o.neumatico?.codigo_interno ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.posicion_origen?.codigo_posicion ?? ""}{o.posicion_origen && o.posicion_destino ? " → " : ""}{o.posicion_destino?.codigo_posicion ?? ""}</td>
              <td className={tdCls + " text-slate-400"}>{o.km_vehiculo ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.motivo ? MOTIVO_OPERACION_LABELS[o.motivo] : "—"}</td>
              <td className={tdCls + " text-slate-400"}>{o.destino ?? "—"}</td>
              <td className={tdCls}>
                {(() => {
                  const total = (o.coste_material ?? 0) + (o.coste_mano_obra ?? 0);
                  const tiene = o.coste_material != null || o.coste_mano_obra != null;
                  return (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-300">{tiene ? total.toLocaleString("es-ES", { style: "currency", currency: "EUR" }) : "—"}</span>
                      {!esCliente && (
                        <button
                          onClick={() => setEditCoste({ id: o.id, material: o.coste_material != null ? String(o.coste_material) : "", mano: o.coste_mano_obra != null ? String(o.coste_mano_obra) : "" })}
                          className="text-[11px] text-sky-300 hover:underline"
                        >editar</button>
                      )}
                    </div>
                  );
                })()}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {editCoste && (
        <Modal title="Coste de la operación" onClose={() => setEditCoste(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setEditCoste(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardarCoste} disabled={savingCoste} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{savingCoste ? "Guardando…" : "Guardar"}</button>
          </div>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Coste material (€)"><input type="number" step="0.01" className={inputCls} value={editCoste.material} onChange={(e) => setEditCoste({ ...editCoste, material: e.target.value })} /></Field>
            <Field label="Coste mano de obra (€)"><input type="number" step="0.01" className={inputCls} value={editCoste.mano} onChange={(e) => setEditCoste({ ...editCoste, mano: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
