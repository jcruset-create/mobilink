import { useEffect, useState } from "react";
import { listarFichasGenericas, montarDesdeAlmacen, sustituirNeumatico } from "../services/data";
import type { FichaGenerica, MotivoDesmontaje, DestinoDesmontaje } from "../types";
import { MOTIVO_DESMONTAJE_LABELS } from "../types";
import { Modal, Field, inputCls } from "./ui";

interface Props {
  posicionNombre: string;
  vehiculoId: string;
  posicionId: string;
  montajeActualId?: string; // si viene informado, es una SUSTITUCIÓN (desmonta + monta)
  onClose: () => void;
  onDone: () => void;
}

export default function ModalMontarDesdeFicha({ posicionNombre, vehiculoId, posicionId, montajeActualId, onClose, onDone }: Props) {
  const [fichas, setFichas] = useState<FichaGenerica[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [fichaId, setFichaId] = useState("");
  const [controlIndividual, setControlIndividual] = useState(false);
  const [datos, setDatos] = useState({ dot: "", numero_serie: "", rfid_epc: "", proveedor: "" });
  const [km, setKm] = useState("");
  const [obs, setObs] = useState("");
  const [motivo, setMotivo] = useState<MotivoDesmontaje>("desgaste");
  const [destino, setDestino] = useState<DestinoDesmontaje>("almacen");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { listarFichasGenericas().then(setFichas); }, []);
  useEffect(() => { const t = setTimeout(() => listarFichasGenericas(busqueda).then(setFichas), 250); return () => clearTimeout(t); }, [busqueda]);

  async function confirmar() {
    if (!fichaId) { setMsg("Selecciona una ficha genérica de almacén"); return; }
    setSaving(true); setMsg("");
    try {
      if (montajeActualId) {
        await sustituirNeumatico({
          montajeActualId, fichaGenericaId: fichaId, controlIndividual, datos,
          motivoDesmontaje: motivo, destinoRetirado: destino,
          km: km ? Number(km) : null, fecha: new Date().toISOString().slice(0, 10), observaciones: obs || null,
        });
      } else {
        await montarDesdeAlmacen({
          vehiculoId, posicionId, fichaGenericaId: fichaId, controlIndividual, datos,
          km: km ? Number(km) : null, fecha: new Date().toISOString().slice(0, 10), observaciones: obs || null,
        });
      }
      onDone();
    } catch (e: any) { setMsg(e?.message || "Error"); } finally { setSaving(false); }
  }

  return (
    <Modal title={`${montajeActualId ? "Sustituir" : "Montar"} en ${posicionNombre}`} onClose={onClose}
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
        <button onClick={confirmar} disabled={saving || !fichaId} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          {montajeActualId ? "Sustituir" : "Montar"}
        </button>
      </div>}>
      <div className="grid gap-2">
        {montajeActualId && (
          <>
            <div className="text-[11px] font-bold uppercase text-slate-400">1. Neumático retirado</div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Motivo de desmontaje">
                <select className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoDesmontaje)}>
                  {(Object.keys(MOTIVO_DESMONTAJE_LABELS) as MotivoDesmontaje[]).map((m) => <option key={m} value={m}>{MOTIVO_DESMONTAJE_LABELS[m]}</option>)}
                </select>
              </Field>
              <Field label="Destino del retirado">
                <select className={inputCls} value={destino} onChange={(e) => setDestino(e.target.value as DestinoDesmontaje)}>
                  <option value="almacen">Vuelve a almacén</option>
                  <option value="reparacion">Reparación</option>
                  <option value="descartado">Descarte</option>
                </select>
              </Field>
            </div>
            <div className="mt-1 text-[11px] font-bold uppercase text-slate-400">2. Neumático nuevo</div>
          </>
        )}

        <Field label="Ficha genérica de almacén (marca / medida) *">
          <input className={`${inputCls} mb-1`} placeholder="Buscar…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <select className={inputCls} value={fichaId} onChange={(e) => setFichaId(e.target.value)}>
            <option value="">Selecciona…</option>
            {fichas.map((f) => <option key={f.id} value={f.id}>{f.marca} {f.modelo ?? ""} · {f.medida}</option>)}
          </select>
        </Field>

        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={controlIndividual} onChange={(e) => setControlIndividual(e.target.checked)} />
          Controlar este neumático individualmente (DOT, serie, RFID)
        </label>

        {controlIndividual && (
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-900 p-2">
            <Field label="DOT (4 dígitos)"><input className={inputCls} value={datos.dot} onChange={(e) => setDatos({ ...datos, dot: e.target.value })} /></Field>
            <Field label="Número de serie"><input className={inputCls} value={datos.numero_serie} onChange={(e) => setDatos({ ...datos, numero_serie: e.target.value })} /></Field>
            <Field label="RFID EPC"><input className={inputCls} value={datos.rfid_epc} onChange={(e) => setDatos({ ...datos, rfid_epc: e.target.value })} /></Field>
            <Field label="Proveedor"><input className={inputCls} value={datos.proveedor} onChange={(e) => setDatos({ ...datos, proveedor: e.target.value })} /></Field>
          </div>
        )}
        {!controlIndividual && (
          <div className="text-[11px] text-slate-500">Se creará un número interno automático; el resto de datos se hereda de la ficha genérica.</div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Km vehículo"><input type="number" className={inputCls} value={km} onChange={(e) => setKm(e.target.value)} /></Field>
          <Field label="Observaciones"><input className={inputCls} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        </div>
        {msg && <div className="text-[11px] text-red-300">{msg}</div>}
      </div>
    </Modal>
  );
}
