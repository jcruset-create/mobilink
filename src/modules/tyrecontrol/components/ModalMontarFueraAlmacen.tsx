import { useState } from "react";
import { montarFueraAlmacen } from "../services/data";
import { Modal, Field, inputCls } from "./ui";

interface Props {
  posicionNombre: string;
  vehiculoId: string;
  posicionId: string;
  onClose: () => void;
  onDone: () => void;
}

export default function ModalMontarFueraAlmacen({ posicionNombre, vehiculoId, posicionId, onClose, onDone }: Props) {
  const [motivo, setMotivo] = useState("");
  const [controlIndividual, setControlIndividual] = useState(true);
  const [datos, setDatos] = useState({ marca: "", modelo: "", medida: "", indice_carga: "", indice_velocidad: "", dot: "", numero_serie: "", rfid_epc: "" });
  const [km, setKm] = useState("");
  const [obs, setObs] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function confirmar() {
    if (!motivo.trim()) { setMsg("El motivo es obligatorio"); return; }
    if (!datos.marca.trim() || !datos.medida.trim()) { setMsg("Marca y medida son obligatorias"); return; }
    setSaving(true); setMsg("");
    try {
      await montarFueraAlmacen({
        vehiculoId, posicionId, controlIndividual, datos, motivo,
        km: km ? Number(km) : null, fecha: new Date().toISOString().slice(0, 10), observaciones: obs || null,
      });
      onDone();
    } catch (e: any) { setMsg(e?.message || "Error"); } finally { setSaving(false); }
  }

  return (
    <Modal title={`Montar fuera de almacén en ${posicionNombre}`} onClose={onClose}
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
        <button onClick={confirmar} disabled={saving} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Montar</button>
      </div>}>
      <div className="grid gap-2">
        <div className="rounded-lg bg-amber-900/30 p-2 text-[11px] text-amber-200">
          Neumático no procedente del almacén (cliente lo aporta, urgencia, carga inicial…). No descuenta stock y queda auditado.
          Si no tienes permiso, quedará pendiente de autorización de un administrador.
        </div>
        <Field label="Motivo *"><input className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. neumático aportado por el cliente" /></Field>

        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={controlIndividual} onChange={(e) => setControlIndividual(e.target.checked)} />
          Controlar individualmente (DOT, serie, RFID)
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Marca *"><input className={inputCls} value={datos.marca} onChange={(e) => setDatos({ ...datos, marca: e.target.value })} /></Field>
          <Field label="Modelo"><input className={inputCls} value={datos.modelo} onChange={(e) => setDatos({ ...datos, modelo: e.target.value })} /></Field>
          <Field label="Medida *"><input className={inputCls} value={datos.medida} onChange={(e) => setDatos({ ...datos, medida: e.target.value })} /></Field>
          <Field label="Índice carga"><input className={inputCls} value={datos.indice_carga} onChange={(e) => setDatos({ ...datos, indice_carga: e.target.value })} /></Field>
          {controlIndividual && (
            <>
              <Field label="DOT"><input className={inputCls} value={datos.dot} onChange={(e) => setDatos({ ...datos, dot: e.target.value })} /></Field>
              <Field label="Número de serie"><input className={inputCls} value={datos.numero_serie} onChange={(e) => setDatos({ ...datos, numero_serie: e.target.value })} /></Field>
              <Field label="RFID EPC"><input className={inputCls} value={datos.rfid_epc} onChange={(e) => setDatos({ ...datos, rfid_epc: e.target.value })} /></Field>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Km vehículo"><input type="number" className={inputCls} value={km} onChange={(e) => setKm(e.target.value)} /></Field>
          <Field label="Observaciones"><input className={inputCls} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        </div>
        {msg && <div className="text-[11px] text-red-300">{msg}</div>}
      </div>
    </Modal>
  );
}
