import { useState } from "react";
import { montarFueraAlmacen } from "../services/data";
import type { Neumatico } from "../types";
import { Modal, Field, inputCls } from "./ui";

export interface DestinoCopia { id: string; nombre: string; }

interface Props {
  vehiculoId: string;
  /** Neumático ya montado del que se copian los parámetros. */
  origen: Neumatico;
  nombreOrigen: string;
  destinos: DestinoCopia[];
  onClose: () => void;
  onDone: () => void;
}

interface DatosIndividuales { dot: string; numero_serie: string; rfid_epc: string; }
const VACIO: DatosIndividuales = { dot: "", numero_serie: "", rfid_epc: "" };

export default function ModalCopiarNeumatico({ vehiculoId, origen, nombreOrigen, destinos, onClose, onDone }: Props) {
  // Copiar es copiar: las ruedas nuevas salen con EXACTAMENTE los mismos
  // datos que la de origen. Por eso se montan siempre fuera de almacén (que
  // inserta lo que se le pasa tal cual) y no desde el catálogo, que
  // sobreescribiría índices y profundidad con los de la referencia.
  const [controlIndividual, setControlIndividual] = useState(origen.control_individual ?? false);
  const [profundidad, setProfundidad] = useState(
    origen.profundidad_actual_mm != null ? String(origen.profundidad_actual_mm) : "");
  const [km, setKm] = useState("");
  const [obs, setObs] = useState("");

  // Wizard rueda a rueda cuando hay control individual.
  const [paso, setPaso] = useState(0);
  const [ind, setInd] = useState<Record<string, DatosIndividuales>>({});
  const [hechas, setHechas] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const pendientes = destinos.filter((d) => !hechas.includes(d.id));
  const actual = controlIndividual ? destinos[paso] : null;
  const datosActual = actual ? (ind[actual.id] ?? VACIO) : VACIO;
  const indices = [origen.indice_carga, origen.indice_velocidad].filter(Boolean).join(" ");

  async function montarEn(destino: DestinoCopia, extra: DatosIndividuales | null) {
    const datos: Record<string, string> = {
      marca: origen.marca ?? "",
      modelo: origen.modelo ?? "",
      medida: origen.medida ?? "",
      indice_carga: origen.indice_carga ?? "",
      indice_velocidad: origen.indice_velocidad ?? "",
    };
    if (profundidad.trim() !== "") datos.profundidad_actual_mm = profundidad.replace(",", ".");
    if (controlIndividual && extra) {
      if (extra.dot.trim()) datos.dot = extra.dot.trim();
      if (extra.numero_serie.trim()) datos.numero_serie = extra.numero_serie.trim();
      if (extra.rfid_epc.trim()) datos.rfid_epc = extra.rfid_epc.trim();
    }
    await montarFueraAlmacen({
      vehiculoId, posicionId: destino.id, controlIndividual, datos,
      motivo: `Copiado de ${nombreOrigen}`,
      km: km ? Number(km) : null, fecha: new Date().toISOString().slice(0, 10), observaciones: obs || null,
    });
  }

  /** Sin control individual: se montan todas de una vez. */
  async function copiarTodas() {
    setSaving(true); setMsg("");
    const ok: string[] = [];
    try {
      for (const d of pendientes) { await montarEn(d, null); ok.push(d.id); }
      setHechas((prev) => [...prev, ...ok]);
      onDone();
    } catch (e: any) {
      setHechas((prev) => [...prev, ...ok]);
      setMsg(e?.message || "Error al copiar");
    } finally { setSaving(false); }
  }

  /** Con control individual: monta la rueda actual y pasa a la siguiente. */
  async function siguiente() {
    if (!actual) return;
    setSaving(true); setMsg("");
    try {
      await montarEn(actual, datosActual);
      const quedan = destinos.length - (hechas.length + 1);
      setHechas((prev) => [...prev, actual.id]);
      if (quedan <= 0) { onDone(); return; }
      setPaso(paso + 1);
    } catch (e: any) {
      setMsg(e?.message || "Error al copiar");
    } finally { setSaving(false); }
  }

  function saltar() {
    setMsg("");
    if (paso + 1 >= destinos.length) { onDone(); return; }
    setPaso(paso + 1);
  }

  return (
    <Modal title={`Copiar neumático en ${destinos.length} posición${destinos.length === 1 ? "" : "es"}`} onClose={onClose}
      footer={<div className="flex justify-end gap-2">
        {/* Si ya se ha montado alguna, al cerrar se sale del modo copia: esas
            posiciones ya no están libres y no tiene sentido seguir marcándolas. */}
        <button onClick={() => (hechas.length > 0 ? onDone() : onClose())} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">
          {hechas.length > 0 ? "Cerrar" : "Cancelar"}
        </button>
        {controlIndividual ? (
          <>
            <button onClick={saltar} disabled={saving} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 disabled:opacity-50">Saltar esta</button>
            <button onClick={siguiente} disabled={saving} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {saving ? "Montando…" : paso + 1 >= destinos.length ? "Montar y terminar" : "Montar y siguiente"}
            </button>
          </>
        ) : (
          <button onClick={copiarTodas} disabled={saving || pendientes.length === 0} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {saving ? "Copiando…" : `Copiar en ${pendientes.length}`}
          </button>
        )}
      </div>}>
      <div className="grid gap-2">
        <div className="rounded-lg bg-violet-900/30 p-2 text-[11px] text-violet-200">
          Las copias salen con los mismos datos que <b>{nombreOrigen}</b>, sin coger nada del catálogo.
          No descuenta stock del almacén y queda auditado como montaje fuera de almacén con el motivo «Copiado de {nombreOrigen}».
        </div>

        <div className="rounded-lg border border-slate-700 p-2">
          <div className="text-[11px] font-bold uppercase text-slate-500">Neumático a copiar</div>
          <div className="text-sm font-bold text-slate-100">{origen.marca ?? "—"} {origen.modelo ?? ""}</div>
          <div className="text-[12px] text-slate-300">{origen.medida ?? "—"}{indices ? ` · ${indices}` : ""}</div>
        </div>

        <div className="rounded-lg border border-slate-700 p-2">
          <div className="text-[11px] font-bold uppercase text-slate-500">Posiciones destino</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {destinos.map((d) => {
              const hecha = hechas.includes(d.id);
              const esActual = actual?.id === d.id;
              return (
                <span key={d.id}
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                    hecha ? "border-emerald-600 bg-emerald-900/40 text-emerald-300"
                      : esActual ? "border-violet-500 bg-violet-900/40 text-violet-200"
                        : "border-slate-600 text-slate-300"}`}>
                  {hecha ? "✓ " : ""}{d.nombre}
                </span>
              );
            })}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={controlIndividual} disabled={hechas.length > 0}
            onChange={(e) => { setControlIndividual(e.target.checked); setPaso(0); setMsg(""); }} />
          Controlar individualmente (DOT, número de serie, RFID)
        </label>

        {controlIndividual && actual && (
          <div className="rounded-lg border border-violet-700/60 bg-violet-950/30 p-2">
            <div className="text-[12px] font-bold text-violet-200">
              Rueda {paso + 1} de {destinos.length} · {actual.nombre}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Número de serie">
                <input className={inputCls} value={datosActual.numero_serie} autoFocus
                  onChange={(e) => setInd({ ...ind, [actual.id]: { ...datosActual, numero_serie: e.target.value } })} />
              </Field>
              <Field label="DOT">
                <input className={inputCls} value={datosActual.dot}
                  onChange={(e) => setInd({ ...ind, [actual.id]: { ...datosActual, dot: e.target.value } })} />
              </Field>
              <Field label="RFID EPC">
                <input className={inputCls} value={datosActual.rfid_epc}
                  onChange={(e) => setInd({ ...ind, [actual.id]: { ...datosActual, rfid_epc: e.target.value } })} />
              </Field>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Profundidad (mm)">
            <input type="number" step="0.1" className={inputCls} value={profundidad} placeholder="la del origen"
              onChange={(e) => setProfundidad(e.target.value)} />
          </Field>
          <Field label="Km vehículo"><input type="number" className={inputCls} value={km} onChange={(e) => setKm(e.target.value)} /></Field>
          <Field label="Observaciones"><input className={inputCls} value={obs} onChange={(e) => setObs(e.target.value)} /></Field>
        </div>

        {msg && <div className="text-[11px] text-red-300">{msg}</div>}
        {hechas.length > 0 && hechas.length < destinos.length && (
          <div className="text-[11px] text-emerald-300">{hechas.length} de {destinos.length} ya montadas; lo hecho queda guardado aunque cierres.</div>
        )}
      </div>
    </Modal>
  );
}
