import { useState } from "react";
import { crearTyreSize } from "../services/data";
import { Modal, Field, inputCls } from "./ui";

/// Modal para crear una referencia de medida (tyre_size) correctamente.
/// Al guardar devuelve el id de la medida (tc_cat_medidas_neumatico) para
/// poder asignarla al vehículo.
export default function ModalNuevaMedida({ onClose, onCreated }: { onClose: () => void; onCreated: (medidaId: string) => void }) {
  const [f, setF] = useState({ ancho: "", perfil: "", diametro_llanta: "", codigo_velocidad: "", indice_carga_simple: "", indice_carga_doble: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function guardar() {
    if (!f.ancho || !f.diametro_llanta || !f.indice_carga_simple || !f.codigo_velocidad) {
      setMsg("Ancho, diámetro, índice de carga simple y código de velocidad son obligatorios."); return;
    }
    setSaving(true); setMsg("");
    try {
      const medidaId = await crearTyreSize({
        ancho: Number(f.ancho), perfil: f.perfil ? Number(f.perfil) : null,
        diametro_llanta: Number(f.diametro_llanta), indice_carga_simple: f.indice_carga_simple.trim(),
        indice_carga_doble: f.indice_carga_doble.trim() || null, codigo_velocidad: f.codigo_velocidad.trim().toUpperCase(),
        activo: true,
      });
      onCreated(medidaId);
    } catch (e: any) {
      setMsg(/duplicate|unique/i.test(e?.message || "") ? "Ya existe esa referencia; se usará la existente." : (e?.message || "Error"));
    } finally { setSaving(false); }
  }

  return (
    <Modal title="Nueva medida de neumático" onClose={onClose}
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
        <button onClick={guardar} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button>
      </div>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ancho *"><input type="number" className={inputCls} value={f.ancho} onChange={(e) => setF({ ...f, ancho: e.target.value })} placeholder="315" /></Field>
        <Field label="Perfil (vacío si no aplica)"><input type="number" className={inputCls} value={f.perfil} onChange={(e) => setF({ ...f, perfil: e.target.value })} placeholder="80" /></Field>
        <Field label="Diámetro llanta *"><input type="number" step="0.5" className={inputCls} value={f.diametro_llanta} onChange={(e) => setF({ ...f, diametro_llanta: e.target.value })} placeholder="22.5" /></Field>
        <Field label="Código velocidad *"><input className={inputCls} value={f.codigo_velocidad} onChange={(e) => setF({ ...f, codigo_velocidad: e.target.value })} placeholder="K" /></Field>
        <Field label="Índice carga simple *"><input className={inputCls} value={f.indice_carga_simple} onChange={(e) => setF({ ...f, indice_carga_simple: e.target.value })} placeholder="156" /></Field>
        <Field label="Índice carga doble (opcional)"><input className={inputCls} value={f.indice_carga_doble} onChange={(e) => setF({ ...f, indice_carga_doble: e.target.value })} placeholder="150" /></Field>
      </div>
      {msg && <div className="mt-2 text-[12px] text-amber-300">{msg}</div>}
    </Modal>
  );
}
