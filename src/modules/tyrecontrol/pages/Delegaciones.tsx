import { useEffect, useMemo, useState } from "react";
import { listarDelegaciones, crearDelegacion, actualizarDelegacion, listarEmpresas } from "../services/data";
import type { Delegacion, DelegacionInput, Empresa } from "../types";
import { Badge, Modal, TableWrap, tdCls, thCls, inputCls, Field } from "../components/ui";
import { DelegacionFormFields, delegacionVacia } from "../components/forms";

export default function Delegaciones() {
  const [items, setItems] = useState<Delegacion[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [modal, setModal] = useState<null | { id: string | null; empresaId: string; draft: DelegacionInput }>(null);
  const [saving, setSaving] = useState(false);

  async function cargar() {
    setLoading(true);
    try {
      const [d, e] = await Promise.all([listarDelegaciones(), listarEmpresas()]);
      setItems(d); setEmpresas(e);
    } catch (er: any) { setMsg(er?.message || "Error cargando"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  const visibles = useMemo(
    () => items.filter((d) => !filtroEmpresa || d.empresa_id === filtroEmpresa),
    [items, filtroEmpresa]
  );

  async function guardar() {
    if (!modal) return;
    if (!modal.empresaId) { setMsg("Selecciona una empresa"); return; }
    if (!modal.draft.nombre.trim()) { setMsg("El nombre es obligatorio"); return; }
    setSaving(true);
    try {
      const draft = { ...modal.draft, empresa_id: modal.empresaId };
      if (modal.id) await actualizarDelegacion(modal.id, draft);
      else await crearDelegacion(draft);
      setModal(null); await cargar();
    } catch (e: any) { setMsg(e?.message || "Error"); } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black">Delegaciones</h1>
        <button onClick={() => setModal({ id: null, empresaId: filtroEmpresa || empresas[0]?.id || "", draft: delegacionVacia("") })} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white">+ Nueva delegación</button>
      </div>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      <div className="mb-3 flex items-center gap-2">
        <select className={`${inputCls} w-auto`} value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)}>
          <option value="">Todas las empresas</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <span className="text-xs text-slate-500">{visibles.length} delegación(es)</span>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Empresa</th><th className={thCls}>Nombre</th><th className={thCls}>Ciudad</th>
          <th className={thCls}>Responsable</th><th className={thCls}>Teléfono</th><th className={thCls}>Estado</th><th className={thCls}></th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={7}>Cargando…</td></tr>
          : visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={7}>Sin delegaciones.</td></tr>
          : visibles.map((d) => (
            <tr key={d.id} className="border-t border-slate-700/60">
              <td className={tdCls + " text-slate-400"}>{d.empresa?.nombre ?? "—"}</td>
              <td className={tdCls + " font-semibold"}>{d.nombre}</td>
              <td className={tdCls + " text-slate-400"}>{d.ciudad ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{d.responsable ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{d.telefono ?? "—"}</td>
              <td className={tdCls}><Badge ok={d.activo}>{d.activo ? "Activa" : "Inactiva"}</Badge></td>
              <td className={tdCls}><button onClick={() => setModal({ id: d.id, empresaId: d.empresa_id, draft: { ...delegacionVacia(d.empresa_id), ...d } })} className="text-sky-300 hover:underline">Editar</button></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {modal && (
        <Modal title={modal.id ? "Editar delegación" : "Nueva delegación"} onClose={() => setModal(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setModal(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar</button>
          </div>}>
          <div className="mb-2">
            <Field label="Empresa *">
              <select className={inputCls} value={modal.empresaId} onChange={(e) => setModal({ ...modal, empresaId: e.target.value })}>
                <option value="">Selecciona…</option>
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </Field>
          </div>
          <DelegacionFormFields draft={modal.draft} set={(p) => setModal({ ...modal, draft: { ...modal.draft, ...p } })} />
        </Modal>
      )}
    </div>
  );
}
