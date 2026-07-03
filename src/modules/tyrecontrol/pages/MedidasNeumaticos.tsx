import { useEffect, useMemo, useState } from "react";
import { listarTyreSizes, crearTyreSize, eliminarTyreSize } from "../services/data";
import type { TyreSize } from "../types";
import { Modal, Field, inputCls, TableWrap, tdCls, thCls } from "../components/ui";

const VACIO = {
  ancho: "", perfil: "", diametro_llanta: "", indice_carga_simple: "", indice_carga_doble: "", codigo_velocidad: "", activo: true,
};

export default function MedidasNeumaticos() {
  const [items, setItems] = useState<TyreSize[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [fDiametro, setFDiametro] = useState("");
  const [fCarga, setFCarga] = useState("");
  const [fVelocidad, setFVelocidad] = useState("");
  const [modal, setModal] = useState<null | typeof VACIO>(null);
  const [saving, setSaving] = useState(false);

  async function cargar() {
    setLoading(true);
    try { setItems(await listarTyreSizes()); }
    catch (e: any) { setMsg(e?.message || "Error"); } finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  const diametros = useMemo(() => Array.from(new Set(items.map((i) => i.diametro_llanta))).sort((a, b) => a - b), [items]);
  const velocidades = useMemo(() => Array.from(new Set(items.map((i) => i.codigo_velocidad))).sort(), [items]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => {
      if (fDiametro && String(i.diametro_llanta) !== fDiametro) return false;
      if (fVelocidad && i.codigo_velocidad !== fVelocidad) return false;
      if (fCarga && i.indice_carga_simple !== fCarga && i.indice_carga_doble !== fCarga) return false;
      if (s && !i.referencia_completa.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [items, q, fDiametro, fCarga, fVelocidad]);

  async function guardar() {
    if (!modal) return;
    if (!modal.ancho || !modal.diametro_llanta || !modal.indice_carga_simple || !modal.codigo_velocidad) {
      setMsg("Ancho, diámetro, índice de carga simple y código de velocidad son obligatorios."); return;
    }
    setSaving(true); setMsg("");
    try {
      await crearTyreSize({
        ancho: Number(modal.ancho), perfil: modal.perfil ? Number(modal.perfil) : null,
        diametro_llanta: Number(modal.diametro_llanta), indice_carga_simple: modal.indice_carga_simple.trim(),
        indice_carga_doble: modal.indice_carga_doble.trim() || null, codigo_velocidad: modal.codigo_velocidad.trim().toUpperCase(),
        activo: true,
      });
      setModal(null); setMsg("✔ Guardado"); await cargar();
    } catch (e: any) {
      setMsg(/duplicate|unique/i.test(e?.message || "") ? "Ya existe esa referencia completa." : (e?.message || "Error"));
    } finally { setSaving(false); }
  }

  async function desactivar(id: string) {
    if (!window.confirm("¿Desactivar esta referencia? Dejará de aparecer en los desplegables.")) return;
    try { await eliminarTyreSize(id); await cargar(); } catch (e: any) { setMsg(e?.message || "Error"); }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-black">Medidas de neumáticos</h1>
        <button onClick={() => setModal({ ...VACIO })} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">+ Nueva referencia</button>
      </div>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-[240px]`} placeholder="Buscar referencia (ej. 315/80 R22.5)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputCls} w-auto`} value={fDiametro} onChange={(e) => setFDiametro(e.target.value)}>
          <option value="">Todos los diámetros</option>{diametros.map((d) => <option key={d} value={d}>R{d}</option>)}
        </select>
        <input className={`${inputCls} w-auto`} placeholder="Índice de carga" value={fCarga} onChange={(e) => setFCarga(e.target.value)} />
        <select className={`${inputCls} w-auto`} value={fVelocidad} onChange={(e) => setFVelocidad(e.target.value)}>
          <option value="">Todos los códigos</option>{velocidades.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <span className="text-xs text-slate-500">{visibles.length}</span>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Referencia completa</th><th className={thCls}>Medida</th>
          <th className={thCls}>Índice carga</th><th className={thCls}>Código velocidad</th>
          <th className={thCls}>Estado</th><th className={thCls}>Acciones</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={6}>Cargando…</td></tr>
          : visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={6}>Sin resultados.</td></tr>
          : visibles.map((t) => (
            <tr key={t.id} className="border-t border-slate-700/60">
              <td className={tdCls + " font-bold"}>{t.referencia_completa}</td>
              <td className={tdCls + " text-slate-400"}>{t.medida}</td>
              <td className={tdCls + " text-slate-400"}>{t.indice_carga_doble ? `${t.indice_carga_simple}/${t.indice_carga_doble}` : t.indice_carga_simple}</td>
              <td className={tdCls + " text-slate-400"}>{t.codigo_velocidad}</td>
              <td className={tdCls}><span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">Activo</span></td>
              <td className={tdCls}><button onClick={() => desactivar(t.id)} className="text-rose-400 hover:underline">Desactivar</button></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {modal && (
        <Modal title="Nueva referencia de medida" onClose={() => setModal(null)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setModal(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar</button>
          </div>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Ancho *"><input type="number" className={inputCls} value={modal.ancho} onChange={(e) => setModal({ ...modal, ancho: e.target.value })} placeholder="315" /></Field>
            <Field label="Perfil (vacío si no aplica)"><input type="number" className={inputCls} value={modal.perfil} onChange={(e) => setModal({ ...modal, perfil: e.target.value })} placeholder="80" /></Field>
            <Field label="Diámetro llanta *"><input type="number" step="0.5" className={inputCls} value={modal.diametro_llanta} onChange={(e) => setModal({ ...modal, diametro_llanta: e.target.value })} placeholder="22.5" /></Field>
            <Field label="Código velocidad *"><input className={inputCls} value={modal.codigo_velocidad} onChange={(e) => setModal({ ...modal, codigo_velocidad: e.target.value })} placeholder="K" /></Field>
            <Field label="Índice carga simple *"><input className={inputCls} value={modal.indice_carga_simple} onChange={(e) => setModal({ ...modal, indice_carga_simple: e.target.value })} placeholder="156" /></Field>
            <Field label="Índice carga doble (opcional)"><input className={inputCls} value={modal.indice_carga_doble} onChange={(e) => setModal({ ...modal, indice_carga_doble: e.target.value })} placeholder="150" /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
