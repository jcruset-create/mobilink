import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listarNeumaticos, crearNeumatico, actualizarNeumatico, listarEmpresas } from "../services/data";
import type { Empresa, Neumatico, NeumaticoInput, EstadoNeumatico } from "../types";
import { ESTADO_NEUMATICO_LABELS } from "../types";
import { Modal, TableWrap, tdCls, thCls, inputCls, TextField, Field } from "../components/ui";

const VACIO: NeumaticoInput = {
  empresa_id: "", codigo_interno: "", numero_serie: "", dot: "", marca: "", modelo: "", medida: "",
  indice_carga: "", indice_velocidad: "", rfid_epc: "", estado: "almacen",
  fecha_compra: null, coste_compra: null, proveedor: "", referencia_almacen: "", activo: true,
};

const ESTADO_COLOR: Record<EstadoNeumatico, string> = {
  almacen: "bg-slate-600 text-slate-100", reservado: "bg-amber-500/30 text-amber-200",
  montado: "bg-emerald-500/30 text-emerald-200", reparacion: "bg-sky-500/30 text-sky-200", descartado: "bg-rose-500/30 text-rose-200",
};

export default function Neumaticos() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Neumatico[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [fEmpresa, setFEmpresa] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fMarca, setFMarca] = useState("");
  const [fMedida, setFMedida] = useState("");
  const [modal, setModal] = useState<null | { id: string | null; draft: NeumaticoInput }>(null);
  const [saving, setSaving] = useState(false);

  async function cargar() {
    setLoading(true);
    try { const [n, e] = await Promise.all([listarNeumaticos(), listarEmpresas()]); setItems(n); setEmpresas(e); }
    catch (er: any) { setMsg(er?.message || "Error"); } finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  const marcas = useMemo(() => Array.from(new Set(items.map((n) => n.marca).filter(Boolean))) as string[], [items]);
  const medidas = useMemo(() => Array.from(new Set(items.map((n) => n.medida).filter(Boolean))) as string[], [items]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((n) => {
      if (fEmpresa && n.empresa_id !== fEmpresa) return false;
      if (fEstado && n.estado !== fEstado) return false;
      if (fMarca && n.marca !== fMarca) return false;
      if (fMedida && n.medida !== fMedida) return false;
      if (s && ![n.codigo_interno, n.numero_serie, n.dot, n.rfid_epc].some((x) => (x ?? "").toLowerCase().includes(s))) return false;
      return true;
    });
  }, [items, q, fEmpresa, fEstado, fMarca, fMedida]);

  async function guardar() {
    if (!modal) return;
    const d = modal.draft;
    if (!d.empresa_id) { setMsg("Selecciona empresa"); return; }
    if (d.dot && !/^\d{4}$/.test(d.dot)) { setMsg("El DOT debe tener 4 dígitos (p.ej. 1425)."); return; }
    setSaving(true);
    try {
      if (modal.id) await actualizarNeumatico(modal.id, d); else await crearNeumatico(d);
      setModal(null); setMsg("✔ Guardado"); await cargar();
    } catch (e: any) {
      setMsg(/duplicate|unique/i.test(e?.message || "") ? "Ya existe un neumático con ese número de serie o RFID." : (e?.message || "Error"));
    } finally { setSaving(false); }
  }
  const set = (p: Partial<NeumaticoInput>) => modal && setModal({ ...modal, draft: { ...modal.draft, ...p } });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black">Neumáticos</h1>
        <button onClick={() => setModal({ id: null, draft: { ...VACIO } })} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">+ Nuevo neumático</button>
      </div>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-[220px]`} placeholder="Buscar código / serie / DOT / RFID…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputCls} w-auto`} value={fEmpresa} onChange={(e) => setFEmpresa(e.target.value)}>
          <option value="">Todas las empresas</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
          <option value="">Todos los estados</option>{(Object.keys(ESTADO_NEUMATICO_LABELS) as EstadoNeumatico[]).map((s) => <option key={s} value={s}>{ESTADO_NEUMATICO_LABELS[s]}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fMarca} onChange={(e) => setFMarca(e.target.value)}>
          <option value="">Todas las marcas</option>{marcas.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fMedida} onChange={(e) => setFMedida(e.target.value)}>
          <option value="">Todas las medidas</option>{medidas.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="text-xs text-slate-500">{visibles.length}</span>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Cód. interno</th><th className={thCls}>Nº serie</th><th className={thCls}>DOT</th>
          <th className={thCls}>Marca</th><th className={thCls}>Modelo</th><th className={thCls}>Medida</th>
          <th className={thCls}>RFID</th><th className={thCls}>Estado</th><th className={thCls}>Empresa</th><th className={thCls}>Acciones</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={10}>Cargando…</td></tr>
          : visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={10}>Sin neumáticos.</td></tr>
          : visibles.map((n) => (
            <tr key={n.id} className="border-t border-slate-700/60">
              <td className={tdCls + " font-bold"}>{n.codigo_interno ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{n.numero_serie ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{n.dot ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{n.marca ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{n.modelo ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{n.medida ?? "—"}</td>
              <td className={tdCls + " text-[11px] text-slate-500"}>{n.rfid_epc ?? "—"}</td>
              <td className={tdCls}><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${ESTADO_COLOR[n.estado]}`}>{ESTADO_NEUMATICO_LABELS[n.estado]}</span></td>
              <td className={tdCls + " text-slate-400"}>{n.empresa?.nombre ?? "—"}</td>
              <td className={tdCls}>
                <div className="flex gap-2">
                  <button onClick={() => navigate(`/tyrecontrol/neumaticos/${n.id}`)} className="text-sky-300 hover:underline">Ficha</button>
                  <button onClick={() => setModal({ id: n.id, draft: { ...VACIO, ...n } })} className="text-slate-300 hover:underline">Editar</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {modal && (
        <Modal title={modal.id ? "Editar neumático" : "Nuevo neumático"} onClose={() => setModal(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setModal(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar</button>
          </div>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Empresa *">
              <select className={inputCls} value={modal.draft.empresa_id} onChange={(e) => set({ empresa_id: e.target.value })}>
                <option value="">Selecciona…</option>{empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </Field>
            <Field label="Estado">
              <select className={inputCls} value={modal.draft.estado} onChange={(e) => set({ estado: e.target.value as EstadoNeumatico })}>
                {(Object.keys(ESTADO_NEUMATICO_LABELS) as EstadoNeumatico[]).map((s) => <option key={s} value={s}>{ESTADO_NEUMATICO_LABELS[s]}</option>)}
              </select>
            </Field>
            <TextField label="Código interno" value={modal.draft.codigo_interno ?? ""} onChange={(v) => set({ codigo_interno: v })} />
            <TextField label="Número de serie" value={modal.draft.numero_serie ?? ""} onChange={(v) => set({ numero_serie: v })} />
            <TextField label="DOT (4 dígitos)" value={modal.draft.dot ?? ""} onChange={(v) => set({ dot: v })} />
            <TextField label="RFID EPC" value={modal.draft.rfid_epc ?? ""} onChange={(v) => set({ rfid_epc: v })} />
            <TextField label="Marca" value={modal.draft.marca ?? ""} onChange={(v) => set({ marca: v })} />
            <TextField label="Modelo" value={modal.draft.modelo ?? ""} onChange={(v) => set({ modelo: v })} />
            <TextField label="Medida" value={modal.draft.medida ?? ""} onChange={(v) => set({ medida: v })} />
            <TextField label="Índice carga" value={modal.draft.indice_carga ?? ""} onChange={(v) => set({ indice_carga: v })} />
            <TextField label="Índice velocidad" value={modal.draft.indice_velocidad ?? ""} onChange={(v) => set({ indice_velocidad: v })} />
            <TextField label="Proveedor" value={modal.draft.proveedor ?? ""} onChange={(v) => set({ proveedor: v })} />
            <Field label="Fecha compra">
              <input type="date" className={inputCls} value={modal.draft.fecha_compra ?? ""} onChange={(e) => set({ fecha_compra: e.target.value || null })} />
            </Field>
            <Field label="Coste compra (€)">
              <input type="number" className={inputCls} value={modal.draft.coste_compra ?? ""} onChange={(e) => set({ coste_compra: e.target.value === "" ? null : Number(e.target.value) })} />
            </Field>
            <TextField label="Referencia almacén" value={modal.draft.referencia_almacen ?? ""} onChange={(v) => set({ referencia_almacen: v })} />
            <Field label="Activo">
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
