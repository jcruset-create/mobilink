import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listarVehiculos, crearVehiculo, actualizarVehiculo, listarEmpresas, listarDelegaciones, listarTiposVehiculo,
} from "../services/data";
import type { Delegacion, Empresa, TipoVehiculo, Vehiculo, VehiculoInput, OrigenKm } from "../types";
import { ORIGEN_KM_LABELS } from "../types";
import { Badge, Modal, TableWrap, tdCls, thCls, inputCls, TextField, Field } from "../components/ui";

const VACIO: VehiculoInput = {
  empresa_id: "", delegacion_id: null, tipo_vehiculo_id: null, matricula: "",
  marca: "", modelo: "", bastidor: "", fecha_matriculacion: null, webfleet_vehicle_id: "",
  km_actual: 0, origen_km: "manual", activo: true,
};

export default function Vehiculos() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Vehiculo[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [delegaciones, setDelegaciones] = useState<Delegacion[]>([]);
  const [tipos, setTipos] = useState<TipoVehiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  // filtros
  const [q, setQ] = useState("");
  const [fEmpresa, setFEmpresa] = useState("");
  const [fDele, setFDele] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fEstado, setFEstado] = useState<"todos" | "activos" | "inactivos">("todos");

  const [modal, setModal] = useState<null | { id: string | null; draft: VehiculoInput }>(null);
  const [saving, setSaving] = useState(false);

  async function cargar() {
    setLoading(true);
    try {
      const [v, e, d, t] = await Promise.all([listarVehiculos(), listarEmpresas(), listarDelegaciones(), listarTiposVehiculo()]);
      setItems(v); setEmpresas(e); setDelegaciones(d); setTipos(t);
    } catch (er: any) { setMsg(er?.message || "Error cargando"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((v) => {
      if (fEmpresa && v.empresa_id !== fEmpresa) return false;
      if (fDele && v.delegacion_id !== fDele) return false;
      if (fTipo && v.tipo_vehiculo_id !== fTipo) return false;
      if (fEstado === "activos" && !v.activo) return false;
      if (fEstado === "inactivos" && v.activo) return false;
      if (s && !v.matricula.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [items, q, fEmpresa, fDele, fTipo, fEstado]);

  const delegacionesForm = useMemo(
    () => delegaciones.filter((d) => !modal?.draft.empresa_id || d.empresa_id === modal.draft.empresa_id),
    [delegaciones, modal?.draft.empresa_id]
  );

  async function guardar() {
    if (!modal) return;
    const d = modal.draft;
    if (!d.empresa_id) { setMsg("Selecciona empresa"); return; }
    if (!d.matricula.trim()) { setMsg("La matrícula es obligatoria"); return; }
    setSaving(true);
    try {
      if (modal.id) await actualizarVehiculo(modal.id, d);
      else await crearVehiculo(d);
      setModal(null); setMsg("✔ Guardado"); await cargar();
    } catch (e: any) {
      setMsg(/duplicate|unique/i.test(e?.message || "") ? "Ya existe un vehículo con esa matrícula en la empresa." : (e?.message || "Error"));
    } finally { setSaving(false); }
  }

  const set = (p: Partial<VehiculoInput>) => modal && setModal({ ...modal, draft: { ...modal.draft, ...p } });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black">Vehículos</h1>
        <button onClick={() => setModal({ id: null, draft: { ...VACIO } })} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">+ Nuevo vehículo</button>
      </div>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-[200px]`} placeholder="Buscar matrícula…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputCls} w-auto`} value={fEmpresa} onChange={(e) => { setFEmpresa(e.target.value); setFDele(""); }}>
          <option value="">Todas las empresas</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fDele} onChange={(e) => setFDele(e.target.value)}>
          <option value="">Todas las delegaciones</option>
          {delegaciones.filter((d) => !fEmpresa || d.empresa_id === fEmpresa).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          {tipos.map((t) => <option key={t.id} value={t.id}>{t.descripcion ?? t.nombre}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fEstado} onChange={(e) => setFEstado(e.target.value as any)}>
          <option value="todos">Todos</option><option value="activos">Activos</option><option value="inactivos">Inactivos</option>
        </select>
        <span className="text-xs text-slate-500">{visibles.length} vehículo(s)</span>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Matrícula</th><th className={thCls}>Empresa</th><th className={thCls}>Delegación</th>
          <th className={thCls}>Marca</th><th className={thCls}>Modelo</th><th className={thCls}>Tipo</th>
          <th className={thCls}>Km</th><th className={thCls}>Origen km</th><th className={thCls}>Estado</th><th className={thCls}>Acciones</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={10}>Cargando…</td></tr>
          : visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={10}>Sin vehículos.</td></tr>
          : visibles.map((v) => (
            <tr key={v.id} className="border-t border-slate-700/60">
              <td className={tdCls + " font-bold"}>{v.matricula}</td>
              <td className={tdCls + " text-slate-400"}>{v.empresa?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{v.delegacion?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{v.marca ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{v.modelo ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{v.tipo?.descripcion ?? v.tipo?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{Number(v.km_actual).toLocaleString("es-ES")}</td>
              <td className={tdCls + " text-[11px] text-slate-500"}>{ORIGEN_KM_LABELS[v.origen_km]}</td>
              <td className={tdCls}><Badge ok={v.activo}>{v.activo ? "Activo" : "Inactivo"}</Badge></td>
              <td className={tdCls}>
                <div className="flex gap-2">
                  <button onClick={() => navigate(`/tyrecontrol/vehiculos/${v.id}`)} className="text-sky-300 hover:underline">Ficha</button>
                  <button onClick={() => setModal({ id: v.id, draft: { ...VACIO, ...v } })} className="text-slate-300 hover:underline">Editar</button>
                  <button onClick={async () => { await actualizarVehiculo(v.id, { activo: !v.activo }); await cargar(); }} className="text-amber-300 hover:underline">{v.activo ? "Desactivar" : "Activar"}</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {modal && (
        <Modal title={modal.id ? "Editar vehículo" : "Nuevo vehículo"} onClose={() => setModal(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setModal(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button>
          </div>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Empresa *">
              <select className={inputCls} value={modal.draft.empresa_id} onChange={(e) => set({ empresa_id: e.target.value, delegacion_id: null })}>
                <option value="">Selecciona…</option>
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </Field>
            <Field label="Delegación">
              <select className={inputCls} value={modal.draft.delegacion_id ?? ""} onChange={(e) => set({ delegacion_id: e.target.value || null })}>
                <option value="">—</option>
                {delegacionesForm.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select>
            </Field>
            <TextField label="Matrícula *" value={modal.draft.matricula ?? ""} onChange={(v) => set({ matricula: v })} />
            <Field label="Tipo de vehículo">
              <select className={inputCls} value={modal.draft.tipo_vehiculo_id ?? ""} onChange={(e) => set({ tipo_vehiculo_id: e.target.value || null })}>
                <option value="">—</option>
                {tipos.map((t) => <option key={t.id} value={t.id}>{t.descripcion ?? t.nombre}</option>)}
              </select>
            </Field>
            <TextField label="Marca" value={modal.draft.marca ?? ""} onChange={(v) => set({ marca: v })} />
            <TextField label="Modelo" value={modal.draft.modelo ?? ""} onChange={(v) => set({ modelo: v })} />
            <TextField label="Bastidor" value={modal.draft.bastidor ?? ""} onChange={(v) => set({ bastidor: v })} />
            <Field label="Fecha matriculación">
              <input type="date" className={inputCls} value={modal.draft.fecha_matriculacion ?? ""} onChange={(e) => set({ fecha_matriculacion: e.target.value || null })} />
            </Field>
            <Field label="Km actual">
              <input type="number" className={inputCls} value={modal.draft.km_actual} onChange={(e) => set({ km_actual: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Origen km">
              <select className={inputCls} value={modal.draft.origen_km} onChange={(e) => set({ origen_km: e.target.value as OrigenKm })}>
                {(Object.keys(ORIGEN_KM_LABELS) as OrigenKm[]).map((o) => <option key={o} value={o}>{ORIGEN_KM_LABELS[o]}</option>)}
              </select>
            </Field>
            <TextField label="Webfleet Vehicle ID" value={modal.draft.webfleet_vehicle_id ?? ""} onChange={(v) => set({ webfleet_vehicle_id: v })} />
            <Field label="Estado">
              <select className={inputCls} value={modal.draft.activo ? "1" : "0"} onChange={(e) => set({ activo: e.target.value === "1" })}>
                <option value="1">Activo</option><option value="0">Inactivo</option>
              </select>
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
